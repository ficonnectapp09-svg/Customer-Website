import { Router, Request, Response } from 'express';
import { db, Order, DeliveryAssignment } from '../db';
import { socketManager } from '../socket';
import { authenticateToken, enforceRoleAndApproval, AuthenticatedRequest } from '../security/middleware';

const router = Router();
const deliveryAuth = [authenticateToken, enforceRoleAndApproval('delivery', 'admin')];

// GET: /api/delivery-partners/:id/dashboard
router.get('/:id/dashboard', ...deliveryAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const partner = await db.getDeliveryPartner(id);
    if (!partner) {
      return res.status(404).json({
        status: 'error',
        message: 'Delivery partner not found.'
      });
    }

    const earnings = await db.getEarnings(id);
    const completedOrdersCount = earnings.length;
    const totalEarned = earnings.reduce((acc, e) => acc + Number(e.per_delivery_earning) + Number(e.incentive) + Number(e.bonus), 0);
    
    const ratings = await db.getRatings(id);
    const avgRating = ratings.length > 0
      ? parseFloat((ratings.reduce((acc, r) => acc + r.rating_value, 0) / ratings.length).toFixed(1))
      : 5.0;

    // Check if there is an active assignment
    const activeAssignment = await db.getActiveAssignmentForPartner(id);
    let activeOrder = null;
    if (activeAssignment) {
      activeOrder = await db.getOrder(activeAssignment.order_id);
      (activeAssignment as any).assignmentId = activeAssignment.id;
      (activeAssignment as any).order = activeOrder;
    }

    res.json({
      status: 'success',
      data: {
        profile: partner,
        stats: {
          todayCompleted: completedOrdersCount,
          todayEarnings: totalEarned,
          rating: avgRating
        },
        activeAssignment,
        activeOrder
      }
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve partner dashboard details: ' + error.message
    });
  }
});

// GET: /api/delivery-partners/:id/earnings
router.get('/:id/earnings', ...deliveryAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const earnings = await db.getEarnings(id);
    res.json({
      status: 'success',
      data: earnings
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve earnings details: ' + error.message
    });
  }
});

// PUT: /api/delivery-partners/:id/status
router.put('/:id/status', ...deliveryAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, availability } = req.body;

  try {
    const updated = await db.updateDeliveryPartner(id, {
      status,
      availability: availability !== undefined ? availability : (status === 'Available')
    });

    if (!updated) {
      return res.status(404).json({
        status: 'error',
        message: 'Delivery partner not found.'
      });
    }

    socketManager.broadcast('partner_status_changed', {
      partnerId: id,
      status: updated.status,
      availability: updated.availability
    });

    res.json({
      status: 'success',
      message: 'Status updated successfully.',
      data: updated
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update status: ' + error.message
    });
  }
});

// POST: /api/delivery-partners/tracking
router.post('/tracking', ...deliveryAuth, async (req: Request, res: Response) => {
  const { partnerId, orderId, latitude, longitude, speed, batteryLevel, address } = req.body;

  if (!partnerId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      status: 'error',
      message: 'partnerId, latitude, and longitude are required.'
    });
  }

  try {
    // 1. Log tracking coordinates in database
    const trackingLog = await db.logTracking({
      delivery_partner_id: partnerId,
      order_id: orderId || '',
      latitude,
      longitude,
      speed: speed || 0,
      battery_level: batteryLevel || 100,
      current_address: address || '',
      updated_at: new Date().toISOString()
    });

    // 2. Update current location on the delivery partner record
    await db.updateDeliveryPartner(partnerId, {
      current_latitude: latitude,
      current_longitude: longitude,
      speed: speed || 0,
      battery_level: batteryLevel || 100,
      last_updated_time: new Date().toISOString()
    });

    // 3. Dispatch socket update
    socketManager.broadcast('partner_position_changed', {
      partnerId,
      orderId: orderId || null,
      latitude,
      longitude,
      speed: speed || 0,
      batteryLevel: batteryLevel || 100,
      address: address || ''
    });

    if (orderId) {
      socketManager.emitToOrder(orderId, 'partner_location_updated', {
        partnerId,
        orderId,
        latitude,
        longitude,
        speed: speed || 0,
        batteryLevel: batteryLevel || 100,
        address: address || '',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      status: 'success',
      message: 'Tracking coordinates recorded successfully.',
      data: trackingLog
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to log tracking: ' + error.message
    });
  }
});

