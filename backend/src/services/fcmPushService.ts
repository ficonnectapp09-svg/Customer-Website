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
      const targetConditions: any[] = [
        { userId: vidStr },
        { vendorId: vidStr },
        { targetId: vidStr },
        { vendorIds: vidStr },
        { businessIds: vidStr },
      ];

      if (ObjectId.isValid(vidStr)) {
        targetConditions.push({ userId: new ObjectId(vidStr) });
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
        const ok = await this.sendSinglePush(token, payload);
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
   * Send single message to FCM device token via FCM HTTP Endpoint
   */
  private sendSinglePush(token: string, payload: FcmPushPayload): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.serverKey) {
        // When server key is not configured, simulate successful queueing
        console.log(`[FcmPushService] FCM server key not set in env; logged payload for token ${token.substring(0, 15)}...`);
        return resolve(true);
      }

      const postData = JSON.stringify({
        to: token,
        priority: 'high',
        notification: {
          title: payload.title,
          body: payload.body,
          sound: 'vendor_alert',
          channel_id: 'vendor_order_alerts_v2',
          android_channel_id: 'vendor_order_alerts_v2',
          click_action: 'OPEN_NOTIFICATION',
        },
        data: {
          title: payload.title,
          message: payload.body,
          body: payload.body,
          targetId: payload.targetId || payload.orderId || '',
          orderId: payload.targetId || payload.orderId || '',
          category: payload.category || 'Orders',
          segment: payload.segment || 'Orders',
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

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => (responseBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            console.warn('[FcmPushService] FCM API response code:', res.statusCode, responseBody);
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

export const fcmPushService = new FcmPushService();

