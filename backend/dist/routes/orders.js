"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDummyVendor = void 0;
exports.extractVendorTravelPoints = extractVendorTravelPoints;
exports.runAutoAssignment = runAutoAssignment;
exports.resolveProductOwnerVendor = resolveProductOwnerVendor;
const s3_1 = require("../s3");
const express_1 = require("express");
const db_1 = require("../db");
const socket_1 = require("../socket");
const mongodb_1 = require("mongodb");
const razorpay_1 = __importDefault(require("razorpay"));
const realtime_1 = require("../realtime");
const fcmPushService_1 = require("../services/fcmPushService");
const securityManager_1 = require("../security/securityManager");
const middleware_1 = require("../security/middleware");
const router = (0, express_1.Router)();
function extractVendorTravelPoints(item) {
    if (!item)
        return { boardingPoints: [], droppingPoints: [] };
    const parsePoints = (rawSingle, rawList, rawStoppings, defaultTime = '', isBoarding = true) => {
        const points = [];
        const seen = new Set();
        const addPoint = (val, time = '', landmark = '', id) => {
            if (!val || typeof val !== 'string')
                return;
            const clean = val.trim();
            if (!clean)
                return;
            if (clean.includes(',') || clean.includes('\n')) {
                const parts = clean.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
                for (const p of parts)
                    addPoint(p, time, landmark, id);
                return;
            }
            const lower = clean.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                const finalTime = (time || defaultTime || '').trim();
                points.push({
                    id,
                    name: clean,
                    departureTime: isBoarding ? finalTime : undefined,
                    arrivalTime: !isBoarding ? finalTime : undefined,
                    time: finalTime,
                    landmark: (landmark || '').trim()
                });
            }
        };
        // Priority 1: Configured repeatable list from vendor route
        if (Array.isArray(rawList) && rawList.length > 0) {
            rawList.forEach(entry => {
                if (typeof entry === 'string') {
                    addPoint(entry, defaultTime);
                }
                else if (entry && typeof entry === 'object' && entry.active !== false) {
                    const name = entry.name || entry.point || entry.location || entry.stopName || entry.title || '';
                    const time = entry.departureTime || entry.arrivalTime || entry.time || entry.timing || defaultTime || '';
                    const landmark = entry.landmark || entry.address || '';
                    const id = entry.id || entry._id || undefined;
                    addPoint(name, time, landmark, id);
                }
            });
            return points;
        }
        // Priority 2: Fallback to legacy single point
        if (typeof rawSingle === 'string' && rawSingle.trim()) {
            addPoint(rawSingle, defaultTime);
        }
        else if (rawSingle && typeof rawSingle === 'object') {
            const timeVal = rawSingle.departureTime || rawSingle.arrivalTime || rawSingle.time || defaultTime;
            addPoint(rawSingle.name || rawSingle.point, timeVal, rawSingle.landmark || '', rawSingle.id);
        }
        // Priority 3: Fallback to route stoppings
        if (points.length === 0 && Array.isArray(rawStoppings) && rawStoppings.length > 0) {
            rawStoppings.forEach(stop => {
                if (typeof stop === 'string') {
                    addPoint(stop);
                }
                else if (stop && typeof stop === 'object') {
                    addPoint(stop.stopName || stop.name || stop.location, stop.time || '', '', stop.id);
                }
            });
        }
        return points;
    };
    const boardingPoints = parsePoints(item.boardingPoint || item.boarding_point || item.pickupPoint || item.pickup_point, item.boardingPoints || item.boarding_points || item.pickupPoints || item.pickup_points, null, item.boardingTime || item.busTiming || '', true);
    const droppingPoints = parsePoints(item.dropPoint || item.drop_point || item.droppingPoint || item.dropping_point || item.destination, item.droppingPoints || item.dropping_points || item.dropPoints || item.drop_points, null, item.arrivalTime || '', false);
    return { boardingPoints, droppingPoints };
}
// Distance utility function (Haversine formula in km)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
// Auto Assignment Logistics Logic
async function runAutoAssignment(orderId) {
    const order = await db_1.db.getOrder(orderId);
    if (!order)
        return null;
    console.log(`[AutoAssign]: Starting auto-assignment for Order #${order.order_number}`);
    // Default Vendor coordinates (center of search)
    const vendorLat = 12.9348;
    const vendorLng = 77.6189;
    // 1. Fetch available partners belonging to the SAME vendor
    const partners = await db_1.db.getDeliveryPartners(order.vendor_id);
    const availablePartners = partners.filter(p => p.status === 'Available' && p.availability === true);
    console.log(`[AutoAssign]: Found ${availablePartners.length} online, available partners for vendor ${order.vendor_id}`);
    if (availablePartners.length === 0) {
        console.log(`[AutoAssign]: No partners available. Queuing order and notifying vendor.`);
        // Notify vendor
        socket_1.socketManager.emitToVendor(order.vendor_id, 'no_partners_available', {
            orderId: order.id,
            orderNumber: order.order_number,
            message: 'No available delivery partners are online. Order has been queued.'
        });
        return null;
    }
    // 2. Calculate distance between vendor and partner coordinates
    const partnersWithDistance = availablePartners.map(p => {
        // If partner doesn't have coordinates, default to vendor location
        const lat = p.current_latitude || vendorLat;
        const lng = p.current_longitude || vendorLng;
        const distance = calculateDistance(vendorLat, vendorLng, lat, lng);
        return { partner: p, distance };
    });
    // 3. Sort by nearest distance
    partnersWithDistance.sort((a, b) => a.distance - b.distance);
    const nearest = partnersWithDistance[0];
    console.log(`[AutoAssign]: Nearest partner is ${nearest.partner.name} at a distance of ${nearest.distance.toFixed(2)} km`);
    // 4. Assign Automatically
    const partner = nearest.partner;
    const assignmentId = 'asg_' + Math.floor(1000 + Math.random() * 9000);
    const assignment = {
        id: assignmentId,
        order_id: order.id,
        delivery_partner_id: partner.id,
        status: 'Pending',
        assigned_at: new Date().toISOString()
    };
    await db_1.db.createAssignment(assignment);
    // Update order status to Assigned To Delivery Partner
    await db_1.db.updateOrderStatus(order.id, 'Assigned To Delivery Partner');
    await db_1.db.logStatusHistory({
        order_id: order.id,
        status: 'Assigned To Delivery Partner',
        updated_by: 'System',
        notes: `Automatically assigned closest partner: ${partner.name} (${nearest.distance.toFixed(2)} km away)`
    });
    // Set partner status to Busy temporarily while assignment is pending acceptance
    await db_1.db.updateDeliveryPartner(partner.id, {
        status: 'Busy',
        availability: false
    });
    // 5. Notify Delivery Partner via socket
    socket_1.socketManager.emitToUser('delivery', partner.id, 'order_assigned', {
        assignmentId,
        order,
        distance: nearest.distance
    });
    // Notify vendor
    socket_1.socketManager.emitToVendor(order.vendor_id, 'order_assigned', {
        orderId: order.id,
        partnerId: partner.id,
        partnerName: partner.name,
        distance: nearest.distance
    });
    // Notify customer
    socket_1.socketManager.emitToOrder(order.id, 'order_status_updated', {
        status: 'Assigned To Delivery Partner',
        partner: {
            id: partner.id,
            name: partner.name,
            photo: partner.photo,
            mobile: partner.mobile
        }
    });
    return partner;
}
// GET: /api/orders (Authoritative IDOR protection: Customers may only view their own orders)
router.get('/', middleware_1.optionalAuthenticateToken, async (req, res) => {
    const vendorId = req.query.vendorId;
    let customerId = (req.query.customerId || '').trim();
    const authUser = req.user;
    if (!authUser && !customerId && !vendorId) {
        return res.status(401).json({
            status: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required to access orders.'
        });
    }
    // IDOR Protection: If requester is authenticated
    let targetCustomerIds = customerId;
    if (authUser) {
        if (authUser.role === 'customer') {
            const allowedIds = [
                authUser.userId,
                authUser.customerId,
                authUser.registrationId,
                authUser.id,
                authUser._id,
                authUser.customer_id,
                authUser.phone,
                authUser.email
            ].filter(Boolean).map((s) => String(s).toLowerCase().trim());
            const mongoDb = db_1.db.getDb();
            let userDbDoc = null;
            if (mongoDb) {
                const userOrConditions = [
                    { id: authUser.userId },
                    { _id: authUser.userId },
                    { email: (authUser.email || '').toLowerCase().trim() },
                    { customerId: authUser.customerId || authUser.userId }
                ];
                if (mongodb_1.ObjectId.isValid(authUser.userId)) {
                    try {
                        userOrConditions.push({ _id: new mongodb_1.ObjectId(authUser.userId) });
                    }
                    catch (e) { }
                }
                userDbDoc = await mongoDb.collection('users').findOne({ $or: userOrConditions });
                if (!userDbDoc) {
                    userDbDoc = await mongoDb.collection('customers').findOne({ $or: userOrConditions });
                }
            }
            if (userDbDoc) {
                [
                    userDbDoc._id,
                    userDbDoc.id,
                    userDbDoc.customerId,
                    userDbDoc.registrationId,
                    userDbDoc.email,
                    userDbDoc.phone
                ].filter(Boolean).forEach((v) => {
                    allowedIds.push(String(v).toLowerCase().trim());
                });
            }
            const userPhoneDigits = (userDbDoc?.phone || authUser.phone || '').replace(/\D/g, '');
            if (userPhoneDigits && userPhoneDigits.length >= 10) {
                allowedIds.push(userPhoneDigits.slice(-10));
                allowedIds.push(`+91${userPhoneDigits.slice(-10)}`);
            }
            if (customerId && !allowedIds.includes(customerId.toLowerCase().trim())) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Access denied: You cannot view orders belonging to another customer account.'
                });
            }
            const searchCustIds = [
                customerId,
                userDbDoc?.customerId,
                userDbDoc?.registrationId,
                userDbDoc?.id,
                userDbDoc?._id?.toString(),
                userDbDoc?.email,
                userDbDoc?.phone,
                authUser.customerId,
                authUser.userId,
                authUser.email,
                authUser.phone
            ].filter(Boolean);
            targetCustomerIds = Array.from(new Set(searchCustIds));
        }
        else if (authUser.role === 'vendor') {
            if (vendorId && vendorId !== authUser.vendorId && authUser.vendorId) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Access denied: You cannot view orders belonging to another vendor.'
                });
            }
        }
        else if (!['admin', 'superadmin', 'delivery'].includes(authUser.role)) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied: Unauthorized role for orders access.'
            });
        }
    }
    try {
        const orders = await db_1.db.getOrders(vendorId, targetCustomerIds);
        res.json({
            status: 'success',
            data: orders
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve orders: ' + error.message
        });
    }
});
// GET: /api/orders/:id (Authoritative IDOR protection: Non-admins can only view their own order)
router.get('/:id', middleware_1.authenticateToken, async (req, res) => {
    const { id } = req.params;
    const authUser = req.user;
    if (!authUser) {
        return res.status(401).json({
            status: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required to view order details.'
        });
    }
    try {
        const order = await db_1.db.getOrder(id);
        if (!order) {
            return res.status(404).json({
                status: 'error',
                message: 'Order not found.'
            });
        }
        // IDOR Protection: Customers may only view their own order
        if (authUser.role === 'customer') {
            const selfCustId = authUser.customerId || authUser.userId || authUser.registrationId;
            const orderCustId = order.customer_id || order.customerId;
            const orderEmail = (order.customer_email || '').toLowerCase().trim();
            const authEmail = (authUser.email || '').toLowerCase().trim();
            const isMatch = (orderCustId && (orderCustId === selfCustId || orderCustId === authUser.userId)) ||
                (orderEmail && authEmail && orderEmail === authEmail);
            if (!isMatch) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Access denied: You do not have permission to view this order.'
                });
            }
        }
        else if (authUser.role === 'vendor') {
            if (order.vendor_id && authUser.vendorId && order.vendor_id !== authUser.vendorId) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Access denied: You do not have permission to view this order.'
                });
            }
        }
        else if (!['admin', 'superadmin', 'delivery'].includes(authUser.role)) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied: Unauthorized role for order details.'
            });
        }
        const timeline = await db_1.db.getStatusHistory(id);
        const assignment = await db_1.db.getAssignmentForOrder(id);
        let partner = null;
        let tracking = null;
        if (assignment) {
            partner = await db_1.db.getDeliveryPartner(assignment.delivery_partner_id);
            tracking = await db_1.db.getLatestTracking(id);
        }
        res.json({
            status: 'success',
            data: {
                order,
                timeline,
                assignment,
                partner,
                tracking
            }
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve order details: ' + error.message
        });
    }
});
// Razorpay Order Creation Endpoint (Protected with paymentRateLimiter)
router.post('/create-razorpay-order', middleware_1.paymentRateLimiter, async (req, res) => {
    try {
        const { amount } = req.body;
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            console.error('[Razorpay Error]: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET environment variable is missing.');
            return res.status(503).json({
                success: false,
                code: 'PAYMENT_CONFIG_MISSING',
                error: 'Razorpay payment gateway credentials are not configured on this server.'
            });
        }
        const instance = new razorpay_1.default({
            key_id: keyId,
            key_secret: keySecret,
        });
        const parsedAmount = Math.round((Number(amount) || 1) * 100);
        const options = {
            amount: parsedAmount,
            currency: "INR",
            receipt: "receipt_order_" + Math.floor(Math.random() * 1000000),
        };
        try {
            const order = await instance.orders.create(options);
            return res.json({ success: true, order_id: order.id, amount: options.amount, key_id: keyId });
        }
        catch (sdkError) {
            const errMsg = sdkError?.error?.description || sdkError?.message || 'Razorpay order creation failed';
            console.error('[Razorpay Error]: Order initialization failed:', errMsg);
            if (process.env.NODE_ENV === 'production') {
                return res.status(502).json({
                    success: false,
                    code: 'PAYMENT_GATEWAY_ERROR',
                    error: `Razorpay rejected order creation: ${errMsg}`
                });
            }
            // Non-production sandbox fallback only
            console.warn('[Razorpay Warning]: Using dev sandbox order fallback in non-production environment');
            return res.json({
                success: true,
                order_id: 'order_test_' + Math.floor(Math.random() * 1000000),
                amount: options.amount,
                key_id: keyId,
                isTestMode: true
            });
        }
    }
    catch (error) {
        console.error('[Razorpay Error]: Internal error in Razorpay order creation:', error?.message || error);
        res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            error: 'An internal error occurred while initializing payment.'
        });
    }
});
// Razorpay Dynamic UPI QR Code Creation Endpoint
router.post('/create-razorpay-qr', middleware_1.paymentRateLimiter, async (req, res) => {
    try {
        const { amount, name, description } = req.body;
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            return res.status(503).json({
                success: false,
                code: 'PAYMENT_CONFIG_MISSING',
                error: 'Razorpay credentials not configured.'
            });
        }
        const instance = new razorpay_1.default({ key_id: keyId, key_secret: keySecret });
        const parsedAmount = Math.round((Number(amount) || 1) * 100);
        try {
            // Attempt Razorpay QR Code API
            const qrResponse = await instance.qrCode.create({
                type: 'upi_qr',
                name: name || 'Connect App Order',
                usage: 'single_use',
                fixed_amount: true,
                payment_amount: parsedAmount,
                description: description || 'Payment for Connect App Order'
            });
            return res.json({
                success: true,
                qr_id: qrResponse.id,
                image_url: qrResponse.image_url,
                qr_string: qrResponse.payload || qrResponse.qr_string || '',
                amount: parsedAmount,
                status: qrResponse.status
            });
        }
        catch (sdkError) {
            const errMsg = sdkError?.error?.description || sdkError?.message || 'QR creation failed';
            console.warn('[Razorpay QR Warning]: Gateway QR API unavailable or requires merchant activation:', errMsg);
            // Construct standard verified UPI payment intent string for test/sandbox mode
            const merchantVpa = 'connectapp@razorpay';
            const orderRef = 'ORD_QR_' + Date.now();
            const upiIntentString = `upi://pay?pa=${merchantVpa}&pn=ConnectApp&am=${(parsedAmount / 100).toFixed(2)}&cu=INR&tr=${orderRef}&tn=${encodeURIComponent(name || 'Connect Order')}`;
            return res.json({
                success: true,
                qr_id: 'qr_test_' + Date.now(),
                image_url: '',
                qr_string: upiIntentString,
                amount: parsedAmount,
                merchant_vpa: merchantVpa,
                isTestMode: true,
                message: 'Gateway QR fallback generated. Real-time verification requires live QR API permissions.'
            });
        }
    }
    catch (error) {
        console.error('[Razorpay QR Error]:', error?.message || error);
        res.status(500).json({ success: false, error: 'Failed to create QR code' });
    }
});
// Throttled logging for vendor backend order synchronization
let lastVendorSyncErrorTime = 0;
let suppressedVendorSyncErrors = 0;
function logVendorSyncThrottled(msg) {
    const now = Date.now();
    if (now - lastVendorSyncErrorTime > 60000) {
        if (suppressedVendorSyncErrors > 0) {
            console.warn(`[Sync Order Warning]: (Suppressed ${suppressedVendorSyncErrors} repeated warnings) ${msg}`);
        }
        else {
            console.warn(`[Sync Order Warning]: ${msg}`);
        }
        lastVendorSyncErrorTime = now;
        suppressedVendorSyncErrors = 0;
    }
    else {
        suppressedVendorSyncErrors++;
    }
}
// Check if an ID is a dummy / mock placeholder that must never be used
const isDummyVendor = (id) => {
    if (!id)
        return true;
    const s = String(id).trim().toLowerCase();
    return ['v1', '3w8hhon38mqg7ni0u', 'vendor_job', 'undefined', 'null', 'v_prod_mock'].includes(s);
};
exports.isDummyVendor = isDummyVendor;
// Authoritatively resolve product owner vendor from database catalog
async function resolveProductOwnerVendor(mongoDb, item, fallbackVendorId) {
    if (!mongoDb)
        return { vendorId: (0, exports.isDummyVendor)(fallbackVendorId) ? '' : String(fallbackVendorId || ''), productDoc: null };
    const prodId = item?.productId || item?.id || item?._id || item?.jobId || item?.job_id;
    const prodName = item?.name || item?.title || item?.product_details || item?.jobTitle;
    const itemVendor = item?.vendorId || item?.vendor_id;
    if (itemVendor && !(0, exports.isDummyVendor)(itemVendor)) {
        return { vendorId: String(itemVendor), productDoc: null };
    }
    let productDoc = null;
    if (prodId) {
        const q = [{ id: String(prodId) }, { _id: String(prodId) }];
        try {
            if (mongodb_1.ObjectId.isValid(String(prodId))) {
                q.push({ _id: new mongodb_1.ObjectId(String(prodId)) });
            }
        }
        catch (e) { }
        productDoc = await mongoDb.collection('products').findOne({ $or: q });
    }
    if (!productDoc && prodName) {
        const cleanStr = String(prodName).trim();
        const safeRegex = new RegExp('^' + cleanStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
        productDoc = await mongoDb.collection('products').findOne({
            $or: [
                { name: prodName },
                { title: prodName },
                { name: safeRegex },
                { title: safeRegex }
            ]
        });
        if (!productDoc && cleanStr.includes('(')) {
            const baseName = cleanStr.replace(/\s*\([^)]*\).*$/, '').trim();
            if (baseName) {
                const baseSafeRegex = new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
                productDoc = await mongoDb.collection('products').findOne({
                    $or: [
                        { name: baseName },
                        { title: baseName },
                        { name: baseSafeRegex },
                        { title: baseSafeRegex }
                    ]
                });
            }
        }
    }
    const dbVendor = productDoc?.vendorId || productDoc?.vendor_id || '';
    if (dbVendor && !(0, exports.isDummyVendor)(dbVendor)) {
        return { vendorId: String(dbVendor), productDoc };
    }
    if (fallbackVendorId && !(0, exports.isDummyVendor)(fallbackVendorId)) {
        return { vendorId: String(fallbackVendorId), productDoc };
    }
    return { vendorId: '', productDoc };
}
async function forwardOrderToVendorBackend(order, syncPayload) {
    try {
        if (process.env.ENABLE_VENDOR_SYNC === 'false')
            return;
        const vendorUrlRaw = process.env.VENDOR_BACKEND_URL || process.env.VENDOR_API_URL || 'http://127.0.0.1:8002';
        let vendorUrl;
        try {
            vendorUrl = new URL('/api/public/orders', vendorUrlRaw);
        }
        catch {
            vendorUrl = new URL('http://127.0.0.1:8002/api/public/orders');
        }
        const client = vendorUrl.protocol === 'https:' ? require('https') : require('http');
        const syncData = JSON.stringify(syncPayload);
        const reqPost = client.request({
            protocol: vendorUrl.protocol,
            hostname: vendorUrl.hostname,
            port: vendorUrl.port || (vendorUrl.protocol === 'https:' ? 443 : 80),
            path: vendorUrl.pathname + vendorUrl.search,
            method: 'POST',
            timeout: 4000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(syncData)
            }
        }, (resPost) => {
            let respData = '';
            resPost.on('data', (d) => { respData += d.toString(); });
            resPost.on('end', () => {
                if (resPost.statusCode >= 200 && resPost.statusCode < 300) {
                    console.log(`[Sync Order ${order.id}]: Vendor backend accepted order for vendor ${order.vendor_id}.`);
                }
                else {
                    logVendorSyncThrottled(`Vendor backend (${vendorUrl.origin}) returned status ${resPost.statusCode}: ${respData.slice(0, 100)}`);
                }
            });
        });
        reqPost.on('timeout', () => { reqPost.destroy(new Error('Connection timed out')); });
        reqPost.on('error', (e) => {
            logVendorSyncThrottled(`Failed to forward order to vendor backend (${vendorUrl.origin}): ${e.message}`);
        });
        reqPost.write(syncData);
        reqPost.end();
    }
    catch (err) {
        logVendorSyncThrottled(err.message);
    }
}
// POST: /api/orders
router.post('/', middleware_1.optionalAuthenticateToken, async (req, res) => {
    let { vendor_id, customer_id, customerId, customer_email, customer_name, customer_phone, customer_address, product_details, amount, customer_latitude, customer_longitude, type, appointmentDate, appointmentTimeSlot, doctorName, tableNumber, roomNumber, prescriptionUrl, candidateEmail, candidateResume, items, experience, candidateEducation, memberId, boardingPoint, droppingPoint, adults, children, guestDetails, checkInDate, checkInTime, checkOutDate, checkOutTime, guestList, vehicleDetails, roomsCount, nightsCount, specialRequests, paymentMethod, payment_method, paymentStatus, payment_status, transactionId, paidAt, paymentId } = req.body;
    // Upload candidate resume to AWS S3 if provided as base64 data URI
    if (candidateResume && typeof candidateResume === 'string' && candidateResume.startsWith('data:')) {
        try {
            const s3Res = await (0, s3_1.uploadToS3)(candidateResume, 'resumes', 'candidate_resume.pdf');
            if (s3Res && s3Res.success && s3Res.url) {
                candidateResume = s3Res.url;
            }
        }
        catch (uploadErr) {
            console.error('[Candidate Resume S3 Upload Warning]:', uploadErr?.message);
        }
    }
    // Upload prescription document to AWS S3 if provided as base64 data URI
    if (prescriptionUrl && typeof prescriptionUrl === 'string' && prescriptionUrl.startsWith('data:')) {
        try {
            const s3Res = await (0, s3_1.uploadToS3)(prescriptionUrl, 'prescriptions', 'prescription.jpg');
            if (s3Res && s3Res.success && s3Res.url) {
                prescriptionUrl = s3Res.url;
            }
        }
        catch (uploadErr) {
            console.error('[Prescription S3 Upload Warning]:', uploadErr?.message);
        }
    }
    const firstItem = Array.isArray(items) && items.length > 0 ? items[0] : null;
    const isTravelOrStayBooking = type === 'Travel' || type === 'Stay' || type === 'Travel Ticket' || type === 'Hotel Stay' ||
        (typeof type === 'string' && (type.toLowerCase().includes('travel') ||
            type.toLowerCase().includes('stay') ||
            type.toLowerCase().includes('hotel') ||
            type.toLowerCase().includes('resort') ||
            type.toLowerCase().includes('bus') ||
            type.toLowerCase().includes('tour') ||
            type.toLowerCase().includes('flight'))) ||
        Boolean(checkInDate && checkOutDate) ||
        Boolean(firstItem?.checkInDate && firstItem?.checkOutDate) ||
        Boolean(boardingPoint || droppingPoint);
    const isServiceBooking = type === 'Services' || type === 'Service' ||
        (typeof type === 'string' && (type.toLowerCase().includes('service')));
    const isBookingWithoutPhysicalDelivery = isTravelOrStayBooking;
    if (!customer_name || !customer_phone || (!isBookingWithoutPhysicalDelivery && !customer_address) || amount === undefined || amount === null) {
        return res.status(400).json({
            status: 'error',
            message: isBookingWithoutPhysicalDelivery
                ? 'Customer name, phone, and amount are required.'
                : 'Customer name, phone, address, and amount are required.'
        });
    }
    const resolvedCustomerAddress = customer_address || req.body.customerAddress || req.body.address || (isTravelOrStayBooking ? 'N/A (Travel / Stay Booking)' : 'Indiranagar, Bangalore');
    // Schedule & service details resolution for bookings
    let resolvedAppointmentDate = appointmentDate || req.body.bookingDate || req.body.serviceDate || req.body.date || '';
    let resolvedAppointmentTimeSlot = appointmentTimeSlot || req.body.bookingTime || req.body.serviceTime || req.body.slot || req.body.timeSlot || '';
    const rawSlot = String(req.body.appointment_slot || req.body.appointmentSlot || '').trim();
    if (rawSlot && (!resolvedAppointmentDate || !resolvedAppointmentTimeSlot)) {
        if (rawSlot.includes(' at ')) {
            const [dPart, tPart] = rawSlot.split(' at ');
            if (!resolvedAppointmentDate && dPart)
                resolvedAppointmentDate = dPart.trim();
            if (!resolvedAppointmentTimeSlot && tPart)
                resolvedAppointmentTimeSlot = tPart.trim();
        }
        else if (!resolvedAppointmentDate) {
            resolvedAppointmentDate = rawSlot;
        }
    }
    if ((!resolvedAppointmentDate || !resolvedAppointmentTimeSlot) && product_details) {
        const match = String(product_details).match(/[•·]\\s*([A-Za-z0-9,\\s]+?)\\s+at\\s+([0-9:AMPMapm\\s]+)/);
        if (match) {
            if (!resolvedAppointmentDate && match[1])
                resolvedAppointmentDate = match[1].trim();
            if (!resolvedAppointmentTimeSlot && match[2])
                resolvedAppointmentTimeSlot = match[2].trim();
        }
    }
    // Service Name resolution
    let resolvedServiceName = req.body.serviceName || '';
    const GENERIC_CATEGORY_NAMES = [
        'electrical & solar services', 'electrical & solar', 'electrical services',
        'plumbing services', 'plumbing', 'home services', 'services', 'service',
        'cleaning services', 'repair services', 'general service', 'daily needs',
        'food', 'products', 'stay', 'travel'
    ];
    if (!resolvedServiceName || GENERIC_CATEGORY_NAMES.includes(resolvedServiceName.trim().toLowerCase())) {
        if (firstItem?.name) {
            const nameMatch = firstItem.name.match(/^([^(•·\\n\\r]+)/);
            resolvedServiceName = nameMatch ? nameMatch[1].trim() : firstItem.name;
        }
        else if (product_details) {
            const nameMatch = String(product_details).match(/^([^(•·\\n\\r]+)/);
            if (nameMatch)
                resolvedServiceName = nameMatch[1].trim();
        }
    }
    try {
        const mongoDb = db_1.db.getDb();
        let travelProduct = null;
        // Authoritatively resolve vendor ownership from MongoDB catalog for all items
        if (Array.isArray(items) && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                const itResolved = await resolveProductOwnerVendor(mongoDb, it, vendor_id);
                if (itResolved.vendorId) {
                    it.vendorId = itResolved.vendorId;
                    it.vendor_id = itResolved.vendorId;
                }
                if (itResolved.productDoc) {
                    it.category = it.category || itResolved.productDoc.category;
                    it.mainCategory = it.mainCategory || itResolved.productDoc.mainCategory;
                    it.productId = it.productId || String(itResolved.productDoc.id || itResolved.productDoc._id);
                    if (!it.price && itResolved.productDoc.price)
                        it.price = itResolved.productDoc.price;
                }
            }
        }
        let primaryVendorId = '';
        if (Array.isArray(items) && items.length > 0) {
            primaryVendorId = items[0]?.vendorId || items[0]?.vendor_id || '';
        }
        if (!primaryVendorId) {
            const singleResolved = await resolveProductOwnerVendor(mongoDb, {
                productId: firstItem?.productId || firstItem?.id || req.body.productId || req.body.jobId || req.body.job_id,
                name: product_details || req.body.jobTitle || firstItem?.name
            }, vendor_id);
            primaryVendorId = singleResolved.vendorId;
            if (!travelProduct && singleResolved.productDoc) {
                travelProduct = singleResolved.productDoc;
            }
        }
        if (!primaryVendorId && !(0, exports.isDummyVendor)(vendor_id)) {
            primaryVendorId = String(vendor_id).trim();
        }
        // Safety fallback: find active vendor for the category if still undetermined
        if (!primaryVendorId && mongoDb) {
            const catGuess = type || req.body.category || 'Food';
            const sampleProd = await mongoDb.collection('products').findOne({
                $or: [
                    { mainCategory: new RegExp('^' + catGuess, 'i') },
                    { category: new RegExp('^' + catGuess, 'i') }
                ]
            });
            if (sampleProd && sampleProd.vendorId) {
                primaryVendorId = String(sampleProd.vendorId);
            }
        }
        if (primaryVendorId) {
            vendor_id = primaryVendorId;
        }
        else if ((0, exports.isDummyVendor)(vendor_id)) {
            vendor_id = '';
        }
        if (vendor_id && !(0, exports.isDummyVendor)(vendor_id)) {
            const isVendorActive = await db_1.db.isVendorActive(vendor_id);
            if (!isVendorActive) {
                return res.status(403).json({
                    status: 'error',
                    message: 'This vendor is currently suspended and cannot receive new orders or bookings.'
                });
            }
            // Check Store Availability (Store Open / Store Closed Order Control)
            if (mongoDb) {
                try {
                    const vIdStr = String(vendor_id).trim();
                    const orConditions = [
                        { vendorId: vIdStr },
                        { registrationId: vIdStr },
                        { regId: vIdStr },
                        { primaryBusinessId: vIdStr },
                        { 'businesses._id': vIdStr },
                    ];
                    if (mongodb_1.ObjectId.isValid(vIdStr)) {
                        orConditions.push({ _id: new mongodb_1.ObjectId(vIdStr) });
                    }
                    else {
                        orConditions.push({ _id: vIdStr });
                    }
                    const vUser = await mongoDb.collection('users').findOne({ $or: orConditions });
                    if (vUser && (vUser.isAcceptingOrders === false || vUser.acceptingOrders === false)) {
                        return res.status(403).json({
                            status: 'error',
                            message: 'This store is currently closed and not accepting new orders.'
                        });
                    }
                }
                catch (e) { }
            }
        }
        const isBookingType = ['Booking', 'Stay', 'Travel', 'Services'].includes(type) || req.body.order_type === 'booking';
        const isJobType = ['Job', 'Jobs'].includes(type);
        const prefix = isBookingType ? 'BKG' : isJobType ? 'JOB' : 'ORD';
        const orderId = prefix + Math.floor(1000 + Math.random() * 9000);
        const orderNo = prefix + Math.floor(100000 + Math.random() * 900000);
        const authCust = req.user;
        let resolvedCustId = ((authCust?.role === 'customer' && (authCust.customerId || authCust.registrationId)) ||
            customer_id || customerId || memberId || req.body.user_id || authCust?.customerId || authCust?.registrationId || authCust?.userId || '').trim();
        const resolvedEmail = (customer_email || candidateEmail || authCust?.email || '').trim();
        // Canonical Customer ID resolution: Ensure order is associated with the canonical FIC-CUS ID from database
        if (mongoDb && (!resolvedCustId || !resolvedCustId.startsWith('FIC-CUS-') || authCust?.userId || authCust?.email)) {
            try {
                const lookupFilter = [];
                if (authCust?.userId)
                    lookupFilter.push({ id: authCust.userId }, { _id: authCust.userId });
                if (authCust?.email)
                    lookupFilter.push({ email: authCust.email.toLowerCase().trim() });
                if (resolvedEmail)
                    lookupFilter.push({ email: resolvedEmail.toLowerCase().trim() });
                const cleanCustPhone = (customer_phone || authCust?.phone || '').toString().replace(/\D/g, '').slice(-10);
                if (cleanCustPhone.length === 10) {
                    lookupFilter.push({ phone: cleanCustPhone }, { phone: `+91${cleanCustPhone}` });
                }
                if (lookupFilter.length > 0) {
                    const userDoc = await mongoDb.collection('users').findOne({ $or: lookupFilter }) ||
                        await mongoDb.collection('customers').findOne({ $or: lookupFilter });
                    if (userDoc && (userDoc.customerId || userDoc.registrationId)) {
                        resolvedCustId = (userDoc.customerId || userDoc.registrationId).trim();
                    }
                }
            }
            catch (custLookupErr) {
                console.warn('[POST /orders] Customer canonical ID lookup notice:', custLookupErr);
            }
        }
        if (isJobType) {
            const candidateName = String(req.body.customer_name || req.body.candidateName || req.body.applicantName || customer_name || '').trim();
            const candidateEmailStr = String(customer_email || candidateEmail || req.body.applicantEmail || req.body.email || '').trim();
            // Bug L: Name validation - only letters and spaces allowed; reject numeric characters
            if (candidateName) {
                if (/\d/.test(candidateName) || !/^[A-Za-z\s.'-]+$/.test(candidateName)) {
                    return res.status(400).json({
                        status: 'error',
                        code: 'INVALID_CANDIDATE_NAME',
                        message: 'Applicant name should only contain alphabetic characters and spaces. Numeric values are not allowed.'
                    });
                }
            }
            // Bug M: Email format validation
            if (candidateEmailStr) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(candidateEmailStr)) {
                    return res.status(400).json({
                        status: 'error',
                        code: 'INVALID_CANDIDATE_EMAIL',
                        message: 'Please provide a valid email address for your job application.'
                    });
                }
            }
            const jobId = firstItem?.id || firstItem?._id || firstItem?.productId || req.body.job_id || req.body.productId;
            if (mongoDb && (jobId || firstItem?.name)) {
                const custFilter = [];
                if (resolvedCustId)
                    custFilter.push({ customer_id: resolvedCustId }, { customerId: resolvedCustId });
                if (resolvedEmail)
                    custFilter.push({ customer_email: resolvedEmail }, { candidateEmail: resolvedEmail });
                const cleanCustPhone = (customer_phone || '').replace(/\D/g, '').slice(-10);
                if (cleanCustPhone && cleanCustPhone.length === 10 && cleanCustPhone !== '9876543210') {
                    custFilter.push({ customer_phone: customer_phone }, { customer_phone: cleanCustPhone });
                }
                if (custFilter.length > 0) {
                    const itemMatch = [];
                    if (jobId) {
                        itemMatch.push({ 'items.id': jobId }, { 'items._id': jobId }, { 'items.productId': jobId }, { productId: jobId });
                    }
                    if (firstItem?.name) {
                        itemMatch.push({ 'items.name': firstItem.name }, { productName: firstItem.name });
                    }
                    const existingJobOrder = await mongoDb.collection('orders').findOne({
                        type: { $in: ['Job', 'Jobs'] },
                        $or: custFilter,
                        $and: [{ $or: itemMatch }],
                        status: { $nin: ['Cancelled', 'Rejected'] }
                    });
                    if (existingJobOrder) {
                        return res.status(409).json({
                            status: 'error',
                            code: 'JOB_ALREADY_APPLIED',
                            message: 'You have already applied for this position. Check your applications in My Jobs.',
                            data: existingJobOrder,
                            application: existingJobOrder
                        });
                    }
                }
            }
        }
        // Authoritative check-in validation for stays & appointments
        const parseDateToYMD = (val) => {
            if (!val)
                return null;
            const s = String(val).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(s))
                return s;
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${day}`;
            }
            return null;
        };
        const effectiveCheckInDate = checkInDate || req.body.check_in_date || firstItem?.checkInDate || firstItem?.bookingDate || appointmentDate;
        const effectiveCheckOutDate = checkOutDate || req.body.check_out_date || firstItem?.checkOutDate;
        const effectiveCheckInTime = checkInTime || req.body.check_in_time || firstItem?.checkInTime || appointmentTimeSlot;
        const effectiveCheckOutTime = checkOutTime || req.body.check_out_time || firstItem?.checkOutTime;
        if (effectiveCheckInDate && effectiveCheckInTime) {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const checkInYMD = parseDateToYMD(effectiveCheckInDate);
            if (checkInYMD && checkInYMD < todayStr) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Check-in date cannot be in the past.'
                });
            }
            if (checkInYMD === todayStr) {
                const match = String(effectiveCheckInTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
                if (match) {
                    let h = parseInt(match[1], 10);
                    const m = parseInt(match[2], 10);
                    const ampm = match[3] ? match[3].toUpperCase() : '';
                    if (ampm === 'PM' && h < 12)
                        h += 12;
                    if (ampm === 'AM' && h === 12)
                        h = 0;
                    if (h < now.getHours() || (h === now.getHours() && m < now.getMinutes())) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Check-in time has already passed for today. Please select a current or future time slot.'
                        });
                    }
                }
            }
        }
        let finalOrderAmount = typeof amount === 'number' ? amount : (parseFloat(amount) || 0);
        let validatedBoardingPoint = undefined;
        if (typeof boardingPoint === 'string' && boardingPoint.trim()) {
            validatedBoardingPoint = { name: boardingPoint.trim(), departureTime: '', time: '', landmark: '' };
        }
        else if (boardingPoint && typeof boardingPoint === 'object') {
            const bTime = (boardingPoint.departureTime || boardingPoint.time || '').trim();
            validatedBoardingPoint = {
                id: boardingPoint.id || boardingPoint._id || undefined,
                name: (boardingPoint.name || '').trim(),
                departureTime: bTime,
                time: bTime,
                landmark: (boardingPoint.landmark || '').trim()
            };
        }
        let validatedDroppingPoint = undefined;
        if (typeof droppingPoint === 'string' && droppingPoint.trim()) {
            validatedDroppingPoint = { name: droppingPoint.trim(), arrivalTime: '', time: '', landmark: '' };
        }
        else if (droppingPoint && typeof droppingPoint === 'object') {
            const dTime = (droppingPoint.arrivalTime || droppingPoint.time || '').trim();
            validatedDroppingPoint = {
                id: droppingPoint.id || droppingPoint._id || undefined,
                name: (droppingPoint.name || '').trim(),
                arrivalTime: dTime,
                time: dTime,
                landmark: (droppingPoint.landmark || '').trim()
            };
        }
        let numAdults = typeof adults === 'number' ? adults : parseInt(adults, 10);
        if (isNaN(numAdults) || numAdults < 0)
            numAdults = 1;
        let numChildren = typeof children === 'number' ? children : parseInt(children, 10);
        if (isNaN(numChildren) || numChildren < 0)
            numChildren = 0;
        const targetProdId = firstItem?.productId || firstItem?.id || req.body.productId;
        // Validate stock and availability for products in items
        if (mongoDb && Array.isArray(items) && items.length > 0) {
            for (const it of items) {
                const itId = it?.productId || it?.id || it?._id;
                if (itId) {
                    const q = [{ id: String(itId) }, { _id: String(itId) }];
                    try {
                        if (mongodb_1.ObjectId.isValid(String(itId))) {
                            q.push({ _id: new mongodb_1.ObjectId(String(itId)) });
                        }
                    }
                    catch (e) { }
                    const dbProd = await mongoDb.collection('products').findOne({ $or: q });
                    if (dbProd) {
                        const isUnavail = dbProd.status === 'Unavailable' || dbProd.status === 'Out of Stock' || dbProd.status === 'Inactive' ||
                            dbProd.isAvailable === false || dbProd.isActive === false ||
                            (dbProd.stock !== undefined && dbProd.stock !== null && parseInt(dbProd.stock) <= 0);
                        if (isUnavail) {
                            return res.status(400).json({
                                status: 'error',
                                message: `Product "${dbProd.name || it.name || 'Selected item'}" is currently out of stock.`
                            });
                        }
                        const requestedQty = Number(it.quantity || 1);
                        if (dbProd.stock !== undefined && dbProd.stock !== null && parseInt(dbProd.stock) < requestedQty) {
                            return res.status(400).json({
                                status: 'error',
                                message: `Requested quantity for "${dbProd.name || it.name}" exceeds available stock (${dbProd.stock} available).`
                            });
                        }
                    }
                }
            }
        }
        if (mongoDb && targetProdId) {
            const queries = [{ id: String(targetProdId) }, { _id: String(targetProdId) }];
            try {
                if (mongodb_1.ObjectId.isValid(String(targetProdId))) {
                    queries.push({ _id: new mongodb_1.ObjectId(String(targetProdId)) });
                }
            }
            catch (e) { }
            travelProduct = await mongoDb.collection('products').findOne({ $or: queries });
        }
        let effectiveStayNights = 1;
        const isStayOrder = type === 'Stay' || type === 'Hotel Stay' ||
            (typeof type === 'string' && (type.toLowerCase().includes('stay') || type.toLowerCase().includes('hotel') || type.toLowerCase().includes('resort'))) ||
            Boolean(effectiveCheckInDate && effectiveCheckOutDate) ||
            (travelProduct && (travelProduct.mainCategory === 'Stay' || travelProduct.subNavbarCategory === 'Stay')) ||
            (firstItem && (firstItem.type === 'Stay' || firstItem.mainCategory === 'Stay' || firstItem.subNavbarCategory === 'Stay'));
        if (isStayOrder) {
            const totalGuests = numAdults + numChildren;
            const guests = Array.isArray(guestDetails) && guestDetails.length > 0
                ? guestDetails
                : (Array.isArray(guestList) && guestList.length > 0 ? guestList : []);
            if (totalGuests > 0 && guests.length < totalGuests) {
                return res.status(400).json({
                    status: 'error',
                    message: `Please provide information for all ${totalGuests} guests before booking.`
                });
            }
            for (let i = 0; i < totalGuests; i++) {
                const g = guests[i];
                if (!g || !g.name || !String(g.name).trim()) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Guest ${i + 1} name is required.`
                    });
                }
                if (!/^[a-zA-Z\s]{2,50}$/.test(String(g.name).trim())) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Guest ${i + 1} name must contain only letters and spaces.`
                    });
                }
                const isChildGuest = i >= numAdults;
                if (isChildGuest) {
                    if (g.aadhaar && !/^\d{12}$/.test(String(g.aadhaar).trim())) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Child ${i - numAdults + 1} Aadhaar number must be 12 digits if provided.`
                        });
                    }
                }
                else {
                    let guestAadhaar = String(g.aadhaar || '').trim();
                    if (i === 0 && (!guestAadhaar || guestAadhaar.includes('X') || guestAadhaar.length !== 12)) {
                        const mongoDb = db_1.db.getDb();
                        const authUserId = req.user?.id || req.user?._id || req.user?.customerId;
                        if (mongoDb && authUserId) {
                            let custQuery = [{ id: authUserId }, { customerId: authUserId }, { registrationId: authUserId }];
                            try {
                                if (mongodb_1.ObjectId.isValid(authUserId))
                                    custQuery.push({ _id: new mongodb_1.ObjectId(authUserId) });
                            }
                            catch (e) { }
                            const custDoc = await mongoDb.collection('users').findOne({ $or: custQuery }).catch(() => null);
                            if (custDoc?.aadhaar) {
                                try {
                                    const decrypted = custDoc.aadhaar.startsWith('v1:')
                                        ? securityManager_1.securityManager.decryptAES256GCM(custDoc.aadhaar)
                                        : custDoc.aadhaar;
                                    if (/^\d{12}$/.test(decrypted)) {
                                        guestAadhaar = decrypted;
                                        g.aadhaar = decrypted;
                                    }
                                }
                                catch (e) { }
                            }
                        }
                    }
                    if (!guestAadhaar || !/^\d{12}$/.test(guestAadhaar)) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Guest ${i + 1} requires a valid 12-digit Aadhaar number.`
                        });
                    }
                }
            }
            // Calculate stay duration in nights accurately
            let calculatedNights = Number(nightsCount || req.body.numberOfNights || firstItem?.nights || 0);
            if ((!calculatedNights || calculatedNights <= 0) && effectiveCheckInDate && effectiveCheckOutDate) {
                const sD = new Date(effectiveCheckInDate);
                const eD = new Date(effectiveCheckOutDate);
                if (!isNaN(sD.getTime()) && !isNaN(eD.getTime())) {
                    calculatedNights = Math.max(1, Math.ceil((eD.getTime() - sD.getTime()) / 86400000));
                }
            }
            effectiveStayNights = (!calculatedNights || calculatedNights <= 0) ? 1 : calculatedNights;
            // Authoritative stay pricing recalculation
            if (travelProduct) {
                const stayPricingType = String(travelProduct.pricingType || travelProduct.pricePer || '').toLowerCase();
                const baseRate = typeof travelProduct.price === 'number' ? travelProduct.price : (parseFloat(travelProduct.price) || 0);
                const adultRate = typeof travelProduct.adultPrice === 'number' && travelProduct.adultPrice > 0 ? travelProduct.adultPrice : baseRate;
                const childRate = typeof travelProduct.childPrice === 'number' ? travelProduct.childPrice : 0;
                let expectedStayTotal = 0;
                const rawGuests = Array.isArray(guestDetails) && guestDetails.length > 0 ? guestDetails : (Array.isArray(guestList) ? guestList : []);
                let totalChildStayRate = 0;
                if (numChildren > 0) {
                    if (rawGuests.length >= numAdults + numChildren) {
                        for (let i = numAdults; i < numAdults + numChildren; i++) {
                            const cAge = parseInt(rawGuests[i]?.age, 10);
                            if (isNaN(cAge) || cAge <= 5) {
                                totalChildStayRate += 0;
                            }
                            else if (cAge <= 12) {
                                totalChildStayRate += Math.round((childRate > 0 ? childRate : adultRate) * 0.5);
                            }
                            else {
                                totalChildStayRate += (childRate > 0 ? childRate : adultRate);
                            }
                        }
                    }
                    else {
                        totalChildStayRate = numChildren * childRate;
                    }
                }
                if (stayPricingType.includes('room')) {
                    const rooms = Math.max(1, Number(roomsCount || req.body.numberOfRooms || 1));
                    const extraGuests = Math.max(0, (numAdults + numChildren) - Number(travelProduct.baseGuests || 2));
                    const extraFee = Number(travelProduct.extraGuestFee || travelProduct.extraPersonFee || 500);
                    expectedStayTotal = ((rooms * baseRate) + (extraGuests * extraFee)) * effectiveStayNights;
                }
                else {
                    expectedStayTotal = ((numAdults * adultRate) + totalChildStayRate) * effectiveStayNights;
                }
                if (expectedStayTotal > 0) {
                    finalOrderAmount = expectedStayTotal;
                }
            }
            else if (firstItem) {
                const stayPricingType = String(firstItem.pricingType || firstItem.pricePer || '').toLowerCase();
                const baseRate = Number(firstItem.basePrice || firstItem.price || 0);
                const adultRate = Number(firstItem.adultPrice || baseRate);
                const childRate = Number(firstItem.childPrice || 0);
                const rawGuests = Array.isArray(guestDetails) && guestDetails.length > 0 ? guestDetails : (Array.isArray(guestList) ? guestList : []);
                let totalChildStayRate = 0;
                if (numChildren > 0) {
                    if (rawGuests.length >= numAdults + numChildren) {
                        for (let i = numAdults; i < numAdults + numChildren; i++) {
                            const cAge = parseInt(rawGuests[i]?.age, 10);
                            if (isNaN(cAge) || cAge <= 5) {
                                totalChildStayRate += 0;
                            }
                            else if (cAge <= 12) {
                                totalChildStayRate += Math.round((childRate > 0 ? childRate : adultRate) * 0.5);
                            }
                            else {
                                totalChildStayRate += (childRate > 0 ? childRate : adultRate);
                            }
                        }
                    }
                    else {
                        totalChildStayRate = numChildren * childRate;
                    }
                }
                let expectedStayTotal = 0;
                if (stayPricingType.includes('room')) {
                    const rooms = Math.max(1, Number(roomsCount || firstItem.roomsCount || 1));
                    const extraGuests = Math.max(0, (numAdults + numChildren) - Number(firstItem.baseGuests || 2));
                    const extraFee = Number(firstItem.extraGuestFee || firstItem.extraPersonFee || 500);
                    expectedStayTotal = ((rooms * baseRate) + (extraGuests * extraFee)) * effectiveStayNights;
                }
                else {
                    expectedStayTotal = ((numAdults * adultRate) + totalChildStayRate) * effectiveStayNights;
                }
                if (expectedStayTotal > 0) {
                    finalOrderAmount = expectedStayTotal;
                }
            }
        }
        const isTravelOrder = type === 'Travel' || (type || '').toLowerCase() === 'travel' ||
            travelProduct?.subNavbarCategory === 'Travel' || travelProduct?.mainCategory === 'Travel' ||
            firstItem?.type === 'Travel' || firstItem?.subNavbarCategory === 'Travel';
        if (isTravelOrder) {
            if (numAdults + numChildren < 1) {
                return res.status(400).json({
                    status: 'error',
                    message: 'At least 1 passenger is required for travel booking.'
                });
            }
            if (travelProduct) {
                // Enforce vendor configured unit fare
                const unitFare = typeof travelProduct.price === 'number' ? travelProduct.price : (parseFloat(travelProduct.price) || 0);
                const adultFare = typeof travelProduct.adultPrice === 'number' && travelProduct.adultPrice > 0 ? travelProduct.adultPrice : unitFare;
                const childFare = typeof travelProduct.childPrice === 'number' && travelProduct.childPrice > 0 ? travelProduct.childPrice : adultFare;
                const rawPassengers = Array.isArray(guestDetails) && guestDetails.length > 0 ? guestDetails : (Array.isArray(guestList) ? guestList : []);
                let totalChildTravelFare = 0;
                if (numChildren > 0) {
                    if (rawPassengers.length >= numAdults + numChildren) {
                        for (let i = numAdults; i < numAdults + numChildren; i++) {
                            const cAge = parseInt(rawPassengers[i]?.age, 10);
                            if (isNaN(cAge) || cAge <= 5) {
                                totalChildTravelFare += 0;
                            }
                            else if (cAge <= 12) {
                                totalChildTravelFare += Math.round(adultFare * 0.5);
                            }
                            else {
                                totalChildTravelFare += childFare;
                            }
                        }
                    }
                    else {
                        totalChildTravelFare = numChildren * childFare;
                    }
                }
                const expectedTotalFare = (numAdults * adultFare) + totalChildTravelFare;
                // Strict pricing integrity: The vendor configured unit fare is the source of truth
                finalOrderAmount = expectedTotalFare;
                // Boarding and Dropping point validation against real vendor configuration
                const { boardingPoints: allowedBps, droppingPoints: allowedDps } = extractVendorTravelPoints(travelProduct);
                if (allowedBps.length > 0) {
                    if (!validatedBoardingPoint || !validatedBoardingPoint.name) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Boarding point is required. Please select one of the vendor-provided boarding points.'
                        });
                    }
                    const matchedBp = allowedBps.find(pt => pt.name.toLowerCase().trim() === validatedBoardingPoint.name.toLowerCase().trim());
                    if (!matchedBp) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Invalid boarding point "${validatedBoardingPoint.name}". Please select one of the vendor-provided boarding points: ${allowedBps.map(p => p.name).join(', ')}.`
                        });
                    }
                    if (!validatedBoardingPoint.time)
                        validatedBoardingPoint.time = matchedBp.time || '';
                    if (!validatedBoardingPoint.landmark)
                        validatedBoardingPoint.landmark = matchedBp.landmark || '';
                }
                if (allowedDps.length > 0) {
                    if (!validatedDroppingPoint || !validatedDroppingPoint.name) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Dropping point is required. Please select one of the vendor-provided dropping points.'
                        });
                    }
                    const matchedDp = allowedDps.find(pt => pt.name.toLowerCase().trim() === validatedDroppingPoint.name.toLowerCase().trim());
                    if (!matchedDp) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Invalid dropping point "${validatedDroppingPoint.name}". Please select one of the vendor-provided dropping points: ${allowedDps.map(p => p.name).join(', ')}.`
                        });
                    }
                    if (!validatedDroppingPoint.time)
                        validatedDroppingPoint.time = matchedDp.time || '';
                    if (!validatedDroppingPoint.landmark)
                        validatedDroppingPoint.landmark = matchedDp.landmark || '';
                }
            }
        }
        // Normalize payment details
        const rawMethod = paymentMethod || payment_method || (req.body.isCOD ? 'Cash on Delivery' : 'Connect Wallet');
        const lowerMethod = String(rawMethod).toLowerCase();
        let resolvedPaymentMethod = 'Connect Wallet';
        if (lowerMethod.includes('cash') || lowerMethod.includes('cod')) {
            resolvedPaymentMethod = 'Cash on Delivery';
        }
        else if (lowerMethod.includes('wallet')) {
            resolvedPaymentMethod = 'Connect Wallet';
        }
        else if (lowerMethod === 'upi') {
            resolvedPaymentMethod = 'UPI';
        }
        else if (lowerMethod === 'card') {
            resolvedPaymentMethod = 'Card';
        }
        else if (lowerMethod.includes('bank')) {
            resolvedPaymentMethod = 'Net Banking';
        }
        else if (lowerMethod.includes('razorpay') || lowerMethod.includes('online')) {
            resolvedPaymentMethod = 'Online (Razorpay)';
        }
        else {
            resolvedPaymentMethod = rawMethod;
        }
        const isCod = resolvedPaymentMethod === 'Cash on Delivery';
        if (isCod) {
            const bType = req.body.bookingType || req.body.booking_type;
            const isStayOrTravel = isTravelOrder || type === 'Travel' || type === 'Stay' || bType === 'Stay' || bType === 'Travel' ||
                (Array.isArray(items) && items.some((it) => {
                    const cat = String(it.category || it.subNavbarCategory || it.mainCategory || it.tag || '').toLowerCase();
                    return cat.includes('travel') || cat.includes('stay') || cat.includes('hotel') || cat.includes('bus') || it.bookingType === 'Stay' || it.bookingType === 'Travel';
                }));
            if (isStayOrTravel) {
                return res.status(400).json({
                    status: 'error',
                    code: 'COD_NOT_ALLOWED',
                    message: 'Cash on Delivery is not allowed for Travel and Stay bookings. Please pay using UPI, Card, Net Banking, or Connect Wallet.'
                });
            }
        }
        let resolvedPaymentStatus = paymentStatus || payment_status;
        if (!resolvedPaymentStatus) {
            resolvedPaymentStatus = isCod ? 'Pending' : 'Paid';
        }
        else if (['SUCCESS', 'PAID', 'COMPLETED'].includes(String(resolvedPaymentStatus).toUpperCase())) {
            resolvedPaymentStatus = 'Paid';
        }
        const resolvedTxnId = transactionId || paymentId || (!isCod ? ('TXN_' + orderNo) : undefined);
        const resolvedPaidAt = resolvedPaymentStatus === 'Paid' ? (paidAt || new Date().toISOString()) : undefined;
        // Check if multi-item cart contains items from multiple distinct vendors
        const distinctVendorIds = Array.isArray(items) && items.length > 1
            ? [...new Set(items.map((it) => it.vendorId).filter(Boolean))]
            : [];
        if (distinctVendorIds.length > 1) {
            const createdOrders = [];
            for (const vId of distinctVendorIds) {
                const vItems = items.filter((it) => it.vendorId === vId);
                const vAmount = vItems.reduce((acc, it) => acc + (Number(it.price || 0) * Number(it.quantity || 1)), 0);
                const vOrderId = prefix + Math.floor(1000 + Math.random() * 9000);
                const vOrderNo = prefix + Math.floor(100000 + Math.random() * 900000);
                const vProdDetails = vItems.map((it) => `${it.name} (x${it.quantity || 1})`).join(', ');
                const vOrder = await db_1.db.createOrder({
                    id: vOrderId,
                    order_number: vOrderNo,
                    vendor_id: vId,
                    vendorId: vId,
                    customer_id: resolvedCustId,
                    customerId: resolvedCustId,
                    memberId: resolvedCustId,
                    customer_name,
                    memberName: customer_name,
                    customer_email: resolvedEmail,
                    customer_phone,
                    customer_address: resolvedCustomerAddress,
                    customer_latitude: customer_latitude || 12.9400,
                    customer_longitude: customer_longitude || 77.6250,
                    product_details: vProdDetails,
                    amount: vAmount,
                    totalAmount: vAmount,
                    status: isJobType ? (req.body.status || 'APPLICATION RECEIVED') : (isBookingType ? (req.body.status || 'Booking Received') : (req.body.status || 'Order Received')),
                    type: type || (isJobType ? 'Job' : (isBookingType ? (req.body.category || 'Services') : 'Order')),
                    category: req.body.category || vItems[0]?.category || vItems[0]?.mainCategory || (isJobType ? 'Jobs' : (isBookingType ? 'Services' : 'Products')),
                    paymentMethod: resolvedPaymentMethod,
                    payment_method: resolvedPaymentMethod,
                    paymentStatus: resolvedPaymentStatus,
                    payment_status: resolvedPaymentStatus,
                    ...(resolvedTxnId && { transactionId: resolvedTxnId }),
                    ...(resolvedPaidAt && { paidAt: resolvedPaidAt }),
                    appointmentDate: resolvedAppointmentDate || null,
                    appointmentTimeSlot: resolvedAppointmentTimeSlot || null,
                    appointment_slot: (resolvedAppointmentDate && resolvedAppointmentTimeSlot) ? (resolvedAppointmentDate + " at " + resolvedAppointmentTimeSlot) : (rawSlot || undefined),
                    serviceName: resolvedServiceName || undefined,
                    items: vItems
                });
                await db_1.db.logStatusHistory({
                    order_id: vOrderId,
                    status: 'Order Placed',
                    updated_by: 'Customer',
                    notes: `Order placed successfully by ${customer_name}`
                });
                const isMultiJob = isJobType;
                const isMultiBooking = isBookingType;
                const specificMultiEvent = isMultiJob ? 'APPLICATION_CREATED' : (isMultiBooking ? 'BOOKING_CREATED' : 'ORDER_CREATED');
                const specificMultiEntity = isMultiJob ? 'job' : (isMultiBooking ? 'booking' : realtime_1.RealtimeEntities.ORDER);
                socket_1.socketManager.emitToVendor(vId, 'new_order_received', vOrder);
                socket_1.socketManager.emitToVendor(vId, specificMultiEvent, vOrder);
                socket_1.socketManager.broadcast('new_order_placed', vOrder);
                socket_1.socketManager.broadcast(specificMultiEvent, vOrder);
                fcmPushService_1.fcmPushService.dispatchToVendor(vId, {
                    title: `New ${isMultiJob ? 'Job Application' : (isMultiBooking ? 'Booking' : 'Order')} (#${vOrder.order_number || vOrderId})`,
                    body: `${vOrder.customer_name || 'Customer'} placed a new ${isMultiJob ? 'job application' : (isMultiBooking ? 'booking' : 'order')} • ₹${vOrder.amount || 0}`,
                    targetId: String(vOrderId),
                    orderId: String(vOrderId),
                    category: isMultiJob ? 'Jobs' : (isMultiBooking ? 'Bookings' : 'Orders'),
                    segment: isMultiJob ? 'Jobs' : (isMultiBooking ? 'Bookings' : 'Orders'),
                    data: {
                        orderNumber: vOrder.order_number || vOrderId,
                        amount: vOrder.amount || 0,
                        customerName: vOrder.customer_name || 'Customer',
                        itemName: (vOrder.items && vOrder.items[0]?.name) || vOrder.product_details || 'Item',
                        status: vOrder.status || 'Received',
                    }
                }).catch(() => { });
                const multiCustId = vOrder.customer_id || resolvedCustId || vOrder.customerId || '';
                if (multiCustId) {
                    socket_1.socketManager.emitToUser('customer', multiCustId, 'new_order_placed', vOrder);
                    socket_1.socketManager.emitToUser('customer', multiCustId, 'order_created', vOrder);
                    socket_1.socketManager.emitToUser('customer', multiCustId, specificMultiEvent, vOrder);
                    fcmPushService_1.fcmPushService.dispatchToCustomer(multiCustId, {
                        title: isMultiJob ? 'Job Application Submitted! 💼' : (isMultiBooking ? 'Booking Confirmed! 📅' : 'Order Placed Successfully! 🛍️'),
                        body: `${(vOrder.items && vOrder.items[0]?.name) || vOrder.product_details || 'Your order'} (#${vOrder.order_number || vOrderId}) has been placed.`,
                        targetId: String(vOrderId),
                        orderId: String(vOrderId),
                        category: isMultiJob ? 'Jobs' : (isMultiBooking ? 'Bookings' : 'Orders'),
                        segment: isMultiJob ? 'Jobs' : (isMultiBooking ? 'Bookings' : 'Orders'),
                        data: {
                            orderId: String(vOrderId),
                            orderNumber: vOrder.order_number || vOrderId,
                            status: vOrder.status || 'Received',
                            targetScreen: 'Orders',
                        },
                    }).catch(() => { });
                }
                await realtime_1.eventPublisher.publishEvent(specificMultiEntity, realtime_1.RealtimeActions.CREATED, vOrder.id, vOrder, { role: 'vendor', userId: vId });
                setTimeout(async () => {
                    await runAutoAssignment(vOrderId);
                }, 1500);
                forwardOrderToVendorBackend(vOrder, {
                    id: vOrderId,
                    order_number: vOrderNo,
                    vendorId: vId,
                    memberId: resolvedCustId || 'cust_dhanush',
                    memberName: customer_name,
                    type: type || 'Order',
                    category: req.body.category || vItems[0]?.category || vItems[0]?.mainCategory || 'Products',
                    items: vItems,
                    totalAmount: vAmount,
                    discountApplied: 0,
                    finalAmount: vAmount,
                    paymentMethod: resolvedPaymentMethod,
                    payment_method: resolvedPaymentMethod,
                    paymentStatus: resolvedPaymentStatus,
                    payment_status: resolvedPaymentStatus,
                    ...(resolvedTxnId && { transactionId: resolvedTxnId }),
                    ...(resolvedPaidAt && { paidAt: resolvedPaidAt }),
                    appointmentDate: resolvedAppointmentDate,
                    appointmentTimeSlot: resolvedAppointmentTimeSlot,
                    serviceName: resolvedServiceName,
                    serviceLocation: resolvedCustomerAddress
                });
                createdOrders.push(vOrder);
            }
            return res.status(201).json({
                status: 'success',
                message: 'Multi-vendor orders created successfully.',
                orders: createdOrders,
                data: createdOrders[0],
                order: createdOrders[0]
            });
        }
        const newOrder = await db_1.db.createOrder({
            id: orderId,
            order_number: orderNo,
            vendor_id: (!(0, exports.isDummyVendor)(vendor_id) ? vendor_id : '') || travelProduct?.vendorId || primaryVendorId || '',
            vendorId: (!(0, exports.isDummyVendor)(vendor_id) ? vendor_id : '') || travelProduct?.vendorId || primaryVendorId || '',
            customer_id: resolvedCustId,
            customerId: resolvedCustId,
            memberId: resolvedCustId,
            customer_name,
            memberName: customer_name,
            customer_email: resolvedEmail,
            customer_phone,
            customer_address: resolvedCustomerAddress,
            customer_latitude: customer_latitude || 12.9400,
            customer_longitude: customer_longitude || 77.6250,
            product_details: product_details || travelProduct?.name || 'Generic Connect Item',
            amount: finalOrderAmount,
            totalAmount: finalOrderAmount,
            status: isJobType ? (req.body.status || 'APPLICATION RECEIVED') : (isBookingType ? (req.body.status || 'Booking Received') : (req.body.status || 'Order Received')),
            type: type || (isJobType ? 'Job' : (isBookingType ? (req.body.category || 'Services') : 'Order')),
            category: req.body.category || (items && items[0]?.category) || (items && items[0]?.mainCategory) || (isJobType ? 'Jobs' : (isBookingType ? 'Services' : 'Products')),
            paymentMethod: resolvedPaymentMethod,
            payment_method: resolvedPaymentMethod,
            paymentStatus: resolvedPaymentStatus,
            payment_status: resolvedPaymentStatus,
            ...(resolvedTxnId && { transactionId: resolvedTxnId }),
            ...(resolvedPaidAt && { paidAt: resolvedPaidAt }),
            appointmentDate: resolvedAppointmentDate || null,
            appointmentTimeSlot: resolvedAppointmentTimeSlot || null,
            appointment_slot: (resolvedAppointmentDate && resolvedAppointmentTimeSlot) ? (resolvedAppointmentDate + " at " + resolvedAppointmentTimeSlot) : (rawSlot || undefined),
            serviceName: resolvedServiceName || undefined,
            appointmentType: req.body.appointmentType || req.body.serviceType,
            serviceType: req.body.serviceType || req.body.appointmentType,
            doctorName,
            tableNumber,
            roomNumber,
            prescriptionUrl,
            ...(isJobType ? {
                candidateEmail: resolvedEmail || candidateEmail,
                candidateResume,
                experience,
                candidateEducation,
            } : {}),
            boardingPoint: validatedBoardingPoint,
            droppingPoint: validatedDroppingPoint,
            adults: numAdults,
            children: numChildren,
            guestDetails: Array.isArray(guestDetails) ? guestDetails : (Array.isArray(guestList) ? guestList : undefined),
            guestList: Array.isArray(guestList) ? guestList : (Array.isArray(guestDetails) ? guestDetails : undefined),
            checkInDate: effectiveCheckInDate,
            checkInTime: effectiveCheckInTime,
            checkOutDate: effectiveCheckOutDate,
            checkOutTime: effectiveCheckOutTime,
            roomsCount: roomsCount || req.body.numberOfRooms || 1,
            nightsCount: isStayOrder ? effectiveStayNights : (nightsCount || req.body.numberOfNights),
            vehicleDetails: vehicleDetails || null,
            specialRequests: specialRequests || req.body.notes || null,
            items: items || []
        });
        // Log status history
        await db_1.db.logStatusHistory({
            order_id: orderId,
            status: 'Order Placed',
            updated_by: 'Customer',
            notes: `Order placed successfully by ${customer_name}`
        });
        // Notify vendor, customer, and broadcast
        const specificSingleEvent = isJobType ? 'APPLICATION_CREATED' : (isBookingType ? 'BOOKING_CREATED' : 'ORDER_CREATED');
        const specificSingleEntity = isJobType ? 'job' : (isBookingType ? 'booking' : realtime_1.RealtimeEntities.ORDER);
        socket_1.socketManager.emitToVendor(newOrder.vendor_id, 'new_order_received', newOrder);
        socket_1.socketManager.emitToVendor(newOrder.vendor_id, specificSingleEvent, newOrder);
        if (vendor_id && vendor_id !== newOrder.vendor_id) {
            socket_1.socketManager.emitToVendor(vendor_id, 'new_order_received', newOrder);
            socket_1.socketManager.emitToVendor(vendor_id, specificSingleEvent, newOrder);
        }
        socket_1.socketManager.emitToVendor(newOrder.vendor_id, specificSingleEvent, newOrder);
        if (vendor_id && String(vendor_id) !== String(newOrder.vendor_id)) {
            socket_1.socketManager.emitToVendor(vendor_id, specificSingleEvent, newOrder);
            socket_1.socketManager.emitToVendor(vendor_id, 'new_order_received', newOrder);
        }
        socket_1.socketManager.broadcast('new_order_placed', newOrder);
        socket_1.socketManager.broadcast(specificSingleEvent, newOrder);
        const targetSingleVid = newOrder.vendor_id || vendor_id;
        if (targetSingleVid) {
            fcmPushService_1.fcmPushService.dispatchToVendor(targetSingleVid, {
                title: `New ${isJobType ? 'Job Application' : (isBookingType ? 'Booking' : 'Order')} (#${newOrder.order_number || newOrder.id})`,
                body: `${customer_name || 'Customer'} placed a new ${isJobType ? 'job application' : (isBookingType ? 'booking' : 'order')} • ₹${newOrder.amount || 0}`,
                targetId: String(newOrder.id || newOrder._id),
                orderId: String(newOrder.id || newOrder._id),
                category: isJobType ? 'Jobs' : (isBookingType ? 'Bookings' : 'Orders'),
                segment: isJobType ? 'Jobs' : (isBookingType ? 'Bookings' : 'Orders'),
                data: {
                    orderNumber: newOrder.order_number || newOrder.id,
                    amount: newOrder.amount || 0,
                    customerName: customer_name || 'Customer',
                    itemName: (newOrder.items && newOrder.items[0]?.name) || newOrder.product_details || 'Item',
                    status: newOrder.status || 'Received',
                }
            }).catch(() => { });
        }
        // Cross-platform synchronization: notify customer sessions
        const cIdTarget = newOrder.customer_id || resolvedCustId || newOrder.customerId || '';
        if (cIdTarget) {
            socket_1.socketManager.emitToUser('customer', cIdTarget, 'new_order_placed', newOrder);
            socket_1.socketManager.emitToUser('customer', cIdTarget, 'order_created', newOrder);
            socket_1.socketManager.emitToUser('customer', cIdTarget, specificSingleEvent, newOrder);
            fcmPushService_1.fcmPushService.dispatchToCustomer(cIdTarget, {
                title: isJobType ? 'Job Application Submitted! 💼' : (isBookingType ? 'Booking Confirmed! 📅' : 'Order Placed Successfully! 🛍️'),
                body: `${(newOrder.items && newOrder.items[0]?.name) || newOrder.product_details || 'Your order'} (#${newOrder.order_number || newOrder.id}) has been placed.`,
                targetId: String(newOrder.id || newOrder._id),
                orderId: String(newOrder.id || newOrder._id),
                category: isJobType ? 'Jobs' : (isBookingType ? 'Bookings' : 'Orders'),
                segment: isJobType ? 'Jobs' : (isBookingType ? 'Bookings' : 'Orders'),
                data: {
                    orderId: String(newOrder.id || newOrder._id),
                    orderNumber: newOrder.order_number || newOrder.id,
                    status: newOrder.status || 'Received',
                    targetScreen: 'Orders',
                },
            }).catch(() => { });
        }
        const uIdTarget = newOrder.user_id;
        if (uIdTarget && uIdTarget !== cIdTarget) {
            socket_1.socketManager.emitToUser('customer', uIdTarget, 'new_order_placed', newOrder);
            socket_1.socketManager.emitToUser('customer', uIdTarget, 'order_created', newOrder);
            socket_1.socketManager.emitToUser('customer', uIdTarget, specificSingleEvent, newOrder);
        }
        // Publish structured event to Redis message broker & WebSockets
        await realtime_1.eventPublisher.publishEvent(specificSingleEntity, realtime_1.RealtimeActions.CREATED, newOrder.id, newOrder, { role: 'vendor', userId: newOrder.vendor_id });
        if (vendor_id && vendor_id !== newOrder.vendor_id) {
            await realtime_1.eventPublisher.publishEvent(specificSingleEntity, realtime_1.RealtimeActions.CREATED, newOrder.id, newOrder, { role: 'vendor', userId: vendor_id });
        }
        // Auto Assign algorithm
        setTimeout(async () => {
            await runAutoAssignment(orderId);
        }, 1500);
        // Forward order details to vendor backend
        try {
            const syncData = JSON.stringify({
                id: orderId,
                order_number: orderNo,
                vendorId: vendor_id || travelProduct?.vendorId || primaryVendorId,
                memberId: resolvedCustId || 'cust_dhanush',
                memberName: customer_name,
                type: type || 'Order',
                items: items || [{
                        productId: targetProdId || '',
                        name: product_details || travelProduct?.name || 'Generic Connect Item',
                        price: finalOrderAmount,
                        quantity: 1
                    }],
                totalAmount: finalOrderAmount,
                discountApplied: 0,
                finalAmount: finalOrderAmount,
                paymentMethod: resolvedPaymentMethod,
                payment_method: resolvedPaymentMethod,
                paymentStatus: resolvedPaymentStatus,
                payment_status: resolvedPaymentStatus,
                ...(resolvedTxnId && { transactionId: resolvedTxnId }),
                ...(resolvedPaidAt && { paidAt: resolvedPaidAt }),
                boardingPoint: validatedBoardingPoint,
                droppingPoint: validatedDroppingPoint,
                adults: numAdults,
                children: numChildren,
                guestDetails: Array.isArray(guestDetails) ? guestDetails : (Array.isArray(guestList) ? guestList : undefined),
                guestList: Array.isArray(guestList) ? guestList : (Array.isArray(guestDetails) ? guestDetails : undefined),
                checkInDate: checkInDate || req.body.check_in_date || appointmentDate,
                checkInTime: checkInTime || req.body.check_in_time,
                checkOutDate: checkOutDate || req.body.check_out_date,
                checkOutTime: checkOutTime || req.body.check_out_time,
                roomsCount: roomsCount || req.body.numberOfRooms,
                nightsCount: nightsCount || req.body.numberOfNights,
                vehicleDetails: vehicleDetails || null,
                specialRequests: specialRequests || req.body.notes || null,
                candidateEmail: candidateEmail || req.body.candidateEmail,
                candidateResume: candidateResume || req.body.candidateResume,
                experience: experience || req.body.experience,
                candidateEducation: candidateEducation || req.body.candidateEducation,
                appointmentDate: resolvedAppointmentDate,
                appointmentTimeSlot: resolvedAppointmentTimeSlot,
                serviceName: resolvedServiceName,
                serviceLocation: resolvedCustomerAddress,
                doctorName,
                tableNumber,
                roomNumber,
                prescriptionUrl
            });
            // Forward order to vendor backend (configurable endpoint with throttled error reporting)
            if (process.env.ENABLE_VENDOR_SYNC !== 'false') {
                const vendorUrlRaw = process.env.VENDOR_BACKEND_URL || process.env.VENDOR_API_URL || 'http://127.0.0.1:8002';
                let vendorUrl;
                try {
                    vendorUrl = new URL('/api/public/orders', vendorUrlRaw);
                }
                catch {
                    vendorUrl = new URL('http://127.0.0.1:8002/api/public/orders');
                }
                const client = vendorUrl.protocol === 'https:' ? require('https') : require('http');
                const reqPost = client.request({
                    protocol: vendorUrl.protocol,
                    hostname: vendorUrl.hostname,
                    port: vendorUrl.port || (vendorUrl.protocol === 'https:' ? 443 : 80),
                    path: vendorUrl.pathname + vendorUrl.search,
                    method: 'POST',
                    timeout: 4000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(syncData)
                    }
                }, (resPost) => {
                    let respData = '';
                    resPost.on('data', (d) => { respData += d.toString(); });
                    resPost.on('end', () => {
                        if (resPost.statusCode >= 200 && resPost.statusCode < 300) {
                            console.log('[Sync Order]: Vendor backend accepted order.');
                        }
                        else {
                            logVendorSyncThrottled(`Vendor backend (${vendorUrl.origin}) returned status ${resPost.statusCode}: ${respData.slice(0, 100)}`);
                        }
                    });
                });
                reqPost.on('timeout', () => {
                    reqPost.destroy(new Error('Connection timed out'));
                });
                reqPost.on('error', (e) => {
                    logVendorSyncThrottled(`Failed to forward order to vendor backend (${vendorUrl.origin}): ${e.message}`);
                });
                reqPost.write(syncData);
                reqPost.end();
            }
        }
        catch (err) {
            logVendorSyncThrottled(err.message);
        }
        res.status(201).json({
            status: 'success',
            message: 'Order created successfully.',
            data: newOrder,
            order: newOrder
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to create order: ' + error.message
        });
    }
});
// POST: /api/orders/:id/prepare
router.post('/:id/prepare', middleware_1.authenticateToken, (0, middleware_1.enforceRoleAndApproval)('vendor', 'admin', 'superadmin'), async (req, res) => {
    const { id } = req.params;
    try {
        const updated = await db_1.db.updateOrderStatus(id, 'Preparing');
        if (!updated) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        await db_1.db.logStatusHistory({
            order_id: id,
            status: 'Preparing',
            updated_by: 'Vendor',
            notes: 'Vendor is preparing your items'
        });
        socket_1.socketManager.emitToOrder(id, 'order_status_updated', { status: 'Preparing', orderId: id, order: updated });
        const targetCustPrep = updated?.customer_id || updated?.customerId || updated?.user_id;
        if (targetCustPrep) {
            socket_1.socketManager.emitToUser('customer', targetCustPrep, 'order_status_updated', { status: 'Preparing', orderId: id, order: updated });
            fcmPushService_1.fcmPushService.dispatchToCustomer(String(targetCustPrep), {
                title: 'Order Preparing 🍳',
                body: `Your order #${updated?.order_number || id} is being prepared by the vendor.`,
                targetId: String(id),
                orderId: String(id),
                category: updated?.category || 'Products',
                segment: 'Orders',
                data: {
                    orderId: String(id),
                    status: 'Preparing',
                    targetScreen: 'Orders',
                },
            }).catch(() => { });
        }
        await realtime_1.eventPublisher.publishEvent(realtime_1.RealtimeEntities.ORDER, realtime_1.RealtimeActions.STATUS_CHANGED, id, { orderId: id, status: 'Preparing', updated }, { room: `order:${id}` });
        res.json({
            status: 'success',
            message: 'Order status updated to Preparing.',
            data: updated
        });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
// POST: /api/orders/:id/ready
router.post('/:id/ready', middleware_1.authenticateToken, (0, middleware_1.enforceRoleAndApproval)('vendor', 'admin', 'superadmin'), async (req, res) => {
    const { id } = req.params;
    try {
        const updated = await db_1.db.updateOrderStatus(id, 'Ready For Pickup');
        if (!updated) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        await db_1.db.logStatusHistory({
            order_id: id,
            status: 'Ready For Pickup',
            updated_by: 'Vendor',
            notes: 'Order is packed and ready for pickup'
        });
        socket_1.socketManager.emitToOrder(id, 'order_status_updated', { status: 'Ready For Pickup', orderId: id, order: updated });
        const targetCustReady = updated?.customer_id || updated?.customerId || updated?.user_id;
        if (targetCustReady) {
            socket_1.socketManager.emitToUser('customer', targetCustReady, 'order_status_updated', { status: 'Ready For Pickup', orderId: id, order: updated });
            fcmPushService_1.fcmPushService.dispatchToCustomer(String(targetCustReady), {
                title: 'Order Ready For Pickup 📦',
                body: `Your order #${updated?.order_number || id} is packed and ready for delivery/pickup.`,
                targetId: String(id),
                orderId: String(id),
                category: updated?.category || 'Products',
                segment: 'Orders',
                data: {
                    orderId: String(id),
                    status: 'Ready For Pickup',
                    targetScreen: 'Orders',
                },
            }).catch(() => { });
        }
        await realtime_1.eventPublisher.publishEvent(realtime_1.RealtimeEntities.ORDER, realtime_1.RealtimeActions.STATUS_CHANGED, id, { orderId: id, status: 'Ready For Pickup', updated }, { room: `order:${id}` });
        // Trigger auto-assignment if not already assigned
        const currentAssignment = await db_1.db.getAssignmentForOrder(id);
        if (!currentAssignment || currentAssignment.status === 'Rejected') {
            setTimeout(async () => {
                await runAutoAssignment(id);
            }, 1000);
        }
        res.json({
            status: 'success',
            message: 'Order is ready. Triggered auto-assignment engine.',
            data: updated
        });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
// POST: /api/orders/:id/rate
router.post('/:id/rate', middleware_1.optionalAuthenticateToken, async (req, res) => {
    const { id } = req.params;
    const { rating, comment, role, partnerId } = req.body;
    if (!rating) {
        return res.status(400).json({
            status: 'error',
            message: 'Rating value is required.'
        });
    }
    try {
        const rateId = 'r_' + Math.floor(1000 + Math.random() * 9000);
        const newRating = await db_1.db.createRating({
            id: rateId,
            order_id: id,
            rating_value: Number(rating),
            comment: comment || '',
            rater_role: role || 'Customer',
            target_partner_id: partnerId || 'dp1',
            timestamp: new Date().toISOString()
        });
        const mongoDb = db_1.db.getDb();
        if (mongoDb) {
            const orderFilter = [{ id: id }, { order_number: id }, { orderId: id }];
            if (mongodb_1.ObjectId.isValid(id))
                orderFilter.push({ _id: new mongodb_1.ObjectId(id) });
            await mongoDb.collection('orders').updateOne({ $or: orderFilter }, {
                $set: {
                    rating: Number(rating),
                    ratingComment: comment || '',
                    ratedAt: new Date().toISOString()
                }
            });
        }
        // Recalculate average rating of delivery partner if partnerId exists
        if (partnerId) {
            const ratings = await db_1.db.getRatings(partnerId);
            if (ratings && ratings.length > 0) {
                const avgRating = parseFloat((ratings.reduce((acc, r) => acc + r.rating_value, 0) / ratings.length).toFixed(1));
                await db_1.db.updateDeliveryPartner(partnerId, {
                    rating: avgRating
                });
            }
        }
        res.json({
            status: 'success',
            message: 'Rating submitted successfully.',
            data: newRating
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to record rating: ' + error.message
        });
    }
});
// PUT: /api/orders/:id/status (Workflow & Business Logic State Transition Security)
router.put('/:id/status', middleware_1.authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const ALLOWED_STATUSES = [
        'Pending', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery',
        'Delivered', 'Cancelled', 'Rejected', 'Completed'
    ];
    if (!status || typeof status !== 'string' || !ALLOWED_STATUSES.includes(status.trim())) {
        return res.status(400).json({
            status: 'error',
            message: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}`
        });
    }
    const cleanStatus = status.trim();
    const authUser = req.user;
    if (!authUser) {
        return res.status(401).json({
            status: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required to update order status.'
        });
    }
    // Find the target order
    const existingOrder = await db_1.db.getOrder(id);
    if (!existingOrder) {
        return res.status(404).json({ status: 'error', message: 'Order not found' });
    }
    // Authorization Boundary: Customers can only cancel their OWN orders
    if (authUser.role === 'customer') {
        if (cleanStatus !== 'Cancelled') {
            return res.status(403).json({
                status: 'error',
                message: 'Customer accounts are only permitted to cancel pending orders.'
            });
        }
        const selfCustId = authUser.customerId || authUser.userId || authUser.registrationId;
        const orderCustId = existingOrder.customer_id || existingOrder.customerId;
        const orderEmail = (existingOrder.customer_email || '').toLowerCase().trim();
        const authEmail = (authUser.email || '').toLowerCase().trim();
        const isMatch = (orderCustId && (orderCustId === selfCustId || orderCustId === authUser.userId)) ||
            (orderEmail && authEmail && orderEmail === authEmail);
        if (!isMatch) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied: You can only cancel your own orders.'
            });
        }
    }
    else if (authUser.role === 'vendor') {
        if (existingOrder.vendor_id && authUser.vendorId && existingOrder.vendor_id !== authUser.vendorId) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied: You do not have permission to update status for another vendor\'s order.'
            });
        }
    }
    else if (!['delivery', 'admin', 'superadmin'].includes(authUser.role)) {
        return res.status(403).json({
            status: 'error',
            message: 'Access denied: Unauthorized role to update order status.'
        });
    }
    try {
        const updated = await db_1.db.updateOrderStatus(id, cleanStatus);
        if (!updated) {
            return res.status(404).json({ status: 'error', message: 'Order not found' });
        }
        const updater = authUser?.role ? `${authUser.role.charAt(0).toUpperCase() + authUser.role.slice(1)}` : 'Vendor';
        const previousStatus = existingOrder.status || 'Pending';
        await db_1.db.logStatusHistory({
            order_id: id,
            status: cleanStatus,
            updated_by: updater,
            notes: `Order status updated from "${previousStatus}" to "${cleanStatus}" by ${updater}`
        });
        const vendorId = existingOrder.vendor_id || existingOrder.vendorId || updated?.vendor_id || updated?.vendorId;
        const catStr = String(existingOrder.category || updated?.category || '').toLowerCase();
        const typeStr = String(existingOrder.type || updated?.type || '').toLowerCase();
        const ordNumStr = String(updated.order_number || id).toUpperCase();
        const isJob = catStr.includes('job') || typeStr.includes('job') || ordNumStr.startsWith('JOB') || Boolean(existingOrder.jobTitle || updated?.jobTitle);
        const isBooking = !isJob && (catStr.includes('service') || catStr.includes('stay') || catStr.includes('travel') ||
            typeStr.includes('service') || typeStr.includes('stay') || typeStr.includes('travel') ||
            typeStr.includes('booking') || typeStr.includes('appointment') || ordNumStr.startsWith('BKG') ||
            Boolean(existingOrder.appointmentDate || existingOrder.checkInDate || existingOrder.travelDate || existingOrder.serviceName || existingOrder.bus_name));
        const category = isJob ? 'Job' : (isBooking ? 'Booking' : 'Order');
        const customerName = updated?.customer_name || updated?.memberName || updated?.candidateName || existingOrder.customer_name || existingOrder.memberName || 'Customer';
        const resolvedItemName = updated?.product_details || updated?.items?.[0]?.name || existingOrder.product_details || (existingOrder.items && existingOrder.items[0]?.name) || existingOrder.serviceName || existingOrder.bus_name || existingOrder.jobTitle || 'Item';
        const finalAmount = updated.finalAmount || updated.totalAmount || updated.amount || 0;
        const statusPayload = {
            orderId: id,
            id,
            order_number: updated.order_number || id,
            previousStatus,
            newStatus: cleanStatus,
            status: cleanStatus,
            orderStatus: cleanStatus,
            category,
            customerName,
            memberName: customerName,
            customer_name: customerName,
            itemName: resolvedItemName,
            product_details: resolvedItemName,
            amount: finalAmount,
            businessName: updated?.businessName || existingOrder.businessName || '',
            description: `Status changed from "${previousStatus}" to "${cleanStatus}"`,
            timestamp: new Date().toISOString(),
            order: updated,
            data: updated
        };
        socket_1.socketManager.emitToOrder(id, 'order_status_updated', statusPayload);
        const targetCustGen = updated?.customer_id || updated?.customerId || updated?.user_id;
        if (targetCustGen) {
            socket_1.socketManager.emitToUser('customer', targetCustGen, 'order_status_updated', statusPayload);
            fcmPushService_1.fcmPushService.dispatchToCustomer(String(targetCustGen), {
                title: `${category} Status Updated`,
                body: `${existingOrder.itemName || existingOrder.product_details || 'Your order'} (#${existingOrder.order_number || id}): ${previousStatus} → ${cleanStatus}`,
                targetId: String(id),
                orderId: String(id),
                category,
                segment: isJob ? 'Jobs' : (isBooking ? 'Bookings' : 'Orders'),
                data: {
                    orderId: String(id),
                    previousStatus,
                    newStatus: cleanStatus,
                    status: cleanStatus,
                    screen: 'Orders',
                }
            }).catch(() => { });
        }
        if (vendorId) {
            socket_1.socketManager.emitToVendor(String(vendorId), 'order_status_updated', statusPayload);
            socket_1.socketManager.emitToVendor(String(vendorId), 'ORDER_STATUS_CHANGED', statusPayload);
            if (isBooking) {
                socket_1.socketManager.emitToVendor(String(vendorId), 'BOOKING_STATUS_CHANGED', statusPayload);
            }
            else if (isJob) {
                socket_1.socketManager.emitToVendor(String(vendorId), 'APPLICATION_STATUS_CHANGED', statusPayload);
            }
            fcmPushService_1.fcmPushService.dispatchToVendor(String(vendorId), {
                title: `${category} Status Updated`,
                body: `${existingOrder.itemName || existingOrder.product_details || 'Item'} (#${existingOrder.order_number || id}): ${previousStatus} → ${cleanStatus}`,
                targetId: String(id),
                orderId: String(id),
                category,
                segment: isJob ? 'Jobs' : (isBooking ? 'Bookings' : 'Orders'),
                data: {
                    orderId: String(id),
                    previousStatus,
                    newStatus: cleanStatus,
                    status: cleanStatus,
                }
            }).catch(() => { });
        }
        // Insert persistent notification record in MongoDB collection
        const mongoDb = db_1.db.getDb();
        if (mongoDb && vendorId) {
            const notifDoc = {
                recipientId: String(vendorId),
                vendorId: String(vendorId),
                role: 'vendor',
                category,
                title: `${category} Status Updated`,
                orderId: id,
                orderNumber: updated.order_number || id,
                customerName,
                itemName: resolvedItemName,
                previousStatus,
                newStatus: cleanStatus,
                status: cleanStatus,
                amount: finalAmount,
                businessName: updated?.businessName || existingOrder.businessName || '',
                description: `Status changed from "${previousStatus}" to "${cleanStatus}"`,
                read: false,
                isRead: false,
                createdAt: new Date(),
                created_at: new Date().toISOString(),
                date: new Date().toISOString()
            };
            await mongoDb.collection('notifications').insertOne(notifDoc).catch((e) => {
                console.warn('Vendor status notif persistence warning:', e.message);
            });
        }
        // Forward status change downstream to Vendor Backend URL if configured
        const vendorBackendUrl = process.env.VENDOR_BACKEND_URL;
        if (vendorBackendUrl) {
            try {
                const cleanVendorUrl = vendorBackendUrl.trim().replace(/\/+$/, '');
                const myPort = String(process.env.PORT || 8001);
                if (!cleanVendorUrl.includes(`:${myPort}`)) {
                    fetch(`${cleanVendorUrl}/api/vendor/orders/${id}/status`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'authorization': req.headers.authorization || ''
                        },
                        body: JSON.stringify({ status: cleanStatus })
                    }).catch(() => { });
                }
            }
            catch (e) { }
        }
        await realtime_1.eventPublisher.publishEvent(realtime_1.RealtimeEntities.ORDER, realtime_1.RealtimeActions.STATUS_CHANGED, id, statusPayload, { room: `order:${id}` });
        res.json({
            status: 'success',
            message: `Order status updated to ${status}.`,
            data: updated
        });
    }
    catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
exports.default = router;
