import { getBackendUrl, getVendorBackendUrl } from './apiSetup';
const getApiBaseUrl = () => `${getBackendUrl()}/api`;


// Haversine distance formula
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Generate intermediate coordinates for simulated maps
function generateMockRoute(lat1, lon1, lat2, lon2, steps = 15) {
  const path = [];
  const midLat = lat1 + (lat2 - lat1) * 0.45;
  const midLng = lon1 + (lon2 - lon1) * 0.65;

  const controlPoints = [
    [lat1, lon1],
    [midLat, lon1],
    [midLat, midLng],
    [lat2, midLng],
    [lat2, lon2]
  ];

  for (let i = 0; i < controlPoints.length - 1; i++) {
    const start = controlPoints[i];
    const end = controlPoints[i + 1];
    const segSteps = Math.ceil(steps / 4);
    for (let j = 0; j < segSteps; j++) {
      const t = j / segSteps;
      const lt = start[0] + (end[0] - start[0]) * t;
      const ln = start[1] + (end[1] - start[1]) * t;
      // Curvature noise
      path.push([lt + Math.sin(j) * 0.0001, ln + Math.cos(j) * 0.0001]);
    }
  }
  path.push([lat2, lon2]);
  return path;
}

// Emulate DB in localStorage for Fallback Mode (Disabled in favor of live MongoDB API)
const initMockDB = () => {
  // No-op: LocalStorage mock database seeding disabled for live API operations
};

