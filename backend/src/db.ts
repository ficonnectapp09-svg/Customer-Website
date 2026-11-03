import { MongoClient, Db, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import dns from 'dns';
import { generateCustomerId, ensureCustomerIdIndexes } from './services/customerIdService';

dotenv.config();

try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

// Database Schema Interfaces
export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  rating: number;
  active: boolean;
  created_at?: string;
}

export interface DeliveryPartner {
  id: string;
  name: string;
  photo: string;
  mobile: string;
  emergency_contact: string;
  address: string;
  vehicle_type: string;
  vehicle_number: string;
  driving_license: string;
  aadhaar: string;
  status: 'Available' | 'Busy' | 'On Delivery' | 'Offline' | 'Break' | 'Inactive';
  availability: boolean;
  current_latitude: number;
  current_longitude: number;
  speed: number;
  battery_level: number;
  last_updated_time: string;
  vendor_id: string;
  joining_date: string;
  rating?: number;
}

export interface Order {
  id: string;
  order_number: string;
  vendor_id: string;
  customer_id?: string;
  customerId?: string;
  customer_email?: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_latitude: number;
  customer_longitude: number;
  product_details: string;
  amount: number;
  paymentMethod?: string;
  payment_method?: string;
  paymentStatus?: string;
  payment_status?: string;
  transactionId?: string;
  paidAt?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status:
    | 'Order Received'
    | 'Preparing'
    | 'Ready For Pickup'
    | 'Assigned To Delivery Partner'
    | 'Delivery Partner Accepted'
    | 'Picked Up'
    | 'Out For Delivery'
    | 'Near Customer'
    | 'Delivered'
    | 'Completed'
    | 'Cancelled'
    | 'Pending'
    | 'Shortlisted'
    | 'Interviewing'
    | 'Hired'
    | 'Rejected'
    | 'Approved'
    | 'Enrolled';
  created_at?: string;
  type?: string;
  appointmentDate?: string;
  appointmentTimeSlot?: string;
  doctorName?: string;
  tableNumber?: string;
  roomNumber?: string;
  prescriptionUrl?: string;
  candidateEmail?: string;
  candidateResume?: string;
  experience?: string;
  candidateEducation?: string;
  boardingPoint?: any;
  droppingPoint?: any;
  travelDate?: string;
  journeyDate?: string;
  departureDate?: string;
  departureTime?: string;
  adults?: number;
  children?: number;
  guestDetails?: any[];
  items?: any[];
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  nightsCount?: number;
  roomsCount?: number;
  vendorId?: string;
  memberId?: string;
  memberName?: string;
  totalAmount?: number;
  finalAmount?: number;
}

export interface DeliveryAssignment {
  id: string;
  order_id: string;
  delivery_partner_id: string;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Cancelled';
  assigned_at: string;
  responded_at?: string;
}

export interface DeliveryTracking {
  id?: number;
  delivery_partner_id: string;
  order_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  current_address: string;
  battery_level: number;
  updated_at: string;
}

export interface DeliveryStatusHistory {
  id?: number;
  order_id: string;
  status: string;
  updated_by: string;
  notes: string;
  timestamp: string;
}

export interface DeliveryEarning {
  id: string;
  delivery_partner_id: string;
  order_id: string;
  per_delivery_earning: number;
  incentive: number;
  bonus: number;
  date: string;
}

export interface DeliveryRating {
  id: string;
  order_id: string;
  rating_value: number;
  comment: string;
  rater_role: 'Customer' | 'Vendor';
  target_partner_id: string;
  timestamp: string;
}

export interface CustomerTrackingLog {
  id?: number;
  order_id: string;
  ip_address: string;
  browser_agent: string;
  latitude?: number;
  longitude?: number;
  accessed_at: string;
}

// Config file path for mock database
const MOCK_DB_PATH = path.join(__dirname, 'mock_db.json');

// Memory Mock Database storage structure
interface MockDatabaseSchema {
  vendors: Vendor[];
  delivery_partners: DeliveryPartner[];
  orders: Order[];
  delivery_assignments: DeliveryAssignment[];
  delivery_tracking: DeliveryTracking[];
  delivery_status_history: DeliveryStatusHistory[];
  delivery_earnings: DeliveryEarning[];
  delivery_ratings: DeliveryRating[];
  customer_tracking_logs: CustomerTrackingLog[];
}