// POST: /api/delivery-partners/assignments/:id/respond
router.post('/assignments/:id/respond', ...deliveryAuth, async (req: Request, res: Response) => {
  const { id } = req.params; // Assignment ID
  const { action } = req.body; // 'accept' or 'reject'

  if (action !== 'accept' && action !== 'reject') {
    return res.status(400).json({
      status: 'error',
      message: 'Action must be either accept or reject.'
    });
  }

  try {
    const status = action === 'accept' ? 'Accepted' : 'Rejected';
    const updatedDa = await db.updateAssignmentStatus(id, status);

    if (!updatedDa) {
      return res.status(404).json({
        status: 'error',
        message: 'Assignment record not found.'
      });
    }

    const order = await db.getOrder(updatedDa.order_id);
    const partner = await db.getDeliveryPartner(updatedDa.delivery_partner_id);

    if (!order || !partner) {
      return res.status(500).json({
        status: 'error',
        message: 'Order or partner reference in assignment is invalid.'
      });
    }

    if (action === 'accept') {
      // 1. Update Order status
      await db.updateOrderStatus(order.id, 'Delivery Partner Accepted');
      await db.logStatusHistory({
        order_id: order.id,
        status: 'Delivery Partner Accepted',
        updated_by: 'Delivery Partner',
        notes: `Assignment accepted by ${partner.name}`
      });

      // 2. Set Partner status to On Delivery
      await db.updateDeliveryPartner(partner.id, {
        status: 'Busy'
      });

      // Emit notifications
      socketManager.emitToVendor(order.vendor_id, 'order_accepted', { orderId: order.id, partner });
      socketManager.emitToOrder(order.id, 'order_status_updated', { status: 'Delivery Partner Accepted', partner });
    } else {
      // Rejecting assignment
      await db.updateDeliveryPartner(partner.id, {
        status: 'Available',
        availability: true
      });

      // Reset order status back to Ready For Pickup so it is queued for auto-assign again
      await db.updateOrderStatus(order.id, 'Ready For Pickup');
      await db.logStatusHistory({
        order_id: order.id,
        status: 'Ready For Pickup',
        updated_by: 'System',
        notes: `Assignment rejected by ${partner.name}`
      });

      // Notify vendor
      socketManager.emitToVendor(order.vendor_id, 'assignment_rejected', { orderId: order.id, partnerId: partner.id });
      // Trigger auto assign process again after short timeout (or handle manually)
    }

    res.json({
      status: 'success',
      message: `Assignment successfully ${status.toLowerCase()}ed.`,
      data: updatedDa
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update assignment response: ' + error.message
    });
  }
});

// POST: /api/delivery-partners/claim-order
router.post('/claim-order', ...deliveryAuth, async (req: Request, res: Response) => {
  const { partnerId, orderId } = req.body;

  if (!partnerId || !orderId) {
    return res.status(400).json({
      status: 'error',
      message: 'partnerId and orderId are required.'
    });
  }

  try {
    const order = await db.getOrder(orderId);
    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found.'
      });
    }

    const partner = await db.getDeliveryPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        status: 'error',
        message: 'Delivery partner not found.'
      });
    }

    // Check if order is already assigned/claimed by another active partner
    const currentAssignment = await db.getAssignmentForOrder(orderId);
    if (currentAssignment && (currentAssignment.status === 'Accepted' || currentAssignment.status === 'Pending')) {
      return res.status(400).json({
        status: 'error',
        message: 'Order is already assigned to another partner.'
      });
    }

    // 1. Create assignment record
    const assignmentId = 'asg_' + Math.floor(1000 + Math.random() * 9000);
    const assignment: DeliveryAssignment = {
      id: assignmentId,
      order_id: orderId,
      delivery_partner_id: partnerId,
      status: 'Accepted',
      assigned_at: new Date().toISOString(),
      responded_at: new Date().toISOString()
    };
    await db.createAssignment(assignment);

    // 2. Update order status
    await db.updateOrderStatus(orderId, 'Delivery Partner Accepted');
    await db.logStatusHistory({
      order_id: orderId,
      status: 'Delivery Partner Accepted',
      updated_by: 'Delivery Partner',
      notes: `Order claimed directly by ${partner.name}`
    });

    // 3. Set partner status to Busy
    await db.updateDeliveryPartner(partnerId, {
      status: 'Busy',
      availability: false
    });

    // Emit socket notifications
    socketManager.emitToVendor(order.vendor_id, 'order_accepted', { orderId, partner });
    socketManager.emitToOrder(orderId, 'order_status_updated', { status: 'Delivery Partner Accepted', partner });

    res.json({
      status: 'success',
      message: 'Order claimed successfully.',
      data: assignment
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to claim order: ' + error.message
    });
  }
});