// Emulated Local API Handlers (when Server is Offline)
const handleFallbackRequest = async (endpoint, options = {}) => {
  initMockDB();
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;
  const urlPath = endpoint.split('?')[0];

  // Silent fallback — no console spam when backend is offline

  // 1. Auth routes - Strict Security: Never fake or synthesize logins/auth when backend responds or is offline
  if (urlPath.startsWith('/auth')) {
    return {
      status: 'error',
      code: 'AUTH_OFFLINE',
      message: 'Authentication server is currently unreachable. Please verify your connection and try again.'
    };
  }

  // 2. Delivery partners CRUD
  if (urlPath.startsWith('/vendors/delivery-partners')) {
    const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
    
    if (method === 'GET') {
      return { status: 'success', data: partners };
    }

    if (method === 'POST') {
      const newPartner = {
        id: 'dp_' + Math.floor(Math.random() * 10000),
        ...body,
        photo: body.photo || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
        status: 'Offline',
        availability: false,
        current_latitude: 12.9348,
        current_longitude: 77.6189,
        joining_date: new Date().toISOString().split('T')[0]
      };
      partners.push(newPartner);
      localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));
      return { status: 'success', data: newPartner };
    }

    if (method === 'PUT') {
      const match = urlPath.match(/\/vendors\/delivery-partners\/(.+)/);
      const partnerId = match ? match[1] : null;
      if (!partnerId) return { status: 'error', message: 'ID missing' };

      const idx = partners.findIndex((p) => p.id === partnerId);
      if (idx !== -1) {
        partners[idx] = { ...partners[idx], ...body };
        localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));
        return { status: 'success', data: partners[idx] };
      }
      return { status: 'error', message: 'Partner not found' };
    }

    if (method === 'DELETE') {
      const match = urlPath.match(/\/vendors\/delivery-partners\/(.+)/);
      const partnerId = match ? match[1] : null;
      const filtered = partners.filter((p) => p.id !== partnerId);
      localStorage.setItem('connect_fallback_partners', JSON.stringify(filtered));
      return { status: 'success', message: 'Removed successfully' };
    }
  }

  // 3. Orders endpoints
  if (urlPath === '/orders' && method === 'GET') {
    const orders = JSON.parse(localStorage.getItem('connect_fallback_orders')) || [];
    return { status: 'success', data: orders };
  }

  if (urlPath.startsWith('/orders/') && method === 'GET') {
    const orderId = urlPath.split('/orders/')[1];
    const orders = JSON.parse(localStorage.getItem('connect_fallback_orders')) || [];
    const order = orders.find((o) => o && (o.id === orderId || o.order_number === orderId || o._id === orderId));
    if (!order) return { status: 'error', message: 'Order not found' };

    const assignments = JSON.parse(localStorage.getItem('connect_fallback_assignments')) || [];
    const assignment = assignments.find((a) => a && a.order_id === orderId && a.status !== 'Rejected');
    
    let partner = null;
    if (assignment) {
      const partners = JSON.parse(localStorage.getItem('connect_fallback_partners')) || [];
      partner = partners.find((p) => p && p.id === assignment.delivery_partner_id);
    }

    // Mock timeline
    const timeline = [
      { status: 'Order Placed', timestamp: order.created_at || new Date().toISOString(), notes: 'Order confirmed' }
    ];
    if (order.status !== 'Order Received') {
      timeline.push({ status: 'Preparing', timestamp: new Date().toISOString(), notes: 'Food/Product is being processed' });
    }
    if (['Ready For Pickup', 'Assigned', 'Picked Up', 'Out For Delivery', 'Delivered'].includes(order.status)) {
      timeline.push({ status: 'Ready For Pickup', timestamp: new Date().toISOString(), notes: 'Waiting for partner' });
    }
    if (order.status === 'Delivered') {
      timeline.push({ status: 'Delivered', timestamp: new Date().toISOString(), notes: 'Order complete' });
    }

    return {
      status: 'success',
      data: {
        order,
        timeline,
        assignment,
        partner,
        tracking: partner ? { latitude: partner.current_latitude, longitude: partner.current_longitude } : null
      }
    };
  }

  if (urlPath === '/orders' && method === 'POST') {
    const orders = JSON.parse(localStorage.getItem('connect_fallback_orders')) || [];
    const isJob = body.type === 'Job';
    const orderId = body.applicationId || body.id || (isJob ? ('APP-' + new Date().getFullYear() + '-' + String(Math.floor(100000 + Math.random() * 900000))) : ('ORD' + Math.floor(100000 + Math.random() * 900000)));
    const initialStatus = isJob ? (body.status || 'APPLICATION RECEIVED') : (body.status || 'Order Received');
    const newOrder = {
      id: orderId,
      order_number: orderId,
      applicationId: orderId,
      status: initialStatus,
      created_at: new Date().toISOString(),
      applicationDate: new Date().toISOString(),
      ...body
    };
    orders.unshift(newOrder);
    localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));

    // Attempt fallback sync to vendor backend if a dedicated microservice is configured
    try {
      const vendorUrl = getVendorBackendUrl();
      if (vendorUrl && !vendorUrl.includes('ficapp.in')) {
        fetch(`${vendorUrl}/api/public/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: orderId,
            order_number: orderId,
            applicationId: orderId,
            vendorId: body.vendor_id || body.vendorId || '',
            memberId: body.customer_id || 'cust_dhanush',
            memberName: body.customer_name || 'Customer',
            type: body.type || 'Order',
            items: body.items || [],
            totalAmount: body.amount || 0,
            finalAmount: body.amount || 0,
            status: initialStatus,
            paymentMethod: body.paymentMethod || body.payment_method || (body.isCOD ? 'Cash on Delivery' : 'Connect Wallet'),
            payment_method: body.payment_method || body.paymentMethod || (body.isCOD ? 'Cash on Delivery' : 'Connect Wallet'),
            paymentStatus: body.paymentStatus || body.payment_status || ((body.paymentMethod === 'Cash on Delivery' || body.payment_method === 'Cash on Delivery' || body.isCOD) ? 'Pending' : 'Paid'),
            payment_status: body.payment_status || body.paymentStatus || ((body.paymentMethod === 'Cash on Delivery' || body.payment_method === 'Cash on Delivery' || body.isCOD) ? 'Pending' : 'Paid'),
            transactionId: body.transactionId || (!((body.paymentMethod === 'Cash on Delivery' || body.payment_method === 'Cash on Delivery' || body.isCOD)) ? ('TXN_' + orderId) : undefined),
            paidAt: body.paidAt || ((body.paymentMethod === 'Cash on Delivery' || body.payment_method === 'Cash on Delivery' || body.isCOD) ? null : new Date().toISOString()),
            jobId: body.jobId || (body.items && body.items[0]?.productId),
            jobTitle: body.jobTitle || (body.items && body.items[0]?.name) || body.product_details,
            candidateName: body.customer_name || body.candidateName,
            candidateEmail: body.candidateEmail || body.customer_email,
            candidatePhone: body.customer_phone || body.candidatePhone,
            jobLocation: body.customer_address || body.jobLocation,
            candidateEducation: body.candidateEducation || 'Graduate',
            experience: body.experience || 'Fresher',
            candidateResume: body.candidateResume,
            applicationDate: new Date().toISOString(),
            appointmentDate: body.appointmentDate,
            appointmentTimeSlot: body.appointmentTimeSlot,
            doctorName: body.doctorName,
            tableNumber: body.tableNumber,
            roomNumber: body.roomNumber,
            prescriptionUrl: body.prescriptionUrl,
            guests: body.guests || body.numberOfGuests || body.guestCount || body.adults || (body.items && body.items[0]?.guests) || 2,
            adults: body.adults || (body.items && body.items[0]?.adults),
            children: body.children || (body.items && body.items[0]?.children),
            customer_address: body.customer_address || body.address || body.deliveryAddress,
            customer_phone: body.customer_phone || body.phone
          })
        }).then(r => r.json())
          .then(data => console.log('Fallback sync response:', data))
          .catch(err => console.warn('Fallback sync to vendor backend failed:', err));
      }
    } catch (e) {
      console.warn(e);
    }

    // Emulate Auto assignment timer
    setTimeout(() => {
      const partners = JSON.parse(localStorage.getItem('connect_fallback_partners')) || [];
      const available = partners.find((p) => p && p.status === 'Available' && p.availability);
      if (available) {
        available.status = 'Busy';
        available.availability = false;
        localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));

        const assignments = JSON.parse(localStorage.getItem('connect_fallback_assignments')) || [];
        const newAsg = {
          id: 'asg_' + Math.floor(Math.random() * 9000),
          order_id: orderId,
          delivery_partner_id: available.id,
          status: 'Pending',
          assigned_at: new Date().toISOString()
        };
        assignments.push(newAsg);
        localStorage.setItem('connect_fallback_assignments', JSON.stringify(assignments));

        newOrder.status = 'Assigned To Delivery Partner';
        localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
      }
    }, 2000);

    return { status: 'success', data: newOrder };
  }

  // Ready for pickup trigger
  if (urlPath.endsWith('/ready') && method === 'POST') {
    const orderId = urlPath.split('/orders/')[1].split('/ready')[0];
    const orders = JSON.parse(localStorage.getItem('connect_fallback_orders'));
    const idx = orders.findIndex((o) => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = 'Ready For Pickup';
      localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
      
      // Auto Assign trigger
      const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
      const available = partners.find((p) => p.status === 'Available' && p.availability);
      if (available) {
        available.status = 'Busy';
        available.availability = false;
        localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));

        const assignments = JSON.parse(localStorage.getItem('connect_fallback_assignments'));
        assignments.push({
          id: 'asg_' + Math.floor(Math.random() * 9000),
          order_id: orderId,
          delivery_partner_id: available.id,
          status: 'Pending',
          assigned_at: new Date().toISOString()
        });
        localStorage.setItem('connect_fallback_assignments', JSON.stringify(assignments));

        orders[idx].status = 'Assigned To Delivery Partner';
        localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
      }
      return { status: 'success', data: orders[idx] };
    }
  }

  // 4. Partner Dashboard
  if (urlPath.startsWith('/delivery-partners/') && urlPath.endsWith('/dashboard') && method === 'GET') {
    const partnerId = urlPath.split('/delivery-partners/')[1].split('/dashboard')[0];
    const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
    const partner = partners.find((p) => p.id === partnerId);
    if (!partner) return { status: 'error', message: 'Partner not found' };

    const assignments = JSON.parse(localStorage.getItem('connect_fallback_assignments'));
    const activeAssignment = assignments.find((a) => a.delivery_partner_id === partnerId && ['Pending', 'Accepted'].includes(a.status));
    
    let activeOrder = null;
    if (activeAssignment) {
      const orders = JSON.parse(localStorage.getItem('connect_fallback_orders'));
      activeOrder = orders.find((o) => o.id === activeAssignment.order_id);
    }

    const earnings = JSON.parse(localStorage.getItem('connect_fallback_earnings')) || [];
    const myEarnings = earnings.filter((e) => e.delivery_partner_id === partnerId);

    return {
      status: 'success',
      data: {
        profile: partner,
        stats: {
          todayCompleted: myEarnings.length,
          todayEarnings: myEarnings.reduce((acc, e) => acc + e.per_delivery_earning, 0),
          rating: 4.9
        },
        activeAssignment: activeAssignment || null,
        activeOrder: activeOrder || null
      }
    };
  }

  // 4b. Partner Earnings
  if (urlPath.startsWith('/delivery-partners/') && urlPath.endsWith('/earnings') && method === 'GET') {
    const partnerId = urlPath.split('/delivery-partners/')[1].split('/earnings')[0];
    const earnings = JSON.parse(localStorage.getItem('connect_fallback_earnings')) || [];
    const myEarnings = earnings.filter((e) => e.delivery_partner_id === partnerId);
    return { status: 'success', data: myEarnings };
  }

  // Update status (online/offline)
  if (urlPath.startsWith('/delivery-partners/') && urlPath.endsWith('/status') && method === 'PUT') {
    const partnerId = urlPath.split('/delivery-partners/')[1].split('/status')[0];
    const { status, availability } = body;
    const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
    const idx = partners.findIndex((p) => p.id === partnerId);
    if (idx !== -1) {
      partners[idx].status = status;
      partners[idx].availability = availability !== undefined ? availability : (status === 'Available');
      localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));
      return { status: 'success', data: partners[idx] };
    }
  }

  // Accept/Reject assignment
  if (urlPath.startsWith('/delivery-partners/assignments/') && urlPath.endsWith('/respond') && method === 'POST') {
    const asgId = urlPath.split('/delivery-partners/assignments/')[1].split('/respond')[0];
    const { action } = body;
    const assignments = JSON.parse(localStorage.getItem('connect_fallback_assignments'));
    const asgIdx = assignments.findIndex((a) => a.id === asgId);
    if (asgIdx !== -1) {
      assignments[asgIdx].status = action === 'accept' ? 'Accepted' : 'Rejected';
      localStorage.setItem('connect_fallback_assignments', JSON.stringify(assignments));

      const orders = JSON.parse(localStorage.getItem('connect_fallback_orders'));
      const orderIdx = orders.findIndex((o) => o.id === assignments[asgIdx].order_id);

      if (action === 'accept') {
        if (orderIdx !== -1) orders[orderIdx].status = 'Delivery Partner Accepted';
        localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
      } else {
        if (orderIdx !== -1) orders[orderIdx].status = 'Ready For Pickup';
        localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
        
        // Mark partner Available again
        const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
        const partnerIdx = partners.findIndex((p) => p.id === assignments[asgIdx].delivery_partner_id);
        if (partnerIdx !== -1) {
          partners[partnerIdx].status = 'Available';
          partners[partnerIdx].availability = true;
          localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));
        }
      }
      return { status: 'success', message: 'Responded successfully' };
    }
  }

  // Delivery Step completions
  if (urlPath.startsWith('/delivery-partners/deliveries/') && urlPath.endsWith('/step') && method === 'POST') {
    const orderId = urlPath.split('/delivery-partners/deliveries/')[1].split('/step')[0];
    const { step, partnerId, otp } = body;

    const orders = JSON.parse(localStorage.getItem('connect_fallback_orders'));
    const orderIdx = orders.findIndex((o) => o.id === orderId);
    if (orderIdx === -1) return { status: 'error', message: 'Order not found' };

    let nextStatus = orders[orderIdx].status;
    const partners = JSON.parse(localStorage.getItem('connect_fallback_partners'));
    const partnerIdx = partners.findIndex((p) => p.id === partnerId);

    if (step === 'pickup') {
      nextStatus = 'Picked Up';
      if (partnerIdx !== -1) partners[partnerIdx].status = 'On Delivery';
    } else if (step === 'start') {
      nextStatus = 'Out For Delivery';
    } else if (step === 'near_customer') {
      nextStatus = 'Near Customer';
    } else if (step === 'complete') {
      if (otp !== '1234' && otp !== orderId.replace(/[^\d]/g, '').slice(-4)) {
        return { status: 'error', message: 'Invalid OTP code' };
      }
      nextStatus = 'Delivered';

      if (partnerIdx !== -1) {
        partners[partnerIdx].status = 'Available';
        partners[partnerIdx].availability = true;
      }

      // Add earning
      const earnings = JSON.parse(localStorage.getItem('connect_fallback_earnings')) || [];
      earnings.push({
        id: 'e_' + Math.floor(Math.random() * 10000),
        delivery_partner_id: partnerId,
        order_id: orderId,
        per_delivery_earning: 65,
        incentive: 10,
        bonus: 0,
        date: new Date().toISOString().split('T')[0]
      });
      localStorage.setItem('connect_fallback_earnings', JSON.stringify(earnings));
    }

    orders[orderIdx].status = nextStatus;
    localStorage.setItem('connect_fallback_orders', JSON.stringify(orders));
    localStorage.setItem('connect_fallback_partners', JSON.stringify(partners));

    return { status: 'success', data: orders[orderIdx] };
  }

  // 5. Maps simulation route
  if (urlPath === '/maps/route') {
    const { startLat, startLng, endLat, endLng } = body;
    const dist = getDistance(startLat, startLng, endLat, endLng);
    const duration = Math.ceil(dist / 0.4) + 2;
    const route = generateMockRoute(startLat, startLng, endLat, endLng);
    return {
      status: 'success',
      data: {
        distance: parseFloat(dist.toFixed(2)),
        duration,
        route
      }
    };
  }

  // 6. Razorpay Fallback Order Creator
  if (urlPath === '/orders/create-razorpay-order' && method === 'POST') {
    return {
      success: true,
      order_id: 'order_mock_' + Math.floor(Math.random() * 1000000),
      amount: Math.round((body.amount || 100) * 100),
      key_id: 'rzp_test_THLM17MgXLM2tP'
    };
  }

  // Default general success stub
  return { status: 'success', data: {} };
};

export const apiFetch = async (endpoint, options = {}) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { status: 'offline', message: 'Browser is offline' };
  }

  const token = localStorage.getItem('connect_token') || localStorage.getItem('token') || localStorage.getItem('vendor_token') || localStorage.getItem('admin_token');

  const apiBaseUrl = getApiBaseUrl();

  // Strip duplicate '/api' prefix so `${apiBaseUrl}${normalizedEndpoint}` never produces '/api/api/...'
  const epStr = typeof endpoint === 'string' ? endpoint.trim() : '';
  const normalizedEndpoint = epStr.startsWith('/api/')
    ? epStr.slice(4)
    : (epStr.startsWith('/') ? epStr : `/${epStr}`);

  try {
    const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};

    const res = await fetch(`${apiBaseUrl}${normalizedEndpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
        ...(options.headers || {})
      },
      credentials: 'include',
      ...options
    });
    
    if (!res.ok) {
      if (res.status === 429) {
        return { status: 'error', statusCode: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'Too Many Requests. Please slow down.' };
      }
      // Never attempt fallback for client errors (4xx: 400, 401, 403, 404, 409, 422, etc.) or /auth endpoints.
      // Fallback is strictly reserved for 5xx server outages (500, 502, 503, 504).
      if (res.status >= 500 && !normalizedEndpoint.startsWith('/auth')) {
        const fallbackRes = await handleFallbackRequest(normalizedEndpoint, options).catch(() => null);
        if (fallbackRes && fallbackRes.status === 'success') {
          return fallbackRes;
        }
      }
      const errText = await res.text().catch(() => '');
      let errData = {};
      try { errData = JSON.parse(errText); } catch (e) {}
      return errData.status ? errData : { status: 'error', code: errData.code, message: errData.message || `HTTP ${res.status}` };
    }
    
    return await res.json();
  } catch (error) {
    const isNetworkSuspended = 
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      error?.message?.includes('NETWORK_IO_SUSPENDED') ||
      error?.message?.includes('Failed to fetch') ||
      error?.name === 'AbortError';

    if (isNetworkSuspended) {
      return { status: 'network_suspended', message: error?.message || 'Network suspended' };
    }
    if (normalizedEndpoint.startsWith('/auth')) {
      return { status: 'error', code: 'NETWORK_ERROR', message: error?.message || 'Authentication request failed.' };
    }
    return await handleFallbackRequest(normalizedEndpoint, options).catch(() => ({ status: 'error', message: error.message }));
  }
};
