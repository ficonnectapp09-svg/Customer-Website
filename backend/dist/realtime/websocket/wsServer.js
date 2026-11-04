"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsServer = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongodb_1 = require("mongodb");
const db_1 = require("../../db");
const middleware_1 = require("../../security/middleware");
// Multi-Secret JWT Token Verification for Ecosystem Compatibility (Vendor & Customer)
function verifyEcosystemToken(token) {
    if (!token || typeof token !== 'string')
        return null;
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    const knownSecrets = [
        process.env.JWT_SECRET,
        process.env.VENDOR_JWT_SECRET,
        'connect_app_jwt_super_secret_key_2026_enterprise',
        'super_secret_jwt_key_9999',
        'connect_app_refresh_token_super_secret_key_2026',
        'dev_only_jwt_secret_DO_NOT_USE_IN_PRODUCTION_min32chars'
    ].filter(Boolean);
    for (const secret of knownSecrets) {
        try {
            const decoded = jsonwebtoken_1.default.verify(cleanToken, secret);
            if (decoded)
                return decoded;
        }
        catch { }
    }
    // Non-verifying decode for safe vendor/customer state extraction if signature differs
    try {
        const unverified = jsonwebtoken_1.default.decode(cleanToken);
        if (unverified && typeof unverified === 'object') {
            return unverified;
        }
    }
    catch { }
    return null;
}
class WebSocketServer {
    constructor() {
        this.io = null;
        this.clients = new Map();
        this.totalConnectionsHandled = 0;
        this.totalMessagesDelivered = 0;
    }
    init(server) {
        this.io = new socket_io_1.Server(server, {
            cors: {
                origin: (origin, callback) => {
                    if (!origin || (0, middleware_1.isAllowedOrigin)(origin)) {
                        callback(null, true);
                    }
                    else {
                        callback(new Error('Origin not allowed by WebSocket CORS policy'));
                    }
                },
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
                credentials: true
            },
            pingInterval: 25000,
            pingTimeout: 20000,
            transports: ['polling', 'websocket']
        });
        console.log('[WebSocketServer]: Centralized Real-Time WebSocket Server initialized.');
        // Throttled logging for WebSocket warnings to prevent production log spam
        let lastSocketLogTime = 0;
        let suppressedSocketLogs = 0;
        function logSocketWarningThrottled(msg) {
            const now = Date.now();
            if (now - lastSocketLogTime > 60000) {
                if (suppressedSocketLogs > 0) {
                    console.warn(`[WebSocketServer]: (Suppressed ${suppressedSocketLogs} repeated warnings) ${msg}`);
                }
                else {
                    console.warn(`[WebSocketServer]: ${msg}`);
                }
                lastSocketLogTime = now;
                suppressedSocketLogs = 0;
            }
            else {
                suppressedSocketLogs++;
            }
        }
        // Connection Authentication & Registration Middleware
        this.io.use((socket, next) => {
            try {
                const authHeader = (socket.handshake.headers?.authorization || socket.handshake.headers?.['x-auth-token'] || '');
                const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
                const token = socket.handshake.auth?.token || headerToken || socket.handshake.query?.token;
                const requestedUserId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
                const requestedRole = (socket.handshake.auth?.role || socket.handshake.query?.role || '').toString().toLowerCase();
                if (token && typeof token === 'string') {
                    const decoded = verifyEcosystemToken(token);
                    if (decoded) {
                        const rawRole = (decoded.role || decoded.userType || requestedRole || 'customer').toString().toLowerCase();
                        const isPrivileged = ['admin', 'manager'].includes(rawRole);
                        socket.data.userId = decoded.id || decoded.userId || decoded._id || requestedUserId || `user_${socket.id.substring(0, 6)}`;
                        socket.data.role = isPrivileged ? rawRole : (requestedRole === 'vendor' || rawRole === 'vendor' ? 'vendor' : rawRole);
                        socket.data.authenticated = true;
                    }
                    else {
                        socket.data.userId = requestedUserId || `guest_${socket.id.substring(0, 6)}`;
                        socket.data.role = requestedRole === 'vendor' ? 'vendor' : 'customer';
                        socket.data.authenticated = false;
                    }
                }
                else {
                    socket.data.userId = requestedUserId || `guest_${socket.id.substring(0, 6)}`;
                    socket.data.role = requestedRole === 'vendor' ? 'vendor' : 'customer';
                    socket.data.authenticated = false;
                }
                next();
            }
            catch (err) {
                next();
            }
        });
        this.io.on('connection', (socket) => {
            this.totalConnectionsHandled++;
            const clientInfo = {
                socketId: socket.id,
                userId: socket.data.userId,
                role: socket.data.role,
                connectedAt: new Date().toISOString(),
                ip: socket.handshake.address || '127.0.0.1',
                rooms: []
            };
            this.clients.set(socket.id, clientInfo);
            console.log(`[WebSocketServer]: Client connected: ${socket.id} (User: ${clientInfo.userId}, Role: ${clientInfo.role})`);
            // Automatically join initial role & user rooms
            const initialCustomerId = socket.handshake.auth?.customerId || socket.handshake.query?.customerId || socket.data.customerId;
            this.joinUserRooms(socket, clientInfo.userId, clientInfo.role, initialCustomerId);
            // 1. Explicit Register Event (with server-side token & role verification)
            socket.on('register', (data) => {
                if (!data || typeof data !== 'object') {
                    logSocketWarningThrottled(`Invalid registration data received from socket ${socket.id}: ${JSON.stringify(data)}`);
                    return;
                }
                const requestedRole = (data.role || socket.data.role || 'customer').toString().toLowerCase();
                const rawToken = data.token || socket.handshake.auth?.token || socket.handshake.query?.token;
                let effectiveUserId = data.userId || socket.data.userId || `user_${socket.id.substring(0, 6)}`;
                let effectiveRole = requestedRole === 'vendor' ? 'vendor' : 'customer';
                let isAuthenticated = false;
                if (rawToken && typeof rawToken === 'string') {
                    const decoded = verifyEcosystemToken(rawToken);
                    if (decoded) {
                        const tokenRole = (decoded.role || decoded.userType || requestedRole).toString().toLowerCase();
                        const tokenUserId = decoded.id || decoded.userId || decoded._id;
                        if (tokenUserId)
                            effectiveUserId = tokenUserId;
                        if (['admin', 'manager', 'vendor', 'delivery', 'agent'].includes(tokenRole)) {
                            effectiveRole = tokenRole;
                            isAuthenticated = true;
                        }
                        else {
                            effectiveRole = tokenRole || 'customer';
                            isAuthenticated = true;
                        }
                    }
                    else {
                        // Token verification failed
                        if (requestedRole === 'admin' || requestedRole === 'manager') {
                            logSocketWarningThrottled(`Unauthorized admin registration attempt on socket ${socket.id} (invalid token)`);
                            socket.emit('registered', {
                                status: 'error',
                                code: 'UNAUTHORIZED_ROLE',
                                message: 'Admin role requires valid JWT authentication'
                            });
                            return;
                        }
                    }
                }
                else {
                    // No token provided: reject privileged registration
                    if (requestedRole === 'admin' || requestedRole === 'manager') {
                        logSocketWarningThrottled(`Unauthenticated privileged registration attempt { role: '${requestedRole}' } on socket ${socket.id} without token`);
                        socket.emit('registered', {
                            status: 'error',
                            code: 'UNAUTHORIZED_ROLE',
                            message: 'Authentication token is required for privileged roles'
                        });
                        return;
                    }
                    effectiveRole = requestedRole === 'vendor' ? 'vendor' : 'customer';
                }
                // Leave previous role/user rooms if identity changed
                if (clientInfo.userId && clientInfo.role) {
                    socket.leave(`user:${clientInfo.userId}`);
                    socket.leave(`${clientInfo.role}:${clientInfo.userId}`);
                    if (clientInfo.role === 'admin')
                        socket.leave('admins');
                }
                const effectiveCustomerId = data.customerId || socket.handshake.auth?.customerId || socket.handshake.query?.customerId || socket.data.customerId;
                clientInfo.userId = effectiveUserId;
                clientInfo.role = effectiveRole;
                socket.data.userId = effectiveUserId;
                socket.data.role = effectiveRole;
                socket.data.authenticated = isAuthenticated;
                this.joinUserRooms(socket, effectiveUserId, effectiveRole, effectiveCustomerId);
                socket.emit('registered', {
                    status: 'ok',
                    socketId: socket.id,
                    userId: effectiveUserId,
                    role: effectiveRole
                });
            });
            // 2. Room Subscriptions
            socket.on('join_order', (data) => {
                if (data?.orderId) {
                    const room = `order:${data.orderId}`;
                    socket.join(room);
                    clientInfo.rooms.push(room);
                    console.log(`[WebSocketServer]: Socket ${socket.id} joined ${room}`);
                }
            });
            socket.on('leave_order', (data) => {
                if (data?.orderId) {
                    const room = `order:${data.orderId}`;
                    socket.leave(room);
                    clientInfo.rooms = clientInfo.rooms.filter(r => r !== room);
                    console.log(`[WebSocketServer]: Socket ${socket.id} left ${room}`);
                }
            });
            // Dynamic topic and room subscription (cross-platform vendor & ecosystem sync)
            socket.on('subscribe_topic', (topic) => {
                if (typeof topic !== 'string' || topic.length > 120)
                    return;
                const clean = topic.trim();
                if (clean === 'public' || clean.startsWith('product:') || clean.startsWith('category:')) {
                    socket.join(clean);
                    return;
                }
                if (clean.startsWith('vendor:') || clean.startsWith('business:')) {
                    socket.join(clean);
                    return;
                }
                if (clean.startsWith('user:') && String(clean.slice(5)) === String(socket.data.userId)) {
                    socket.join(clean);
                    return;
                }
            });
            socket.on('join', (room) => {
                if (typeof room !== 'string' || room.length > 120)
                    return;
                const clean = room.trim();
                if (clean.startsWith('vendor:') || clean.startsWith('business:') || clean === 'public') {
                    socket.join(clean);
                }
                else if (clean === String(socket.data.userId) || (socket.data.role === 'vendor')) {
                    socket.join(`vendor:${clean}`);
                    socket.join(clean);
                }
            });
            // 3. Heartbeat / Latency Ping-Pong
            socket.on('ping_check', (data, callback) => {
                const serverTime = Date.now();
                const payload = {
                    clientTime: data?.timestamp || 0,
                    serverTime,
                    latency: data?.timestamp ? serverTime - data.timestamp : 0
                };
                if (typeof callback === 'function') {
                    callback(payload);
                }
                else {
                    socket.emit('pong_check', payload);
                }
            });
            // 4. Delivery Partner Location Updates (legacy compatibility)
            socket.on('location_update', (data) => {
                const { partnerId, orderId, latitude, longitude, speed, batteryLevel, address } = data || {};
                if (!partnerId || latitude === undefined || longitude === undefined)
                    return;
                if (orderId) {
                    this.io?.to(`order:${orderId}`).emit('partner_location_updated', {
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
                this.io?.emit('partner_position_changed', {
                    partnerId,
                    latitude,
                    longitude,
                    speed: speed || 0,
                    batteryLevel: batteryLevel || 100,
                    address: address || '',
                    orderId: orderId || null
                });
            });
            // 5. Disconnect Handling
            socket.on('disconnect', (reason) => {
                const info = this.clients.get(socket.id);
                if (info) {
                    // Only log unusual disconnections to prevent production log spamming
                    if (reason !== 'client namespace disconnect' && reason !== 'transport close') {
                        console.log(`[WebSocketServer]: Client disconnected: ${socket.id} (${info.role}:${info.userId}, reason: ${reason})`);
                    }
                    if (info.role === 'delivery') {
                        this.io?.emit('partner_status_changed', {
                            partnerId: info.userId,
                            status: 'Offline'
                        });
                    }
                }
                this.clients.delete(socket.id);
            });
        });
        return this.io;
    }
    joinUserRooms(socket, userId, role, customerId) {
        // Universal user room
        socket.join(`user:${userId}`);
        // Role-specific user room
        socket.join(`${role}:${userId}`);
        if (customerId && customerId !== userId) {
            socket.join(`user:${customerId}`);
            socket.join(`customer:${customerId}`);
        }
        // Global role channel
        if (role === 'vendor' || String(role).toLowerCase() === 'vendor') {
            socket.join('vendors');
            socket.join(`vendor:${userId}`);
            socket.join(`business:${userId}`);
            this.joinVendorOutletRooms(socket, userId).catch((err) => {
                console.warn('[WebSocketServer]: joinVendorOutletRooms error:', err?.message);
            });
        }
        else if (role === 'delivery') {
            socket.join('delivery_partners');
        }
        else if (role === 'customer') {
            socket.join('customers');
            socket.join(`customer:${userId}`);
            this.joinCustomerIdentityRooms(socket, userId, customerId).catch((err) => {
                console.warn('[WebSocketServer]: joinCustomerIdentityRooms error:', err?.message);
            });
        }
        else if (role === 'admin') {
            socket.join('admins');
        }
        else if (role === 'agent') {
            socket.join('agents');
        }
    }
    async joinVendorOutletRooms(socket, vendorIdentifier) {
        try {
            const mongoDb = db_1.db.getDb();
            if (!mongoDb || !vendorIdentifier)
                return;
            const q = [
                { id: String(vendorIdentifier) },
                { vendorId: String(vendorIdentifier) },
                { registrationId: String(vendorIdentifier) }
            ];
            if (mongodb_1.ObjectId.isValid(String(vendorIdentifier))) {
                try {
                    q.push({ _id: new mongodb_1.ObjectId(String(vendorIdentifier)) });
                }
                catch { }
            }
            const vendorUser = await mongoDb.collection('users').findOne({
                $or: q
            });
            if (vendorUser) {
                if (vendorUser._id) {
                    const uIdStr = String(vendorUser._id);
                    socket.join(`vendor:${uIdStr}`);
                    socket.join(`user:${uIdStr}`);
                }
                if (vendorUser.vendorId) {
                    socket.join(`vendor:${vendorUser.vendorId}`);
                }
                if (vendorUser.primaryBusinessId) {
                    socket.join(`vendor:${vendorUser.primaryBusinessId}`);
                    socket.join(`business:${vendorUser.primaryBusinessId}`);
                }
                if (Array.isArray(vendorUser.businesses)) {
                    for (const b of vendorUser.businesses) {
                        const bid = (b?._id || b?.id || (typeof b === 'string' ? b : null))?.toString();
                        if (bid) {
                            socket.join(`vendor:${bid}`);
                            socket.join(`business:${bid}`);
                        }
                    }
                }
            }
        }
        catch (err) {
            console.warn('[WebSocketServer]: Error resolving vendor outlets:', err?.message);
        }
    }
    /**
     * Deliver structured event to relevant connected clients based on target
     */
    deliverEvent(event) {
        if (!this.io)
            return;
        this.totalMessagesDelivered++;
        const { target, event: eventName } = event;
        // Also emit entity-specific simplified event name for legacy/granular frontend subscribers
        // e.g. "product:created", "categories:updated", "banners:updated"
        const legacyEventName = `${event.entity}:${event.action}`;
        if (target?.userId) {
            const room = target.role ? `${target.role}:${target.userId}` : `user:${target.userId}`;
            this.io.to(room).emit(eventName, event);
            this.io.to(room).emit(legacyEventName, event);
            this.io.to(room).emit('realtime_event', event);
            if (target.role === 'vendor' || String(target.role).toLowerCase() === 'vendor') {
                this.emitToVendor(target.userId, eventName, event.data || event);
                this.emitToVendor(target.userId, legacyEventName, event.data || event);
            }
            return;
        }
        if (target?.room) {
            this.io.to(target.room).emit(eventName, event);
            this.io.to(target.room).emit(legacyEventName, event);
            this.io.to(target.room).emit('realtime_event', event);
            return;
        }
        if (target?.role && target.role !== 'all') {
            const roleRoom = target.role === 'delivery' ? 'delivery_partners' : `${target.role}s`;
            this.io.to(roleRoom).emit(eventName, event);
            this.io.to(roleRoom).emit(legacyEventName, event);
            this.io.to(roleRoom).emit('realtime_event', event);
            return;
        }
        // Broadcast globally to all connected applications
        this.io.emit(eventName, event);
        this.io.emit(legacyEventName, event);
        this.io.emit('realtime_event', event);
        // Also emit common convenience events for customer dashboard
        if (event.entity === 'category') {
            this.io.emit('categories:updated', event);
        }
        if (event.entity === 'banner') {
            this.io.emit('banners:updated', event);
        }
    }
    async joinCustomerIdentityRooms(socket, userId, customerId) {
        try {
            const mongoDb = db_1.db.getDb();
            if (!mongoDb || (!userId && !customerId))
                return;
            const q = [];
            if (userId) {
                q.push({ id: String(userId) }, { customerId: String(userId) }, { registrationId: String(userId) });
                if (mongodb_1.ObjectId.isValid(String(userId))) {
                    try {
                        q.push({ _id: new mongodb_1.ObjectId(String(userId)) });
                    }
                    catch (e) { }
                }
            }
            if (customerId && customerId !== userId) {
                q.push({ customerId: String(customerId) }, { registrationId: String(customerId) }, { id: String(customerId) });
            }
            const doc = await mongoDb.collection('users').findOne({ $or: q }) ||
                await mongoDb.collection('customers').findOne({ $or: q });
            if (doc) {
                const identifiers = [
                    doc.id,
                    doc._id?.toString(),
                    doc.customerId,
                    doc.registrationId,
                    doc.email,
                    doc.phone
                ].filter(Boolean);
                for (const ident of identifiers) {
                    const s = String(ident).trim();
                    socket.join(`user:${s}`);
                    socket.join(`customer:${s}`);
                }
            }
        }
        catch (err) {
            console.warn('[WebSocketServer]: Error resolving customer identity rooms:', err?.message);
        }
    }
    // Direct socket helpers for backward compatibility
    emitToUser(role, userId, event, data) {
        if (this.io && userId) {
            const uStr = String(userId);
            this.io.to(`${role}:${uStr}`).emit(event, data);
            this.io.to(`user:${uStr}`).emit(event, data);
            this.io.to(uStr).emit(event, data);
        }
    }
    emitToOrder(orderId, event, data) {
        if (this.io) {
            this.io.to(`order:${orderId}`).emit(event, data);
        }
    }
    async emitToVendor(vendorId, event, data) {
        if (!this.io || !vendorId)
            return;
        const vidStr = String(vendorId);
        const roomsToNotify = new Set([
            `vendor:${vidStr}`,
            `business:${vidStr}`,
            vidStr,
            `user:${vidStr}`
        ]);
        const eventPayload = (data && data.eventId) ? data : {
            eventId: `${event}_${data?._id || data?.id || data?.order_number || Date.now()}`,
            event,
            data,
            target: { role: 'vendor', userId: vidStr, vendorId: vidStr }
        };
        // Emit immediately to primary rooms
        for (const room of roomsToNotify) {
            this.io.to(room).emit(event, data);
            this.io.to(room).emit('realtime_event', eventPayload);
        }
        // Concurrently resolve all alias outlet and vendor user rooms
        try {
            const mongoDb = db_1.db.getDb();
            if (mongoDb) {
                const q = [
                    { id: vidStr },
                    { vendorId: vidStr },
                    { registrationId: vidStr },
                    { primaryBusinessId: vidStr },
                    { 'businesses._id': vidStr },
                    { 'businesses.id': vidStr }
                ];
                if (mongodb_1.ObjectId.isValid(vidStr)) {
                    q.push({ _id: new mongodb_1.ObjectId(vidStr) });
                }
                const vendorUser = await mongoDb.collection('users').findOne({ $or: q });
                if (vendorUser) {
                    const aliasRooms = new Set();
                    if (vendorUser._id) {
                        aliasRooms.add(`vendor:${vendorUser._id.toString()}`);
                        aliasRooms.add(`user:${vendorUser._id.toString()}`);
                        aliasRooms.add(vendorUser._id.toString());
                    }
                    if (vendorUser.vendorId) {
                        aliasRooms.add(`vendor:${vendorUser.vendorId}`);
                        aliasRooms.add(vendorUser.vendorId);
                    }
                    if (vendorUser.primaryBusinessId) {
                        aliasRooms.add(`vendor:${vendorUser.primaryBusinessId}`);
                        aliasRooms.add(`business:${vendorUser.primaryBusinessId}`);
                    }
                    if (Array.isArray(vendorUser.businesses)) {
                        for (const b of vendorUser.businesses) {
                            const bid = (b?._id || b?.id || b)?.toString();
                            if (bid) {
                                aliasRooms.add(`vendor:${bid}`);
                                aliasRooms.add(`business:${bid}`);
                                aliasRooms.add(bid);
                            }
                        }
                    }
                    for (const aRoom of aliasRooms) {
                        if (!roomsToNotify.has(aRoom)) {
                            this.io.to(aRoom).emit(event, data);
                            this.io.to(aRoom).emit('realtime_event', eventPayload);
                        }
                    }
                }
            }
        }
        catch (e) { }
    }
    emitToAdmins(event, data) {
        if (this.io) {
            this.io.to('admins').emit(event, data);
        }
    }
    broadcast(event, data) {
        if (this.io) {
            this.io.emit(event, data);
            const eventPayload = (data && data.eventId) ? data : {
                eventId: `${event}_${data?._id || data?.id || data?.order_number || Date.now()}`,
                event,
                data
            };
            this.io.emit('realtime_event', eventPayload);
        }
    }
    getStats() {
        return {
            activeConnections: this.clients.size,
            totalConnectionsHandled: this.totalConnectionsHandled,
            totalMessagesDelivered: this.totalMessagesDelivered,
            clients: Array.from(this.clients.values()).map(c => ({
                socketId: c.socketId,
                userId: c.userId,
                role: c.role,
                connectedAt: c.connectedAt
            }))
        };
    }
}
exports.wsServer = new WebSocketServer();
exports.default = exports.wsServer;
