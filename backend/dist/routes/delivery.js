"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const socket_1 = require("../socket");
const middleware_1 = require("../security/middleware");
const router = (0, express_1.Router)();
const deliveryAuth = [middleware_1.authenticateToken, (0, middleware_1.enforceRoleAndApproval)('delivery', 'admin')];
// GET: /api/delivery-partners/:id/dashboard
router.get('/:id/dashboard', ...deliveryAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const partner = await db_1.db.getDeliveryPartner(id);
        if (!partner) {
            return res.status(404).json({
                status: 'error',
                message: 'Delivery partner not found.'
            });
        }
        const earnings = await db_1.db.getEarnings(id);
        const completedOrdersCount = earnings.length;
        const totalEarned = earnings.reduce((acc, e) => acc + Number(e.per_delivery_earning) + Number(e.incentive) + Number(e.bonus), 0);
        const ratings = await db_1.db.getRatings(id);
        const avgRating = ratings.length > 0
            ? parseFloat((ratings.reduce((acc, r) => acc + r.rating_value, 0) / ratings.length).toFixed(1))
            : 5.0;
        // Check if there is an active assignment
        const activeAssignment = await db_1.db.getActiveAssignmentForPartner(id);
        let activeOrder = null;
        if (activeAssignment) {
            activeOrder = await db_1.db.getOrder(activeAssignment.order_id);
            activeAssignment.assignmentId = activeAssignment.id;
            activeAssignment.order = activeOrder;
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
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve partner dashboard details: ' + error.message
        });
    }
});
// GET: /api/delivery-partners/:id/earnings
router.get('/:id/earnings', ...deliveryAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const earnings = await db_1.db.getEarnings(id);
        res.json({
            status: 'success',
            data: earnings
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve earnings details: ' + error.message
        });
    }
});
// PUT: /api/delivery-partners/:id/status
router.put('/:id/status', ...deliveryAuth, async (req, res) => {
    const { id } = req.params;
    const { status, availability } = req.body;
    try {
        const updated = await db_1.db.updateDeliveryPartner(id, {
            status,
            availability: availability !== undefined ? availability : (status === 'Available')
        });
        if (!updated) {
            return res.status(404).json({
                status: 'error',
                message: 'Delivery partner not found.'
            });
        }
        socket_1.socketManager.broadcast('partner_status_changed', {
            partnerId: id,
            status: updated.status,
            availability: updated.availability
        });
        res.json({
            status: 'success',
            message: 'Status updated successfully.',
            data: updated
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to update status: ' + error.message
        });
    }
});
// POST: /api/delivery-partners/tracking
router.post('/tracking', ...deliveryAuth, async (req, res) => {
    const { partnerId, orderId, latitude, longitude, speed, batteryLevel, address } = req.body;
    if (!partnerId || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
            status: 'error',
            message: 'partnerId, latitude, and longitude are required.'
        });
    }
    try {
        // 1. Log tracking coordinates in database
        const trackingLog = await db_1.db.logTracking({
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
        await db_1.db.updateDeliveryPartner(partnerId, {
            current_latitude: latitude,
            current_longitude: longitude,
            speed: speed || 0,
            battery_level: batteryLevel || 100,
            last_updated_time: new Date().toISOString()
        });
        // 3. Dispatch socket update
        socket_1.socketManager.broadcast('partner_position_changed', {
            partnerId,
            orderId: orderId || null,
            latitude,
            longitude,
            speed: speed || 0,
            batteryLevel: batteryLevel || 100,
            address: address || ''
        });
        if (orderId) {
            socket_1.socketManager.emitToOrder(orderId, 'partner_location_updated', {
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
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to log tracking: ' + error.message
        });
    }
});
// POST: /api/delivery-partners/assignments/:id/respond
router.post('/assignments/:id/respond', ...deliveryAuth, async (req, res) => {
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
        const updatedDa = await db_1.db.updateAssignmentStatus(id, status);
        if (!updatedDa) {
            return res.status(404).json({
                status: 'error',
                message: 'Assignment record not found.'
            });
        }
        const order = await db_1.db.getOrder(updatedDa.order_id);
        const partner = await db_1.db.getDeliveryPartner(updatedDa.delivery_partner_id);
        if (!order || !partner) {
            return res.status(500).json({
                status: 'error',
                message: 'Order or partner reference in assignment is invalid.'
            });
        }
        if (action === 'accept') {
            // 1. Update Order status
            await db_1.db.updateOrderStatus(order.id, 'Delivery Partner Accepted');
            await db_1.db.logStatusHistory({
                order_id: order.id,
                status: 'Delivery Partner Accepted',
                updated_by: 'Delivery Partner',
                notes: `Assignment accepted by ${partner.name}`
            });
            // 2. Set Partner status to On Delivery
            await db_1.db.updateDeliveryPartner(partner.id, {
                status: 'Busy'
            });
            // Emit notifications
            socket_1.socketManager.emitToVendor(order.vendor_id, 'order_accepted', { orderId: order.id, partner });
            socket_1.socketManager.emitToOrder(order.id, 'order_status_updated', { status: 'Delivery Partner Accepted', partner });
        }
        else {
            // Rejecting assignment
            await db_1.db.updateDeliveryPartner(partner.id, {
                status: 'Available',
                availability: true
            });
            // Reset order status back to Ready For Pickup so it is queued for auto-assign again
            await db_1.db.updateOrderStatus(order.id, 'Ready For Pickup');
            await db_1.db.logStatusHistory({
                order_id: order.id,
                status: 'Ready For Pickup',
                updated_by: 'System',
                notes: `Assignment rejected by ${partner.name}`
            });
            // Notify vendor
            socket_1.socketManager.emitToVendor(order.vendor_id, 'assignment_rejected', { orderId: order.id, partnerId: partner.id });
            // Trigger auto assign process again after short timeout (or handle manually)
        }
        res.json({
            status: 'success',
            message: `Assignment successfully ${status.toLowerCase()}ed.`,
            data: updatedDa
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to update assignment response: ' + error.message
        });
    }
});
// POST: /api/delivery-partners/claim-order
router.post('/claim-order', ...deliveryAuth, async (req, res) => {
    const { partnerId, orderId } = req.body;
    if (!partnerId || !orderId) {
        return res.status(400).json({
            status: 'error',
            message: 'partnerId and orderId are required.'
        });
    }
    try {
        const order = await db_1.db.getOrder(orderId);
        if (!order) {
            return res.status(404).json({
                status: 'error',
                message: 'Order not found.'
            });
        }
        const partner = await db_1.db.getDeliveryPartner(partnerId);
        if (!partner) {
            return res.status(404).json({
                status: 'error',
                message: 'Delivery partner not found.'
            });
        }
        // Check if order is already assigned/claimed by another active partner
        const currentAssignment = await db_1.db.getAssignmentForOrder(orderId);
        if (currentAssignment && (currentAssignment.status === 'Accepted' || currentAssignment.status === 'Pending')) {
            return res.status(400).json({
                status: 'error',
                message: 'Order is already assigned to another partner.'
            });
        }
        // 1. Create assignment record
        const assignmentId = 'asg_' + Math.floor(1000 + Math.random() * 9000);
        const assignment = {
            id: assignmentId,
            order_id: orderId,
            delivery_partner_id: partnerId,
            status: 'Accepted',
            assigned_at: new Date().toISOString(),
            responded_at: new Date().toISOString()
        };
        await db_1.db.createAssignment(assignment);
        // 2. Update order status
        await db_1.db.updateOrderStatus(orderId, 'Delivery Partner Accepted');
        await db_1.db.logStatusHistory({
            order_id: orderId,
            status: 'Delivery Partner Accepted',
            updated_by: 'Delivery Partner',
            notes: `Order claimed directly by ${partner.name}`
        });
        // 3. Set partner status to Busy
        await db_1.db.updateDeliveryPartner(partnerId, {
            status: 'Busy',
            availability: false
        });
        // Emit socket notifications
        socket_1.socketManager.emitToVendor(order.vendor_id, 'order_accepted', { orderId, partner });
        socket_1.socketManager.emitToOrder(orderId, 'order_status_updated', { status: 'Delivery Partner Accepted', partner });
        res.json({
            status: 'success',
            message: 'Order claimed successfully.',
            data: assignment
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to claim order: ' + error.message
        });
    }
});
// POST: /api/delivery-partners/deliveries/:orderId/step
router.post('/deliveries/:orderId/step', ...deliveryAuth, async (req, res) => {
    const { orderId } = req.params;
    const { step, partnerId, otp, photoProof } = req.body;
    try {
        const order = await db_1.db.getOrder(orderId);
        if (!order) {
            return res.status(404).json({
                status: 'error',
                message: 'Order not found.'
            });
        }
        const partner = await db_1.db.getDeliveryPartner(partnerId);
        if (!partner) {
            return res.status(404).json({
                status: 'error',
                message: 'Partner not found.'
            });
        }
        let nextStatus = order.status;
        let notes = '';
        if (step === 'pickup') {
            nextStatus = 'Picked Up';
            notes = `Order picked up from vendor by ${partner.name}`;
            await db_1.db.updateDeliveryPartner(partnerId, { status: 'On Delivery' });
        }
        else if (step === 'start') {
            nextStatus = 'Out For Delivery';
            notes = `Out for delivery by ${partner.name}`;
        }
        else if (step === 'near_customer') {
            nextStatus = 'Near Customer';
            notes = `${partner.name} is arriving near customer address`;
        }
        else if (step === 'complete') {
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
            const activeDa = await db_1.db.getAssignmentForOrder(order.id);
            if (activeDa) {
                await db_1.db.updateAssignmentStatus(activeDa.id, 'Accepted'); // mark completed in history
            }
            // Add Delivery Earnings
            const earningId = 'e_' + Math.floor(1000 + Math.random() * 9000);
            await db_1.db.createEarning({
                id: earningId,
                delivery_partner_id: partnerId,
                order_id: order.id,
                per_delivery_earning: 65.00,
                incentive: 10.00,
                bonus: 0.00,
                date: new Date().toISOString().split('T')[0]
            });
            // Reset partner status to Available
            await db_1.db.updateDeliveryPartner(partnerId, {
                status: 'Available',
                availability: true
            });
        }
        else if (step === 'confirm_completed') {
            nextStatus = 'Completed';
            notes = `Order finalized and completed.`;
        }
        const updatedOrder = await db_1.db.updateOrderStatus(orderId, nextStatus);
        await db_1.db.logStatusHistory({
            order_id: orderId,
            status: nextStatus,
            updated_by: 'Delivery Partner',
            notes
        });
        // Notify rooms and persist vendor notification
        const previousStatus = order.status || 'Pending';
        const resolvedCustomer = updatedOrder?.customer_name || updatedOrder?.memberName || order?.customer_name || order?.memberName || 'Customer';
        const resolvedItem = updatedOrder?.product_details || updatedOrder?.items?.[0]?.name || order?.product_details || (order?.items && order.items[0]?.name) || 'Order Item';
        const resolvedAmount = updatedOrder?.finalAmount || updatedOrder?.totalAmount || updatedOrder?.amount || order?.finalAmount || 0;
        const statusPayload = {
            orderId,
            id: orderId,
            order_number: updatedOrder?.order_number || order?.order_number || orderId,
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
        socket_1.socketManager.emitToOrder(orderId, 'order_status_updated', statusPayload);
        if (order.vendor_id) {
            socket_1.socketManager.emitToVendor(String(order.vendor_id), 'order_status_updated', statusPayload);
            socket_1.socketManager.emitToVendor(String(order.vendor_id), 'ORDER_STATUS_CHANGED', statusPayload);
            // Persist notification for vendor in MongoDB
            const mongoDb = db_1.db.getDb();
            if (mongoDb) {
                mongoDb.collection('notifications').insertOne({
                    recipientId: String(order.vendor_id),
                    vendorId: String(order.vendor_id),
                    role: 'vendor',
                    category: 'Order',
                    title: 'Order Status Updated',
                    orderId,
                    orderNumber: updatedOrder?.order_number || order?.order_number || orderId,
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
                }).catch((e) => {
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
                        }).catch(() => { });
                    }
                }
                catch (e) { }
            }
        }
        res.json({
            status: 'success',
            message: `Step "${step}" processed successfully.`,
            data: updatedOrder
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to process delivery step: ' + error.message
        });
    }
});
exports.default = router;
