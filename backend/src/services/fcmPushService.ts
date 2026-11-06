import https from 'https';
import { db } from '../db';
import { ObjectId } from 'mongodb';

export interface FcmPushPayload {
  title: string;
  body: string;
  targetId?: string;
  orderId?: string;
  category?: string;
  segment?: string;
  data?: Record<string, any>;
}

export interface FcmDispatchResult {
  success: boolean;
  tokensTargeted: number;
  tokensDelivered: number;
  error?: string;
}

class FcmPushService {
  private serverKey: string;

  constructor() {
    this.serverKey =
      process.env.FCM_SERVER_KEY ||
      process.env.FIREBASE_SERVER_KEY ||
      '';
  }

  /**
   * Dispatch push notification to registered vendor device tokens
   */
  async dispatchToVendor(
    vendorId: string | ObjectId,
    payload: FcmPushPayload
  ): Promise<FcmDispatchResult> {
    if (!vendorId) {
      return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'No vendorId provided' };
    }

    try {
      const mongoDb = db.getDb();
      if (!mongoDb) {
        return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'Database unavailable' };
      }

      const vidStr = vendorId.toString();
      const allAssociatedIds = new Set<string>([vidStr]);

      // Resolve parent vendor user and all outlet IDs from database
      try {
        const q: any[] = [
          { id: vidStr },
          { vendorId: vidStr },
          { registrationId: vidStr },
          { primaryBusinessId: vidStr },
          { 'businesses._id': vidStr },
          { 'businesses.id': vidStr }
        ];
        if (ObjectId.isValid(vidStr)) {
          q.push({ _id: new ObjectId(vidStr) });
        }
        const vendorUser = await mongoDb.collection('users').findOne({ $or: q });
        if (vendorUser) {
          if (vendorUser._id) allAssociatedIds.add(vendorUser._id.toString());
          if (vendorUser.vendorId) allAssociatedIds.add(vendorUser.vendorId.toString());
          if (vendorUser.registrationId) allAssociatedIds.add(vendorUser.registrationId.toString());
          if (vendorUser.primaryBusinessId) allAssociatedIds.add(vendorUser.primaryBusinessId.toString());
          if (Array.isArray(vendorUser.businesses)) {
            for (const b of vendorUser.businesses) {
              const bid = (b?._id || b?.id || b)?.toString();
              if (bid) allAssociatedIds.add(bid);
            }
          }
        }
      } catch (err: any) {
        console.warn('[FcmPushService] Error resolving associated vendor IDs:', err?.message);
      }

      const idList = Array.from(allAssociatedIds);
      const targetConditions: any[] = [
        { userId: { $in: idList } },
        { vendorId: { $in: idList } },
        { targetId: { $in: idList } },
        { vendorIds: { $in: idList } },
        { businessIds: { $in: idList } },
      ];

      for (const id of idList) {
        if (ObjectId.isValid(id)) {
          targetConditions.push({ userId: new ObjectId(id) });
        }
      }

      // Query registered tokens from MongoDB
      const tokenDocs = await mongoDb
        .collection('fcm_tokens')
        .find({ $or: targetConditions })
        .toArray()
        .catch(() => []);

      const tokens: string[] = [];
      tokenDocs.forEach((doc: any) => {
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
      } catch (insertErr) {
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
        if (ok) delivered++;
      }

      return {
        success: delivered > 0,
        tokensTargeted: tokens.length,
        tokensDelivered: delivered,
      };
    } catch (err: any) {
      console.warn('[FcmPushService] Push dispatch warning:', err?.message || err);
      return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: err?.message };
    }
  }

  /**
   * Dispatch push notification to registered customer device tokens
   */
  async dispatchToCustomer(
    customerId: string | ObjectId,
    payload: FcmPushPayload
  ): Promise<FcmDispatchResult> {
    if (!customerId) {
      return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'No customerId provided' };
    }

    try {
      const mongoDb = db.getDb();
      if (!mongoDb) {
        return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: 'Database unavailable' };
      }

      const cidStr = customerId.toString();
      const targetConditions: any[] = [
        { userId: cidStr },
        { customerId: cidStr },
        { registrationId: cidStr },
        { phone: cidStr },
      ];

      if (ObjectId.isValid(cidStr)) {
        targetConditions.push({ userId: new ObjectId(cidStr) });
      }

      // Query registered customer tokens from MongoDB fcm_tokens
      const tokenDocs = await mongoDb
        .collection('fcm_tokens')
        .find({ $or: targetConditions })
        .toArray()
        .catch(() => []);

      const tokens: string[] = [];
      tokenDocs.forEach((doc: any) => {
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
      } catch (insertErr) {
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
        if (ok) delivered++;
      }

      return {
        success: delivered > 0,
        tokensTargeted: tokens.length,
        tokensDelivered: delivered,
      };
    } catch (err: any) {
      console.warn('[FcmPushService] Push dispatch to customer warning:', err?.message || err);
      return { success: false, tokensTargeted: 0, tokensDelivered: 0, error: err?.message };
    }
  }

  /**
   * Send single message to FCM device token via FCM HTTP Endpoint
   */
  private sendSinglePush(token: string, payload: FcmPushPayload, isVendorTarget: boolean = false): Promise<boolean> {
    return new Promise((resolve) => {
      const activeServerKey = this.serverKey || process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY || '';
      if (!activeServerKey) {
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
      } else {
        if (catLower.includes('offer') || catLower.includes('discount') || catLower.includes('deal')) {
          resolvedChannel = 'connect_offers_channel';
        } else if (catLower.includes('membership') || catLower.includes('account') || catLower.includes('wallet')) {
          resolvedChannel = 'connect_account_channel';
        } else if (catLower.includes('system') || catLower.includes('announcement')) {
          resolvedChannel = 'connect_default_channel';
        } else {
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

      const req = https.request(options, (res: any) => {
        let responseBody = '';
        res.on('data', (chunk: any) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            console.warn('[FcmPushService] FCM API response code:', res.statusCode, responseBody);
            if (responseBody && (responseBody.includes('NotRegistered') || responseBody.includes('InvalidRegistration'))) {
              db.getDb()?.collection('fcm_tokens').deleteOne({ token }).catch(() => {});
            }
            resolve(false);
          }
        });
      });

      req.on('error', (e: any) => {
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

export const fcmPushService = new FcmPushService();