// Default Coordinates
const VENDOR_LAT = 12.9348;
const VENDOR_LNG = 77.6189;

const DEFAULT_MOCK_DATA: MockDatabaseSchema = {
  vendors: [],
  delivery_partners: [],
  orders: [],
  delivery_assignments: [],
  delivery_tracking: [],
  delivery_status_history: [],
  delivery_earnings: [],
  delivery_ratings: [],
  customer_tracking_logs: []
};

class DatabaseManager {
  private mongoClient: MongoClient | null = null;
  private mongoDb: Db | null = null;
  private isFallback: boolean = false;
  private memoryDb: MockDatabaseSchema = DEFAULT_MOCK_DATA;

  constructor() {}

  public async connect() {
    const connStr = process.env.MONGODB_URI || (process.env.DATABASE_URL?.startsWith('mongodb') ? process.env.DATABASE_URL : null);
    if (!connStr) {
      throw new Error('MONGODB_URI environment variable is not defined.');
    }

    console.log(`[DB]: Attempting connection to MongoDB...`);
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        this.mongoClient = new MongoClient(connStr, {
          connectTimeoutMS: 30000,
          serverSelectionTimeoutMS: 30000,
          family: 4
        });
        await this.mongoClient.connect();
        
        const targetDbName = process.env.DB_NAME || (connStr.match(/mongodb(?:\+srv)?:\/\/[^\/]+\/([^?]+)/) ? connStr.match(/mongodb(?:\+srv)?:\/\/[^\/]+\/([^?]+)/)![1] : undefined);
        this.mongoDb = this.mongoClient.db(targetDbName);
        console.log(`[DB]: Connected to MongoDB successfully. Database: ${targetDbName}`);
        
        // Setup collections and indexes
        await this.createIndexes();
        return;
      } catch (err: any) {
        console.error(`[DB]: Connection attempt ${attempts}/${maxAttempts} failed: ${err.message}`);
        if (attempts >= maxAttempts) {
          this.mongoClient = null;
          this.mongoDb = null;
          throw err;
        }
        await new Promise(res => setTimeout(res, 2000));
      }
    }
  }

  /**
   * Safely create an index, dropping conflicting old index if needed.
   * MongoDB throws if an index with the same auto-generated name exists but with different options.
   */
  private async safeCreateIndex(collectionName: string, keys: Record<string, number>, options?: any) {
    if (!this.mongoDb) return;
    const col = this.mongoDb.collection(collectionName);
    try {
      await col.createIndex(keys, options || {});
    } catch (err: any) {
      // If index conflict (code 85 or 86), drop the old one and retry
      if (err.code === 85 || err.code === 86 || (err.message && err.message.includes('existing index'))) {
        try {
          // Build the auto-generated index name (e.g. { id: 1 } -> "id_1")
          const indexName = Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
          await col.dropIndex(indexName);
          await col.createIndex(keys, options || {});
        } catch (retryErr: any) {
          // Silently continue — index may already be correct
          console.warn(`[DB]: Could not reconcile index on ${collectionName}: ${retryErr.message}`);
        }
      } else {
        throw err;
      }
    }
  }

  private async createIndexes() {
    if (!this.mongoDb) return;
    try {
      // Users & Customers Indexes
      await this.safeCreateIndex('users', { id: 1 }, { sparse: true });
      await this.safeCreateIndex('users', { email: 1 }, { sparse: true });
      await this.safeCreateIndex('users', { phone: 1 }, { sparse: true });
      await this.safeCreateIndex('users', { registrationId: 1 }, { sparse: true });
      await this.safeCreateIndex('users', { vendorId: 1 }, { sparse: true });
      await this.safeCreateIndex('users', { role: 1, status: 1, isActive: 1 });
      await this.safeCreateIndex('users', { status: 1 });
      await this.safeCreateIndex('users', { isActive: 1 });

      await this.safeCreateIndex('customers', { id: 1 }, { sparse: true });
      await this.safeCreateIndex('customers', { email: 1 }, { sparse: true });
      await this.safeCreateIndex('customers', { phone: 1 }, { sparse: true });
      await this.safeCreateIndex('customers', { registrationId: 1 }, { sparse: true });

      await this.safeCreateIndex('admins', { email: 1 }, { sparse: true });
      await this.safeCreateIndex('admins', { role: 1 });

      await this.safeCreateIndex('vendors', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('vendors', { status: 1 });
      await this.safeCreateIndex('vendors', { email: 1 });
      await this.safeCreateIndex('vendors', { mobile: 1 });

      await this.safeCreateIndex('delivery_partners', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('delivery_partners', { vendor_id: 1 });
      await this.safeCreateIndex('delivery_partners', { status: 1, availability: 1 });

      await this.safeCreateIndex('agents', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('agents', { status: 1 });
      await this.safeCreateIndex('agents', { isApproved: 1 });
      await this.safeCreateIndex('agents', { assignedState: 1, assignedDistrict: 1, assignedArea: 1, pincode: 1 });
      
      await this.safeCreateIndex('products', { id: 1 });
      await this.safeCreateIndex('products', { vendorId: 1 });
      await this.safeCreateIndex('products', { vendorId: 1, isActive: 1 });
      await this.safeCreateIndex('products', { vendorStatus: 1, businessStatus: 1, isActive: 1 });
      await this.safeCreateIndex('products', { isActive: 1, isAvailable: 1, createdAt: -1 });
      await this.safeCreateIndex('products', { mainCategory: 1, subcategory: 1, subSubcategory: 1 });
      await this.safeCreateIndex('products', { subNavbarCategory: 1 });
      await this.safeCreateIndex('products', { category: 1 });
      await this.safeCreateIndex('products', { createdAt: -1 });

      await this.safeCreateIndex('categories', { id: 1 });
      await this.safeCreateIndex('categories', { level: 1, mainCategory: 1 });
      await this.safeCreateIndex('categories', { subcategory: 1 });
      await this.safeCreateIndex('categories', { isActive: 1 });
      await this.safeCreateIndex('categories', { sortOrder: 1, name: 1 });

      await this.safeCreateIndex('orders', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('orders', { order_number: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('orders', { vendor_id: 1, created_at: -1 });
      await this.safeCreateIndex('orders', { customer_id: 1, created_at: -1 });
      await this.safeCreateIndex('orders', { customerId: 1, created_at: -1 });
      await this.safeCreateIndex('orders', { customer_email: 1 });
      await this.safeCreateIndex('orders', { customer_phone: 1 });
      await this.safeCreateIndex('orders', { memberId: 1 });
      await this.safeCreateIndex('orders', { type: 1 });
      await this.safeCreateIndex('orders', { status: 1 });
      await this.safeCreateIndex('orders', { created_at: -1 });
      await this.safeCreateIndex('orders', { createdAt: -1 });

      await this.safeCreateIndex('wallet_transactions', { customerId: 1, createdAt: -1 });
      await this.safeCreateIndex('wallet_transactions', { userId: 1, createdAt: -1 });
      await this.safeCreateIndex('wallet_transactions', { userEmail: 1, createdAt: -1 });
      await this.safeCreateIndex('wallet_transactions', { userPhone: 1, createdAt: -1 });
      await this.safeCreateIndex('wallet_transactions', { transactionId: 1 }, { sparse: true });
      await this.safeCreateIndex('wallet_transactions', { createdAt: -1 });

      await this.safeCreateIndex('membership_payments', { userId: 1, createdAt: -1 });
      await this.safeCreateIndex('membership_payments', { customerId: 1, createdAt: -1 });
      await this.safeCreateIndex('membership_payments', { paymentId: 1 }, { sparse: true });
      await this.safeCreateIndex('membership_payments', { orderId: 1 }, { sparse: true });

      await this.safeCreateIndex('membership_orders', { orderId: 1 }, { sparse: true });
      await this.safeCreateIndex('membership_orders', { userId: 1 });
      await this.safeCreateIndex('membership_orders', { customerId: 1 });

      await this.safeCreateIndex('notifications', { userId: 1, createdAt: -1 });
      await this.safeCreateIndex('notifications', { customerId: 1, createdAt: -1 });
      await this.safeCreateIndex('pincodes', { code: 1 });

      await this.safeCreateIndex('onboarding_requests', { status: 1 });
      await this.safeCreateIndex('onboarding_requests', { createdAt: -1 });
      
      await this.safeCreateIndex('delivery_assignments', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('delivery_assignments', { order_id: 1 });
      await this.safeCreateIndex('delivery_assignments', { delivery_partner_id: 1 });
      
      await this.safeCreateIndex('delivery_tracking', { delivery_partner_id: 1, order_id: 1 });
      await this.safeCreateIndex('delivery_status_history', { order_id: 1 });
      await this.safeCreateIndex('delivery_earnings', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('delivery_earnings', { delivery_partner_id: 1 });
      await this.safeCreateIndex('delivery_ratings', { id: 1 }, { unique: true, sparse: true });
      await this.safeCreateIndex('delivery_ratings', { target_partner_id: 1 });

      await this.safeCreateIndex('banners', { isActive: 1, displayOrder: 1, createdAt: -1 });
      await this.safeCreateIndex('ads', { isActive: 1, createdAt: -1 });
      await ensureCustomerIdIndexes(this.mongoDb);
      console.log(`[DB]: MongoDB indexes verified/created successfully.`);
    } catch (err: any) {
      console.error(`[DB]: Failed to create indexes: ${err.message}`);
    }
  }

  private async seedDefaultData() {
    if (!this.mongoDb) return;
    try {
      const vendorCount = await this.mongoDb.collection('vendors').countDocuments();
      if (vendorCount === 0) {
        console.log('[DB]: Database connected. Ready for operational data.');
      }
    } catch (err: any) {
      console.error(`[DB]: Seeding failed: ${err.message}`);
    }
  }

  // Load fallback DB from local JSON file
  private loadMockDbFromFile() {
    try {
      if (fs.existsSync(MOCK_DB_PATH)) {
        const fileContent = fs.readFileSync(MOCK_DB_PATH, 'utf8');
        this.memoryDb = { ...DEFAULT_MOCK_DATA, ...JSON.parse(fileContent) };
        console.log(`[DB]: Persistent Mock Database loaded from "${MOCK_DB_PATH}"`);
      } else {
        this.saveMockDbToFile();
        console.log(`[DB]: Created initial Mock Database file at "${MOCK_DB_PATH}"`);
      }
    } catch (err: any) {
      console.error(`[DB]: Error loading Mock DB: ${err.message}`);
      this.memoryDb = DEFAULT_MOCK_DATA;
    }
  }

  // Save memory state to local JSON file
  private saveMockDbToFile() {
    try {
      fs.writeFileSync(MOCK_DB_PATH, JSON.stringify(this.memoryDb, null, 2), 'utf8');
    } catch (err: any) {
      console.error(`[DB]: Error saving Mock DB to file: ${err.message}`);
    }
  }

  public getEngineType(): 'MongoDB' | 'Mock JSON Fallback' {
    return this.isFallback ? 'Mock JSON Fallback' : 'MongoDB';
  }

  public getDb(): Db | null {
    return this.mongoDb;
  }

  // Expose raw query (deprecated for SQL, throw error)
  public async query(text: string, params?: any[]) {
    throw new Error('Database is running MongoDB / Mock mode. SQL Raw query method is no longer supported.');
  }

  // --- REPOSITORY INTERFACES FOR ALL TABLES ---

  // 1. Vendors Repo
  public async getVendor(id: string): Promise<Vendor | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<Vendor>('vendors').findOne({ id }, { projection: { _id: 0 } });
    }
    return this.memoryDb.vendors.find(v => v.id === id) || null;
  }

  public async createVendor(vendor: Vendor): Promise<Vendor> {
    if (this.mongoDb) {
      const data = { ...vendor };
      await this.mongoDb.collection<Vendor>('vendors').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.vendors.push(vendor);
    this.saveMockDbToFile();
    return vendor;
  }

  // 2. Delivery Partner Repo
  public async getDeliveryPartners(vendorId?: string): Promise<DeliveryPartner[]> {
    if (this.mongoDb) {
      const query = vendorId ? { vendor_id: vendorId } : {};
      return this.mongoDb.collection<DeliveryPartner>('delivery_partners')
        .find(query, { projection: { _id: 0 } })
        .sort({ joining_date: -1 })
        .toArray();
    }
    return vendorId 
      ? this.memoryDb.delivery_partners.filter(dp => dp.vendor_id === vendorId) 
      : this.memoryDb.delivery_partners;
  }

  public async getDeliveryPartner(id: string): Promise<DeliveryPartner | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryPartner>('delivery_partners').findOne({ id }, { projection: { _id: 0 } });
    }
    return this.memoryDb.delivery_partners.find(dp => dp.id === id) || null;
  }

  public async createDeliveryPartner(dp: DeliveryPartner): Promise<DeliveryPartner> {
    if (this.mongoDb) {
      const data = {
        ...dp,
        joining_date: dp.joining_date || new Date().toISOString().split('T')[0]
      };
      await this.mongoDb.collection<DeliveryPartner>('delivery_partners').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.delivery_partners.push(dp);
    this.saveMockDbToFile();
    return dp;
  }

  public async updateDeliveryPartner(id: string, updates: Partial<DeliveryPartner>): Promise<DeliveryPartner | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryPartner>('delivery_partners').findOneAndUpdate(
        { id },
        { $set: { ...updates, last_updated_time: new Date().toISOString() } },
        { returnDocument: 'after', projection: { _id: 0 } }
      );
    }
    const idx = this.memoryDb.delivery_partners.findIndex(dp => dp.id === id);
    if (idx === -1) return null;
    
    const updated = {
      ...this.memoryDb.delivery_partners[idx],
      ...updates,
      last_updated_time: new Date().toISOString()
    };
    this.memoryDb.delivery_partners[idx] = updated;
    this.saveMockDbToFile();
    return updated;
  }

  public async deleteDeliveryPartner(id: string): Promise<boolean> {
    if (this.mongoDb) {
      const res = await this.mongoDb.collection('delivery_partners').deleteOne({ id });
      return (res.deletedCount ?? 0) > 0;
    }
    const originalLen = this.memoryDb.delivery_partners.length;
    this.memoryDb.delivery_partners = this.memoryDb.delivery_partners.filter(dp => dp.id !== id);
    this.saveMockDbToFile();
    return this.memoryDb.delivery_partners.length < originalLen;
  }

  // 3. Orders Repo
  public async getOrders(vendorId?: string, customerId?: string | string[]): Promise<Order[]> {
    if (this.mongoDb) {
      const query: any = {};
      if (vendorId) query.vendor_id = vendorId;
      if (customerId) {
        const idList = (Array.isArray(customerId) ? customerId : [customerId]).map(s => String(s).trim()).filter(Boolean);
        if (idList.length > 0) {
          const orList: any[] = [];
          idList.forEach(rawId => {
            const cleanCustId = String(rawId).trim();
            const cleanLower = cleanCustId.toLowerCase();
            const cleanDigits = cleanCustId.replace(/\D/g, '');

            orList.push(
              { customer_id: cleanCustId },
              { customerId: cleanCustId },
              { memberId: cleanCustId },
              { user_id: cleanCustId },
              { userId: cleanCustId },
              { customer_email: cleanLower },
              { customerEmail: cleanLower },
              { candidateEmail: cleanLower },
              { email: cleanLower }
            );

            if (cleanDigits && cleanDigits.length >= 7) {
              orList.push(
                { customer_phone: cleanDigits },
                { customer_phone: `+91${cleanDigits}` },
                { customer_phone: `91${cleanDigits}` },
                { customerPhone: cleanDigits },
                { customerPhone: `+91${cleanDigits}` },
                { customerPhone: `91${cleanDigits}` },
                { candidatePhone: cleanDigits },
                { phone: cleanDigits },
                { phone: `+91${cleanDigits}` }
              );
            }
          });
          query.$or = orList;
        }
      }
      return this.mongoDb.collection<Order>('orders')
        .find(query, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .toArray();
    }
    let res = this.memoryDb.orders;
    if (vendorId) res = res.filter(o => o.vendor_id === vendorId);
    if (customerId) {
      const idList = (Array.isArray(customerId) ? customerId : [customerId]).map(s => String(s).trim().toLowerCase()).filter(Boolean);
      res = res.filter(o => 
        idList.includes(String((o as any).customer_id || '').toLowerCase()) ||
        idList.includes(String((o as any).customerId || '').toLowerCase()) ||
        idList.includes(String((o as any).user_id || '').toLowerCase()) ||
        idList.includes(String((o as any).userId || '').toLowerCase()) ||
        idList.includes(String(o.memberId || '').toLowerCase()) ||
        idList.includes(String(o.candidateEmail || '').toLowerCase()) ||
        idList.includes(String((o as any).customerEmail || '').toLowerCase()) ||
        idList.includes(String(o.customer_email || '').toLowerCase()) ||
        idList.includes(String((o as any).email || '').toLowerCase()) ||
        idList.some(id => {
          const digits = id.replace(/\D/g, '');
          const oDigits = String(o.customer_phone || (o as any).customerPhone || (o as any).candidatePhone || (o as any).phone || '').replace(/\D/g, '');
          return digits.length >= 7 && oDigits.length >= 7 && (digits.endsWith(oDigits) || oDigits.endsWith(digits));
        })
      );
    }
    return res.sort((a,b) => b.id.localeCompare(a.id));
  }

  public async getOrder(id: string): Promise<Order | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<Order>('orders').findOne({ id }, { projection: { _id: 0 } });
    }
    return this.memoryDb.orders.find(o => o.id === id) || null;
  }

  public async createOrder(order: Order): Promise<Order> {
    if (this.mongoDb) {
      const data = {
        ...order,
        created_at: order.created_at || new Date().toISOString()
      };
      await this.mongoDb.collection<Order>('orders').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.orders.push(order);
    this.saveMockDbToFile();
    return order;
  }

  public async updateOrderStatus(id: string, status: Order['status']): Promise<Order | null> {
    const updateFields: any = { status };
    if (['Delivered', 'Completed'].includes(status)) {
      updateFields.paymentStatus = 'Paid';
      updateFields.payment_status = 'Paid';
      updateFields.paidAt = new Date().toISOString();
    }
    if (this.mongoDb) {
      return this.mongoDb.collection<Order>('orders').findOneAndUpdate(
        { $or: [{ id }, { order_number: id }] },
        { $set: updateFields },
        { returnDocument: 'after', projection: { _id: 0 } }
      );
    }
    const idx = this.memoryDb.orders.findIndex(o => o.id === id);
    if (idx === -1) return null;
    
    const updated = {
      ...this.memoryDb.orders[idx],
      status
    };
    this.memoryDb.orders[idx] = updated;
    this.saveMockDbToFile();
    return updated;
  }

  // 4. Delivery Assignments Repo
  public async getAssignments(partnerId?: string): Promise<DeliveryAssignment[]> {
    if (this.mongoDb) {
      const query = partnerId ? { delivery_partner_id: partnerId } : {};
      return this.mongoDb.collection<DeliveryAssignment>('delivery_assignments')
        .find(query, { projection: { _id: 0 } })
        .sort({ assigned_at: -1 })
        .toArray();
    }
    return partnerId 
      ? this.memoryDb.delivery_assignments.filter(da => da.delivery_partner_id === partnerId) 
      : this.memoryDb.delivery_assignments;
  }

  public async getActiveAssignmentForPartner(partnerId: string): Promise<DeliveryAssignment | null> {
    if (this.mongoDb) {
      const assignments = await this.mongoDb.collection<DeliveryAssignment>('delivery_assignments').find(
        { delivery_partner_id: partnerId, status: { $in: ['Pending', 'Accepted'] } },
        { projection: { _id: 0 } }
      ).sort({ assigned_at: -1 }).toArray();

      for (const da of assignments) {
        const order = await this.getOrder(da.order_id);
        if (order && !['Delivered', 'Completed', 'Cancelled'].includes(order.status)) {
          return da;
        }
      }
      return null;
    }

    const assignments = this.memoryDb.delivery_assignments
      .filter(da => da.delivery_partner_id === partnerId && (da.status === 'Pending' || da.status === 'Accepted'))
      .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at));

    for (const da of assignments) {
      const order = this.memoryDb.orders.find(o => o.id === da.order_id);
      if (order && !['Delivered', 'Completed', 'Cancelled'].includes(order.status)) {
        return da;
      }
    }
    return null;
  }

  public async getAssignmentForOrder(orderId: string): Promise<DeliveryAssignment | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryAssignment>('delivery_assignments')
        .find({ order_id: orderId, status: { $ne: 'Rejected' } }, { projection: { _id: 0 } })
        .sort({ assigned_at: -1 })
        .limit(1)
        .next();
    }
    return this.memoryDb.delivery_assignments
      .filter(da => da.order_id === orderId && da.status !== 'Rejected')
      .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at))[0] || null;
  }

  public async createAssignment(da: DeliveryAssignment): Promise<DeliveryAssignment> {
    if (this.mongoDb) {
      const data = {
        ...da,
        assigned_at: da.assigned_at || new Date().toISOString()
      };
      await this.mongoDb.collection<DeliveryAssignment>('delivery_assignments').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.delivery_assignments.push(da);
    this.saveMockDbToFile();
    return da;
  }

  public async updateAssignmentStatus(id: string, status: DeliveryAssignment['status']): Promise<DeliveryAssignment | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryAssignment>('delivery_assignments').findOneAndUpdate(
        { id },
        { $set: { status, responded_at: new Date().toISOString() } },
        { returnDocument: 'after', projection: { _id: 0 } }
      );
    }
    const idx = this.memoryDb.delivery_assignments.findIndex(da => da.id === id);
    if (idx === -1) return null;
    
    const updated = {
      ...this.memoryDb.delivery_assignments[idx],
      status,
      responded_at: new Date().toISOString()
    };
    this.memoryDb.delivery_assignments[idx] = updated;
    this.saveMockDbToFile();
    return updated;
  }

  // 5. Tracking Logs Repo
  public async logTracking(tracking: DeliveryTracking): Promise<DeliveryTracking> {
    if (this.mongoDb) {
      const data = {
        ...tracking,
        updated_at: new Date().toISOString()
      };
      await this.mongoDb.collection<DeliveryTracking>('delivery_tracking').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    const completeLog = { ...tracking, id: this.memoryDb.delivery_tracking.length + 1, updated_at: new Date().toISOString() };
    this.memoryDb.delivery_tracking.push(completeLog);
    this.saveMockDbToFile();
    return completeLog;
  }

  public async getLatestTracking(orderId: string): Promise<DeliveryTracking | null> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryTracking>('delivery_tracking')
        .find({ order_id: orderId }, { projection: { _id: 0 } })
        .sort({ updated_at: -1 })
        .limit(1)
        .next();
    }
    const logs = this.memoryDb.delivery_tracking.filter(t => t.order_id === orderId);
    if (logs.length === 0) return null;
    return logs.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  }

  // 6. Delivery Status History Repo
  public async logStatusHistory(history: Omit<DeliveryStatusHistory, 'id' | 'timestamp'>): Promise<DeliveryStatusHistory> {
    if (this.mongoDb) {
      const data = {
        ...history,
        timestamp: new Date().toISOString()
      };
      await this.mongoDb.collection<DeliveryStatusHistory>('delivery_status_history').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    const log = { ...history, id: this.memoryDb.delivery_status_history.length + 1, timestamp: new Date().toISOString() };
    this.memoryDb.delivery_status_history.push(log);
    this.saveMockDbToFile();
    return log;
  }

  public async getStatusHistory(orderId: string): Promise<DeliveryStatusHistory[]> {
    if (this.mongoDb) {
      return this.mongoDb.collection<DeliveryStatusHistory>('delivery_status_history')
        .find({ order_id: orderId }, { projection: { _id: 0 } })
        .sort({ timestamp: 1 })
        .toArray();
    }
    return this.memoryDb.delivery_status_history
      .filter(h => h.order_id === orderId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // 7. Earnings Repo
  public async getEarnings(partnerId?: string): Promise<DeliveryEarning[]> {
    if (this.mongoDb) {
      const query = partnerId ? { delivery_partner_id: partnerId } : {};
      return this.mongoDb.collection<DeliveryEarning>('delivery_earnings')
        .find(query, { projection: { _id: 0 } })
        .sort({ date: -1 })
        .toArray();
    }
    return partnerId 
      ? this.memoryDb.delivery_earnings.filter(e => e.delivery_partner_id === partnerId) 
      : this.memoryDb.delivery_earnings;
  }

  public async createEarning(earning: DeliveryEarning): Promise<DeliveryEarning> {
    if (this.mongoDb) {
      const data = { ...earning };
      await this.mongoDb.collection<DeliveryEarning>('delivery_earnings').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.delivery_earnings.push(earning);
    this.saveMockDbToFile();
    return earning;
  }

  // 8. Ratings Repo
  public async getRatings(partnerId?: string): Promise<DeliveryRating[]> {
    if (this.mongoDb) {
      const query = partnerId ? { target_partner_id: partnerId } : {};
      return this.mongoDb.collection<DeliveryRating>('delivery_ratings')
        .find(query, { projection: { _id: 0 } })
        .sort({ timestamp: -1 })
        .toArray();
    }
    return partnerId 
      ? this.memoryDb.delivery_ratings.filter(r => r.target_partner_id === partnerId) 
      : this.memoryDb.delivery_ratings;
  }

  public async createRating(rating: DeliveryRating): Promise<DeliveryRating> {
    if (this.mongoDb) {
      const data = {
        ...rating,
        timestamp: new Date().toISOString()
      };
      await this.mongoDb.collection<DeliveryRating>('delivery_ratings').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    this.memoryDb.delivery_ratings.push(rating);
    this.saveMockDbToFile();
    return rating;
  }

  // 9. Customer Tracking logs
  public async logCustomerAccess(log: Omit<CustomerTrackingLog, 'id' | 'accessed_at'>): Promise<CustomerTrackingLog> {
    if (this.mongoDb) {
      const data = {
        ...log,
        accessed_at: new Date().toISOString()
      };
      await this.mongoDb.collection<CustomerTrackingLog>('customer_tracking_logs').insertOne(data);
      const { _id, ...ret } = data as any;
      return ret;
    }
    const fullLog = { ...log, id: this.memoryDb.customer_tracking_logs.length + 1, accessed_at: new Date().toISOString() };
    this.memoryDb.customer_tracking_logs.push(fullLog);
    this.saveMockDbToFile();
    return fullLog;
  }

  // 10. Customer User registration persistence
  public async createCustomerUser(userData: any): Promise<any> {
    const now = userData.createdAt ? new Date(userData.createdAt) : new Date();
    let customerId = userData.customerId || userData.registrationId;
    if (!customerId && this.mongoDb) {
      try {
        customerId = await generateCustomerId(this.mongoDb, now);
      } catch (err: any) {
        console.error(`[DB]: Failed to generate customerId in createCustomerUser: ${err.message}`);
      }
    }

    const custData = {
      name: userData.name || 'Connect Customer',
      email: userData.email || '',
      phone: userData.phone || '',
      address: userData.address || '',
      city: userData.city || '',
      pincode: userData.pincode || '',
      aadhaarNumber: userData.aadhaar || userData.aadhaarNumber || '',
      panNumber: userData.pan || userData.panNumber || '',
      role: 'Member',
      status: 'Active',
      isActive: true,
      customerId: customerId || '',
      registrationId: customerId || '',
      customerType: 'Standard',
      district: userData.city || 'Direct',
      createdAt: now
    };
    if (this.mongoDb) {
      await this.mongoDb.collection('users').insertOne(custData).catch(() => {});
      await this.mongoDb.collection('customers').insertOne(custData).catch(() => {});
    }
    return custData;
  }

  // 11. Find customer by phone number (for OTP login profile lookup)
  public async findCustomerByPhone(phone: string): Promise<any | null> {
    const cleanPhone = phone.replace(/\D/g, '');
    if (this.mongoDb) {
      try {
        // Search both users and customers collections
        const user = await this.mongoDb.collection('users').findOne({
          $or: [
            { phone: cleanPhone },
            { phone: `+91${cleanPhone}` },
            { phone: `91${cleanPhone}` }
          ]
        });
        if (user) return user;
        const customer = await this.mongoDb.collection('customers').findOne({
          $or: [
            { phone: cleanPhone },
            { phone: `+91${cleanPhone}` },
            { phone: `91${cleanPhone}` }
          ]
        });
        if (customer) return customer;
      } catch (e) {}
    }
    return null;
  }

  // 12. Check if Vendor is Active/Approved (not Suspended)
  public async isVendorActive(vendorId: string): Promise<boolean> {
    if (!vendorId) return true;
    if (this.mongoDb) {
      try {
        const vIdStr = String(vendorId).trim();
        const orConditions: any[] = [
          { vendorId: vIdStr },
          { registrationId: vIdStr },
          { regId: vIdStr },
          { primaryBusinessId: vIdStr },
          { 'businesses._id': vIdStr }
        ];

        if (ObjectId.isValid(vIdStr)) {
          orConditions.push({ _id: new ObjectId(vIdStr) });
        } else {
          orConditions.push({ _id: vIdStr });
        }

        const user = await this.mongoDb.collection('users').findOne({
          $or: orConditions
        } as any);

        if (user) {
          const statusLower = (user.status || '').toLowerCase().trim();
          const isSuspended = ['suspended', 'inactive', 'rejected', 'deactivated', 'disabled', 'blocked'].includes(statusLower) ||
            user.isActive === false || user.isApproved === false || user.isLocked === true || user.isSuspended === true;
          return !isSuspended;
        }
      } catch (e) {}
    }
    return true;
  }
}

export const db = new DatabaseManager();