// POST: /api/delivery-partners/deliveries/:orderId/step
router.post('/deliveries/:orderId/step', ...deliveryAuth, async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { step, partnerId, otp, photoProof } = req.body;

  try {
    const order = await db.getOrder(orderId);
    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found.'
      });
    }

    const partner = await db.getDeliveryPartner(partnerId);
    if (!partner) {
      return res.status(404).json({
        status: 'error',
        message: 'Partner not found.'
      });
    }

    let nextStatus: Order['status'] = order.status;
    let notes = '';

    if (step === 'pickup') {
      nextStatus = 'Picked Up';
      notes = `Order picked up from vendor by ${partner.name}`;
      await db.updateDeliveryPartner(partnerId, { status: 'On Delivery' });
    } else if (step === 'start') {
      nextStatus = 'Out For Delivery';
      notes = `Out for delivery by ${partner.name}`;
    } else if (step === 'near_customer') {
      nextStatus = 'Near Customer';
      notes = `${partner.name} is arriving near customer address`;
    } else if (step === 'complete') {
      // Verify OTP (For simulation, customer OTP is the last 4 digits of the order ID or '1234')
      const expectedOtp = order.id.replace(/[^\d]/g, '').slice(-4) || '1234';
      if (otp !== expectedOtp && otp !== '1234') {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid OTP code. Delivery verification failed.'
        });
      }

      nextStatus = 'Delivered';
      notes = `Delivered successfully. Verified with OTP and photo proof.`;
      
      // Complete Assignment status
      const activeDa = await db.getAssignmentForOrder(order.id);
      if (activeDa) {
        await db.updateAssignmentStatus(activeDa.id, 'Accepted'); // mark completed in history
      }

      // Add Delivery Earnings
      const earningId = 'e_' + Math.floor(1000 + Math.random() * 9000);
      await db.createEarning({
        id: earningId,
        delivery_partner_id: partnerId,
        order_id: order.id,
        per_delivery_earning: 65.00,
        incentive: 10.00,
        bonus: 0.00,
        date: new Date().toISOString().split('T')[0]
      });

      // Reset partner status to Available
      await db.updateDeliveryPartner(partnerId, {
        status: 'Available',
        availability: true
      });
    } else if (step === 'confirm_completed') {
      nextStatus = 'Completed';
      notes = `Order finalized and completed.`;
    }

    const updatedOrder = await db.updateOrderStatus(orderId, nextStatus);
    await db.logStatusHistory({
      order_id: orderId,
      status: nextStatus,
      updated_by: 'Delivery Partner',
      notes
    });

    // Notify rooms and persist vendor notification
    const previousStatus = order.status || 'Pending';
    const resolvedCustomer = (updatedOrder as any)?.customer_name || (updatedOrder as any)?.memberName || (order as any)?.customer_name || (order as any)?.memberName || 'Customer';
    const resolvedItem = (updatedOrder as any)?.product_details || (updatedOrder as any)?.items?.[0]?.name || (order as any)?.product_details || ((order as any)?.items && (order as any).items[0]?.name) || 'Order Item';
    const resolvedAmount = (updatedOrder as any)?.finalAmount || (updatedOrder as any)?.totalAmount || (updatedOrder as any)?.amount || (order as any)?.finalAmount || 0;

    const statusPayload = {
      orderId,
      id: orderId,
      order_number: (updatedOrder as any)?.order_number || (order as any)?.order_number || orderId,
      previousStatus,
      newStatus: nextStatus,
      status: nextStatus,
      orderStatus: nextStatus,
      category: 'Order',
      customerName: resolvedCustomer,
      memberName: resolvedCustomer,
      customer_name: resolvedCustomer,
      itemName: resolvedItem,
      product_details: resolvedItem,
      amount: resolvedAmount,
      description: `Delivery status updated to ${nextStatus}`,
      notes,
      partner,
      partnerId,
      timestamp: new Date().toISOString(),
      order: updatedOrder,
      data: updatedOrder
    };

    socketManager.emitToOrder(orderId, 'order_status_updated', statusPayload);
    if (order.vendor_id) {
      socketManager.emitToVendor(String(order.vendor_id), 'order_status_updated', statusPayload);
      socketManager.emitToVendor(String(order.vendor_id), 'ORDER_STATUS_CHANGED', statusPayload);

      // Persist notification for vendor in MongoDB
      const mongoDb = db.getDb();
      if (mongoDb) {
        mongoDb.collection('notifications').insertOne({
          recipientId: String(order.vendor_id),
          vendorId: String(order.vendor_id),
          role: 'vendor',
          category: 'Order',
          title: 'Order Status Updated',
          orderId,
          orderNumber: (updatedOrder as any)?.order_number || (order as any)?.order_number || orderId,
          customerName: resolvedCustomer,
          itemName: resolvedItem,
          previousStatus,
          newStatus: nextStatus,
          status: nextStatus,
          amount: resolvedAmount,
          description: `Order marked as ${nextStatus} by delivery partner`,
          read: false,
          isRead: false,
          createdAt: new Date(),
          created_at: new Date().toISOString(),
          date: new Date().toISOString()
        }).catch((e: any) => {
          console.warn('Delivery vendor notification insert warning:', e.message);
        });
      }

      // Sync downstream to Vendor Backend URL if configured
      const vendorBackendUrl = process.env.VENDOR_BACKEND_URL;
      if (vendorBackendUrl) {
        try {
          const cleanVendorUrl = vendorBackendUrl.trim().replace(/\/+$/, '');
          const myPort = String(process.env.PORT || 8001);
          if (!cleanVendorUrl.includes(`:${myPort}`)) {
            fetch(`${cleanVendorUrl}/api/vendor/orders/${orderId}/status`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'authorization': req.headers.authorization || ''
              },
              body: JSON.stringify({ status: nextStatus })
            }).catch(() => {});
          }
        } catch (e) {}
      }
    }

    res.json({
      status: 'success',
      message: `Step "${step}" processed successfully.`,
      data: updatedOrder
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to process delivery step: ' + error.message
    });
  }
});

export default router;
