"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fcmPushService = void 0;
const https_1 = __importDefault(require("https"));
const db_1 = require("../db");
const mongodb_1 = require("mongodb");
class FcmPushService {
    constructor() {
        this.serverKey =
            process.env.FCM_SERVER_KEY ||
                process.env.FIREBASE_SERVER_KEY ||
                '';
    }
    /**
     * Dispatch push notification to registered vendor device tokens
     */
    async dispatchToVendor(vendorId, payload) {
        if (!vendorId) {
            return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'No vendorId provided' };
        }
        try {
            const mongoDb = db_1.db.getDb();
            if (!mongoDb) {
                return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'Database unavailable' };
            }
            const vidStr = vendorId.toString();
            const targetConditions = [
                { userId: vidStr },
                { vendorId: vidStr },
                { targetId: vidStr },
                { vendorIds: vidStr },
                { businessIds: vidStr },
            ];
            if (mongodb_1.ObjectId.isValid(vidStr)) {
                targetConditions.push({ userId: new mongodb_1.ObjectId(vidStr) });
            }
            // Query registered tokens from MongoDB
            const tokenDocs = await mongoDb
                .collection('fcm_tokens')
                .find({ $or: targetConditions })
                .toArray()
                .catch(() => []);
            const tokens = [];
            tokenDocs.forEach((doc) => {
                if (doc && typeof doc.token === 'string' && doc.token.length > 10) {
                    tokens.push(doc.token);
                }
            });
            // Insert into notifications collection for persistent notification history
            try {
                await mongoDb.collection('notifications').insertOne({
                    vendorId: vidStr,
                    userId: vidStr,
                    title: payload.title,
                    body: payload.body,
                    targetId: payload.targetId || payload.orderId || '',
                    orderId: payload.targetId || payload.orderId || '',
                    category: payload.category || 'Orders',
                    segment: payload.segment || 'Orders',
                    data: payload.data || {},
                    isRead: false,
                    createdAt: new Date(),
                });
            }
            catch (insertErr) {
                // Non-blocking
            }
            if (tokens.length === 0) {
                console.log(`[FcmPushService] No registered FCM tokens found for vendor ${vidStr}`);
                return { success: true, tokensTargeted: 0, tokensDelivered: 0 };
            }
            console.log(`[FcmPushService] Dispatching push to ${tokens.length} tokens for vendor ${vidStr}`);
            let delivered = 0;
            for (const token of tokens) {
                const ok = await this.sendSinglePush(token, payload, true);
                if (ok)
                    delivered++;
            }
            return {
                success: delivered > 0,
                tokensTargeted: tokens.length,
                tokensDelivered: delivered,
            };
        }
        catch (err) {
            console.warn('[FcmPushService] Push dispatch warning:', err?.message || err);
            return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: err?.message };
        }
    }
    /**
     * Dispatch push notification to registered customer device tokens
     */
    async dispatchToCustomer(customerId, payload) {
        if (!customerId) {
            return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'No customerId provided' };
        }
        try {
            const mongoDb = db_1.db.getDb();
            if (!mongoDb) {
                return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'Database unavailable' };
            }
            const cidStr = customerId.toString();
            const targetConditions = [
                { userId: cidStr },
                { customerId: cidStr },
                { registrationId: cidStr },
                { phone: cidStr },
            ];
            if (mongodb_1.ObjectId.isValid(cidStr)) {
                targetConditions.push({ userId: new mongodb_1.ObjectId(cidStr) });
            }
            // Query registered customer tokens from MongoDB fcm_tokens
            const tokenDocs = await mongoDb
                .collection('fcm_tokens')
                .find({ $or: targetConditions })
                .toArray()
                .catch(() => []);
            const tokens = [];
            tokenDocs.forEach((doc) => {
                if (doc && typeof doc.token === 'string' && doc.token.length > 10) {
                    tokens.push(doc.token);
                }
            });
            // Insert into notifications collection for persistent notification history
            try {
                await mongoDb.collection('notifications').insertOne({
                    customerId: cidStr,
                    userId: cidStr,
                    role: 'customer',
                    title: payload.title,
                    body: payload.body,
                    targetId: payload.targetId || payload.orderId || '',
                    orderId: payload.targetId || payload.orderId || '',
                    category: payload.category || 'Orders',
                    segment: payload.segment || 'Orders',
                    data: payload.data || {},
                    isRead: false,
                    createdAt: new Date(),
                });
            }
            catch (insertErr) {
                // Non-blocking
            }
            if (tokens.length === 0) {
                console.log(`[FcmPushService] No registered FCM tokens found for customer ${cidStr}`);
                return { success: true, tokensTargeted: 0, tokensDelivered: 0 };
            }
            console.log(`[FcmPushService] Dispatching push to ${tokens.length} tokens for customer ${cidStr}`);
            let delivered = 0;
            for (const token of tokens) {
                const ok = await this.sendSinglePush(token, payload, false);
                if (ok)
                    delivered++;
            }
            return {
                success: delivered > 0,
                tokensTargeted: tokens.length,
                tokensDelivered: delivered,
            };
        }
        catch (err) {
            console.warn('[FcmPushService] Push dispatch to customer warning:', err?.message || err);
            return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: err?.message };
        }
    }
    /**
     * Send single message to FCM device token via FCM HTTP Endpoint
     */
    sendSinglePush(token, payload, isVendorTarget = false) {
        return new Promise((resolve) => {
            if (!this.serverKey) {
                // When server key is not configured, simulate successful queueing
                console.log(`[FcmPushService] FCM server key not set in env; logged payload for token ${token.substring(0, 15)}...`);
                return resolve(true);
            }
            // Dynamically resolve target channel and sound based on role and category
            let resolvedChannel = 'connect_orders_realtime_channel';
            let resolvedSound = 'default';
            const catLower = String(payload.category || '').toLowerCase();
            const isVendor = isVendorTarget || token.includes('ven_') || payload.data?.role === 'vendor' || payload.segment === 'Vendor' || payload.segment === 'Orders' || payload.segment === 'Bookings' || payload.segment === 'Jobs';
            if (isVendor) {
                resolvedChannel = (payload.title.includes('Status') || payload.title.includes('Updated')) ? 'vendor_updates_v1' : 'vendor_order_alerts_v2';
                resolvedSound = 'vendor_alert';
            }
            else {
                if (catLower.includes('offer') || catLower.includes('discount') || catLower.includes('deal')) {
                    resolvedChannel = 'connect_offers_channel';
                }
                else if (catLower.includes('membership') || catLower.includes('account') || catLower.includes('wallet')) {
                    resolvedChannel = 'connect_account_channel';
                }
                else if (catLower.includes('system') || catLower.includes('announcement')) {
                    resolvedChannel = 'connect_default_channel';
                }
                else {
                    resolvedChannel = 'connect_orders_realtime_channel';
                }
            }
            const postData = JSON.stringify({
                to: token,
                priority: 'high',
                notification: {
                    title: payload.title,
                    body: payload.body,
                    sound: resolvedSound,
                    channel_id: resolvedChannel,
                    android_channel_id: resolvedChannel,
                    click_action: 'OPEN_NOTIFICATION',
                },
                data: {
                    title: payload.title,
                    message: payload.body,
                    body: payload.body,
                    targetId: payload.targetId || payload.orderId || '',
                    orderId: payload.targetId || payload.orderId || '',
                    category: payload.category || (isVendor ? 'Orders' : 'order'),
                    segment: payload.segment || (isVendor ? 'Orders' : 'order'),
                    role: isVendor ? 'vendor' : 'customer',
                    ...(payload.data || {}),
                },
            });
            const options = {
                hostname: 'fcm.googleapis.com',
                port: 443,
                path: '/fcm/send',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `key=${this.serverKey}`,
                    'Content-Length': Buffer.byteLength(postData),
                },
            };
            const req = https_1.default.request(options, (res) => {
                let responseBody = '';
                res.on('data', (chunk) => (responseBody += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(true);
                    }
                    else {
                        console.warn('[FcmPushService] FCM API response code:', res.statusCode, responseBody);
                        if (responseBody && (responseBody.includes('NotRegistered') || responseBody.includes('InvalidRegistration'))) {
                            db_1.db.getDb()?.collection('fcm_tokens').deleteOne({ token }).catch(() => { });
                        }
                        resolve(false);
                    }
                });
            });
            req.on('error', (e) => {
                console.warn('[FcmPushService] Request error:', e.message);
                resolve(false);
            });
            req.setTimeout(5000, () => {
                req.destroy();
                resolve(false);
            });
            req.write(postData);
            req.end();
        });
    }
}
exports.fcmPushService = new FcmPushService();
