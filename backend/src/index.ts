import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import http from 'http';
import adminRouter from './routes/admin';
import authRouter from './routes/auth';
import vendorsRouter from './routes/vendors';
import deliveryRouter from './routes/delivery';
import ordersRouter from './routes/orders';
import mapsRouter from './routes/maps';
import membershipRouter from './routes/membership';
import walletRouter from './routes/wallet';
import territoryRouter from './routes/territory';
import { socketManager } from './socket';
import { db } from './db';
import {
  helmetSecurityMiddleware,
  sanitizeInputsMiddleware,
  corsSecurityMiddleware,
  globalApiRateLimiter,
  uploadRateLimiter,
  isAllowedOrigin
} from './security/middleware';
import { uploadToS3, getPresignedViewUrl, isPersistentImageUrl, resolveDurableImageUrl, getDurableImageUrl, extractS3Key, getObjectStream } from './s3';
import { securityManager } from './security/securityManager';
import { ObjectId } from 'mongodb';
import {
  initRealtimeInfrastructure,
  eventPublisher,
  cacheManager,
  RealtimeEntities,
  RealtimeActions,
  getRealtimeHealth
} from './realtime';

// Load environmental variables
dotenv.config();

// Global Process Crash Prevention Guards
process.on('uncaughtException', (err: any) => {
  console.error('[Process]: Uncaught exception (gracefully handled):', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.warn('[Process]: Unhandled promise rejection (gracefully handled):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 8000;

// Configure Express trust proxy for Nginx reverse proxy topology.
// 1 = Trust first hop (Nginx reverse proxy), enabling express-rate-limit to correctly
// resolve client IP from X-Forwarded-For without trusting spoofed upstream headers.
app.set('trust proxy', true);

import compression from 'compression';

// Remove X-Powered-By header (Helmet v7+ no longer handles this — must be set on app directly)
app.disable('x-powered-by');

// Enable Gzip/Deflate compression for all JSON and text responses (reduces payload by 70-85%)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Enterprise CORS Protection Middleware (Restricted to Trusted Origins, no arbitrary origin reflection)
app.use(corsSecurityMiddleware);

// OWASP Security Headers (Helmet v8) & Input Sanitization
app.use(helmetSecurityMiddleware);

import path from 'path';
import fs from 'fs';

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInputsMiddleware);

// Serve static uploaded files (with cross-origin resource sharing, maxAge caching & fallback resolution)
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
  next();
}, express.static(path.join(process.cwd(), 'uploads'), { maxAge: '7d', etag: true }));

app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { maxAge: '7d', etag: true }));

// Resilient fallback for uploaded files: check sibling vendor uploads and upstream vendor backend
app.get('/uploads/:filename(*)', async (req, res, next) => {
  try {
    const rawFilename = req.params.filename;
    let filename = rawFilename;
    try { filename = decodeURIComponent(rawFilename); } catch (e) { filename = rawFilename; }
    const safeFilename = path.basename(filename);

    // 1. Check local uploads dir
    const local1 = path.join(process.cwd(), 'uploads', safeFilename);
    if (fs.existsSync(local1)) return res.sendFile(local1);
    const local2 = path.join(__dirname, '../uploads', safeFilename);
    if (fs.existsSync(local2)) return res.sendFile(local2);

    // 2. Check sibling vendor backend uploads paths on server / local disk
    const siblingDirs = [
      path.join(process.cwd(), '../vendor/backend/uploads', safeFilename),
      path.join(process.cwd(), '../../vendor/backend/uploads', safeFilename),
      path.join('/var/www/vendor/backend/uploads', safeFilename),
      path.join('/home/ubuntu/vendor/backend/uploads', safeFilename),
      path.join('/var/www/vendor-backend/uploads', safeFilename),
      path.join('D:/vendor/backend/uploads', safeFilename)
    ];
    for (const sPath of siblingDirs) {
      if (fs.existsSync(sPath)) {
        return res.sendFile(sPath);
      }
    }

    // 3. Fallback: proxy request to VENDOR_BACKEND_URL (e.g. http://127.0.0.1:8002/uploads/...)
    const vendorUrlRaw = process.env.VENDOR_BACKEND_URL || 'http://127.0.0.1:8002';
    const upstreamUrl = `${vendorUrlRaw.replace(/\/+$/, '')}/uploads/${encodeURIComponent(safeFilename)}`;
    const upstreamRes = await fetch(upstreamUrl);
    if (upstreamRes.ok) {
      const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      const arrayBuf = await upstreamRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuf));
    }
  } catch (err) {
    // Continue to next
  }
  next();
});

// Base Health Check Route
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Connect App Enterprise REST API is running with OWASP Security enabled.',
    timestamp: new Date().toISOString()
  });
});

// Auto-heal duplicate '/api/api' requests from stale or misconfigured client bundles
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/api/')) {
    req.url = req.url.replace(/^\/api\/api\//, '/api/');
  }
  next();
});

// Production API Rate Limiting (500 requests per 15 minutes per client IP/session)
app.use('/api/', globalApiRateLimiter);

// Mount Routes
app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);
app.use('/api/customer', authRouter);
app.use('/api/notifications', authRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/delivery-partners', deliveryRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/maps', mapsRouter);
app.use('/api/membership', membershipRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/territory', territoryRouter);

// Public Categories Endpoints
app.get(['/api/public/categories', '/api/categories'], async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    if (!forceRefresh) {
      const cached = await cacheManager.get('cache:categories:tree');
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return res.json(cached);
      }
    }

    const mongoDb = db.getDb();
    if (mongoDb) {
      const all = await mongoDb.collection('categories').find().sort({ sortOrder: 1, name: 1 }).toArray();
      const map: Record<string, any> = {};
      const roots: any[] = [];

      all.forEach((c: any) => {
        c.children = [];
        map[c._id.toString()] = c;
      });

      all.forEach((c: any) => {
        if (c.parentId && map[c.parentId.toString()]) {
          map[c.parentId.toString()].children.push(c);
        } else if (!c.parentId) {
          roots.push(c);
        }
      });

      const responseData = roots.length > 0 ? roots : all;
      await cacheManager.set('cache:categories:tree', responseData, 120);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(responseData);
    }
    return res.json([]);
  } catch (err: any) {
    console.error("Error fetching categories in backend:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Cache invalidator for public banners
export const invalidatePublicBannersCache = async () => {
  await cacheManager.invalidatePattern('cache:banners:*');
};

// Public Banners Endpoints
app.get(['/api/public/banners', '/api/banners', '/api/public-banners', '/api/banners/public', '/api/admin/public/banners', '/api/admin/public-banners', '/api/admin/banners/public'], async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    if (!forceRefresh) {
      const cached = await cacheManager.get('cache:banners:public');
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return res.json(cached);
      }
    }

    const mongoDb = db.getDb();
    if (mongoDb) {
      const banners = await mongoDb.collection('banners')
        .find({ isActive: { $ne: false } })
        .sort({ displayOrder: 1, createdAt: -1 })
        .toArray();
      await cacheManager.set('cache:banners:public', banners, 120);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(banners);
    }
    return res.json([]);
  } catch (err: any) {
    console.error("Error fetching public banners in index.ts:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Public Ads Endpoints
app.get(['/api/public/ads', '/api/ads'], async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    if (!forceRefresh) {
      const cached = await cacheManager.get('cache:ads:public');
      if (cached) return res.json(cached);
    }

    const mongoDb = db.getDb();
    if (mongoDb) {
      const ads = await mongoDb.collection('ads').find({ isActive: { $ne: false } }).toArray();
      await cacheManager.set('cache:ads:public', ads, 120);
      return res.json(ads);
    }
    return res.json([]);
  } catch (err: any) {
    console.error("Error fetching public ads in index.ts:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Cache invalidator for public products
export const invalidatePublicProductsCache = async () => {
  await cacheManager.invalidatePattern('cache:products:*');
};

// Public Products Endpoints (Customer & Vendor products)
app.get(['/api/public/products', '/api/products'], async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    if (!forceRefresh) {
      const cached = await cacheManager.get('cache:products:public');
      if (cached) {
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        return res.json(cached);
      }
    }

    const mongoDb = db.getDb();
    if (mongoDb) {
      const [suspendedUsers, suspendedVendorsCol, allVendorUsers, allProducts] = await Promise.all([
        mongoDb.collection('users').find({
          $or: [
            { status: { $in: ['suspended', 'Suspended', 'rejected', 'Rejected', 'inactive', 'Inactive', 'deactivated', 'Deactivated', 'blocked', 'Blocked'] } },
            { isActive: false }
          ]
        }, { projection: { _id: 1, email: 1, phone: 1, mobileNumber: 1, businessName: 1, name: 1, registrationId: 1, vendorId: 1, primaryBusinessId: 1, businesses: 1 } }).toArray(),

        mongoDb.collection('vendors').find({
          $or: [
            { status: { $in: ['suspended', 'Suspended', 'rejected', 'Rejected', 'inactive', 'Inactive', 'deactivated', 'Deactivated', 'blocked', 'Blocked'] } },
            { isActive: false }
          ]
        }, { projection: { _id: 1, email: 1, phone: 1, mobileNumber: 1, businessName: 1, registrationId: 1, vendorId: 1 } }).toArray(),

        mongoDb.collection('users').find({
          $or: [
            { role: { $in: ['vendor', 'Vendor', 'merchant', 'Merchant'] } },
            { vendorType: { $exists: true } },
            { businesses: { $exists: true, $not: { $size: 0 } } }
          ]
        }, { projection: { _id: 1, email: 1, phone: 1, mobileNumber: 1, businessName: 1, name: 1, registrationId: 1, vendorId: 1, businesses: 1 } }).toArray(),

        mongoDb.collection('products').find({ isActive: { $ne: false }, isAvailable: { $ne: false } }).sort({ createdAt: -1 }).toArray()
      ]);

      const suspendedVendorIds = new Set<string>();
      const suspendedVendorEmails = new Set<string>();
      const suspendedVendorPhones = new Set<string>();
      const suspendedVendorNames = new Set<string>();
      const suspendedVendorPrefixes = new Set<string>();

      const isGenericVendorName = (nameStr: any) => {
        const norm = (nameStr || '').toString().toLowerCase().trim();
        return !norm || ['connect member', 'verified vendor', 'elite vendor', 'vendor', 'connect', 'customer', 'admin', 'connect customer'].includes(norm);
      };

      [...suspendedUsers, ...suspendedVendorsCol].forEach((v: any) => {
        if (v._id) {
          const idStr = v._id.toString();
          suspendedVendorIds.add(idStr);
          if (idStr.length >= 16) suspendedVendorPrefixes.add(idStr.substring(0, 16));
        }
        if (v.registrationId) suspendedVendorIds.add(v.registrationId.toString());
        if (v.vendorId) suspendedVendorIds.add(v.vendorId.toString());
        if (v.primaryBusinessId) suspendedVendorIds.add(v.primaryBusinessId.toString());
        if (Array.isArray(v.businesses)) {
          v.businesses.forEach((b: any) => {
            if (b._id) suspendedVendorIds.add(b._id.toString());
          });
        }
        if (v.email) suspendedVendorEmails.add(v.email.toLowerCase().trim());
        const phone = (v.phone || v.mobileNumber || '').replace(/\D/g, '');
        if (phone) suspendedVendorPhones.add(phone);
        if (v.businessName && !isGenericVendorName(v.businessName)) suspendedVendorNames.add(v.businessName.toLowerCase().trim());
        if (v.name && !isGenericVendorName(v.name)) suspendedVendorNames.add(v.name.toLowerCase().trim());
      });

      const suspendedVendorBizKeys = new Set<string>();
      allVendorUsers.forEach((v: any) => {
        const vKeys = [
          v._id ? v._id.toString() : '',
          v.registrationId ? v.registrationId.toString() : '',
          v.vendorId ? v.vendorId.toString() : '',
          v.email ? v.email.toLowerCase().trim() : '',
          (v.phone || v.mobileNumber || '').replace(/\D/g, ''),
          (v.businessName && !isGenericVendorName(v.businessName)) ? v.businessName.toLowerCase().trim() : '',
          (v.name && !isGenericVendorName(v.name)) ? v.name.toLowerCase().trim() : ''
        ].filter(Boolean);

        if (Array.isArray(v.businesses)) {
          v.businesses.forEach((b: any) => {
            const bStatus = (b.status || '').toLowerCase().trim();
            const isBActive = (bStatus === 'active' || bStatus === 'approved') && b.isActive !== false;
            if (!isBActive) {
              const bId = b._id ? b._id.toString() : '';
              const bName = (b.businessName || b.name || '').toLowerCase().trim();
              vKeys.forEach(vKey => {
                if (bId) suspendedVendorBizKeys.add(`${vKey}:${bId}`);
                if (bName && !isGenericVendorName(bName)) suspendedVendorBizKeys.add(`${vKey}:${bName}`);
              });
            }
          });
        }
      });

      const activeProducts = allProducts.filter((p: any) => {
        if (p.isActive === false || p.isAvailable === false) return false;
        if (p.isVendorSuspended === true || p.isSuspended === true) return false;
        const pVendorStatus = (p.vendorStatus || p.status || '').toLowerCase().trim();
        if (['suspended', 'inactive', 'rejected', 'blocked', 'deactivated'].includes(pVendorStatus)) return false;

        const vId = p.vendorId ? p.vendorId.toString() : '';
        const vEmail = (p.vendorEmail || '').toLowerCase().trim();
        const vPhone = (p.vendorPhone || '').replace(/\D/g, '');
        const vName = (p.vendorName || p.brand || '').toLowerCase().trim();

        if (vId && suspendedVendorIds.has(vId)) return false;
        if (vEmail && suspendedVendorEmails.has(vEmail)) return false;
        if (vPhone && suspendedVendorPhones.has(vPhone)) return false;
        if (vName && !isGenericVendorName(vName) && suspendedVendorNames.has(vName)) return false;
        if (vId && Array.from(suspendedVendorPrefixes).some(prefix => vId.startsWith(prefix))) return false;

        if (p.businessIsActive === false) return false;
        const pBizStatus = (p.businessStatus || '').toLowerCase().trim();
        if (['suspended', 'inactive', 'rejected', 'blocked', 'deactivated'].includes(pBizStatus)) return false;

        const pBizId = p.businessId ? p.businessId.toString() : (p.business ? (p.business._id?.toString() || p.business.id?.toString()) : '');
        const pBizName = (p.businessName || p.business?.businessName || p.business?.name || p.subNavbarCategory || '').toLowerCase().trim();

        const productVendorKeys = [vId, vEmail, vPhone, vName].filter(Boolean);
        const isThisVendorBizSuspended = productVendorKeys.some(vKey => {
          if (pBizId && suspendedVendorBizKeys.has(`${vKey}:${pBizId}`)) return true;
          if (pBizName && suspendedVendorBizKeys.has(`${vKey}:${pBizName}`)) return true;
          return false;
        });

        if (isThisVendorBizSuspended) return false;

        return true;
      });

      const isDeadUrl = (url: any) => {
        if (!url || typeof url !== 'string') return true;
        const lower = url.trim().toLowerCase();
        return !lower || lower === 'null' || lower === 'undefined' || lower.includes('connect-vendor.onrender.com') || lower.includes('.onrender.com');
      };

      const normalizeVendorImageUrl = (rawUrl: any) => {
        if (!rawUrl || typeof rawUrl !== 'string') return '';
        let u = rawUrl.trim();
        if (isDeadUrl(u)) return '';
        // If the URL was stored pointing to vendor.ficapp.in/uploads/, rewrite to api.ficapp.in/uploads/ so it is served by the backend upload handler
        if (u.includes('vendor.ficapp.in/uploads/')) {
          u = u.replace(/https?:\/\/vendor\.ficapp\.in\/uploads\//i, `${process.env.BACKEND_URL || 'https://api.ficapp.in'}/uploads/`);
        }
        if (u.includes('localhost:8002/uploads/') || u.includes('127.0.0.1:8002/uploads/')) {
          u = u.replace(/https?:\/\/(localhost|127\.0\.0\.1):8002\/uploads\//i, `${process.env.BACKEND_URL || 'https://api.ficapp.in'}/uploads/`);
        }
        // Normalize S3 objects to permanent durable URLs & preserve Cloudinary permanent CDN URLs
        return resolveDurableImageUrl(u);
      };

      const mappedActiveProducts = activeProducts.map((p: any) => {
        let primaryImg = normalizeVendorImageUrl(!isDeadUrl(p.imageUrl) ? p.imageUrl : (!isDeadUrl(p.image) ? p.image : ''));
        if (!primaryImg && Array.isArray(p.images) && p.images.length > 0) {
          const first = p.images.find((img: any) => {
            const u = typeof img === 'string' ? img : (img?.url || img?.secure_url || img?.path || img?.src || '');
            return !isDeadUrl(u);
          });
          const raw = first ? (typeof first === 'string' ? first : (first?.url || first?.secure_url || first?.path || first?.src || '')) : '';
          primaryImg = normalizeVendorImageUrl(raw);
        }
        if (!primaryImg && Array.isArray(p.imageUrls) && p.imageUrls.length > 0) {
          const first = p.imageUrls.find((u: any) => !isDeadUrl(u));
          primaryImg = normalizeVendorImageUrl(first || '');
        }
        if (!primaryImg && p.photo && !isDeadUrl(p.photo)) primaryImg = normalizeVendorImageUrl(p.photo);
        if (!primaryImg && Array.isArray(p.photos) && p.photos.length > 0) {
          const first = p.photos.find((u: any) => !isDeadUrl(typeof u === 'string' ? u : (u?.url || u?.secure_url)));
          const raw = first ? (typeof first === 'string' ? first : (first?.url || first?.secure_url || '')) : '';
          primaryImg = normalizeVendorImageUrl(raw);
        }
        if (!primaryImg && p.thumbnail && !isDeadUrl(p.thumbnail)) primaryImg = normalizeVendorImageUrl(p.thumbnail);
        if (!primaryImg && p.img && !isDeadUrl(p.img)) primaryImg = normalizeVendorImageUrl(p.img);
        if (!primaryImg && p.file && !isDeadUrl(p.file)) primaryImg = normalizeVendorImageUrl(p.file);
        if (!primaryImg && p.secure_url && !isDeadUrl(p.secure_url)) primaryImg = normalizeVendorImageUrl(p.secure_url);

        const normalizedImages = Array.isArray(p.images) && p.images.length > 0
          ? p.images.map((img: any) => {
              const u = typeof img === 'string' ? img : (img?.url || img?.secure_url || '');
              const clean = normalizeVendorImageUrl(u);
              return clean && !isDeadUrl(clean) ? { url: clean } : null;
            }).filter(Boolean)
          : (primaryImg ? [{ url: primaryImg }] : []);

        const normalizedImageUrls = Array.isArray(p.imageUrls) && p.imageUrls.length > 0
          ? p.imageUrls.map((u: any) => normalizeVendorImageUrl(u)).filter((u: any) => !isDeadUrl(u))
          : (primaryImg ? [primaryImg] : []);

        return {
          ...p,
          id: p.id || (p._id ? p._id.toString() : ''),
          imageUrl: primaryImg,
          image: primaryImg,
          images: normalizedImages,
          imageUrls: normalizedImageUrls
        };
      });

      await cacheManager.set('cache:products:public', mappedActiveProducts, 120);
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
      return res.json(mappedActiveProducts);
    }
    return res.json([]);
  } catch (err: any) {
    console.error("Error fetching public products in backend:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Direct Image Upload Endpoint (Persists permanently to Cloudinary with rate limiting)
app.post(['/api/upload', '/api/products/upload-image', '/api/admin/upload'], uploadRateLimiter, async (req, res) => {
  try {
    const { image, file, folder } = req.body;
    const rawImage = image || file;

    if (!rawImage) {
      return res.status(400).json({ success: false, error: 'No image data provided' });
    }

    const uploadRes = await uploadToS3(rawImage, folder || 'products');
    if (!uploadRes.success || !uploadRes.secure_url) {
      return res.status(500).json({ success: false, error: uploadRes.error || 'Failed to upload image' });
    }

    return res.json({
      success: true,
      url: uploadRes.secure_url,
      secure_url: uploadRes.secure_url,
      key: uploadRes.key || uploadRes.publicId,
      publicId: uploadRes.publicId
    });
  } catch (err: any) {
    console.error("Error in upload route:", err);
    res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
});

// Durable S3 Media Viewing Endpoint with Folder-Level Authorization & HTTP Caching
app.get(['/api/media/s3/:key(*)', '/api/uploads/s3/:key(*)'], async (req, res) => {
  try {
    const rawKey = req.params.key || req.params[0] || '';
    const cleanKey = decodeURIComponent(rawKey).replace(/^\/+/, '');

    // Directory traversal & safe character validation
    if (!cleanKey || cleanKey.includes('..') || !/^[a-zA-Z0-9_\-\/.]+\.(jpg|jpeg|png|webp|gif|avif|pdf|svg|webm|mp3|wav|m4a|ogg|aac|doc|docx|xls|xlsx|csv|txt)$/i.test(cleanKey)) {
      return res.status(400).json({ error: 'Invalid or disallowed media key.' });
    }

    // Access policy: Separate public product/catalog images from private sensitive documents
    const isSensitiveDocument = /^(kyc|aadhaar|pan|passbooks|admin_docs|documents|resumes)\//i.test(cleanKey);
    if (isSensitiveDocument) {
      const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
      const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (authHeader as string | undefined);
      if (!token) {
        return res.status(401).json({ error: 'Authentication required to access private document.' });
      }
      try {
        const payload = securityManager.verifyAccessToken(token);
        if (!payload) {
          return res.status(403).json({ error: 'Invalid or expired access token.' });
        }
      } catch {
        return res.status(403).json({ error: 'Authentication failed.' });
      }
    }

    // Stream S3 object
    const streamRes = await getObjectStream(cleanKey);
    if (!streamRes.success || !streamRes.body) {
      return res.status(404).json({ error: streamRes.error || 'Media object not found.' });
    }

    // HTTP Caching & ETag validation (304 Not Modified)
    if (streamRes.etag) {
      res.setHeader('ETag', streamRes.etag);
      if (req.headers['if-none-match'] === streamRes.etag) {
        return res.status(304).end();
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', streamRes.contentType || 'application/octet-stream');
    if (streamRes.contentLength) {
      res.setHeader('Content-Length', streamRes.contentLength.toString());
    }

    res.setHeader('Cache-Control', isSensitiveDocument ? 'private, no-cache, no-store' : 'public, max-age=86400, stale-while-revalidate=604800');

    const readable = streamRes.body as NodeJS.ReadableStream;
    readable.pipe(res);
  } catch (err: any) {
    console.error('[Media S3 Stream Error]:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve media.' });
    }
  }
});

// Single Product Fetch Endpoint
app.get(['/api/products/:id', '/api/public/products/:id'], async (req, res) => {
  try {
    const mongoDb = db.getDb();
    if (!mongoDb) return res.status(500).json({ error: 'Database unavailable' });

    const { id } = req.params;
    let query: any = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { $or: [{ _id: new ObjectId(id) }, { _id: id }, { id: id }] };
    }

    const product = await mongoDb.collection('products').findOne(query);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let primaryImg = product.imageUrl || product.image || '';
    if (!primaryImg && Array.isArray(product.images) && product.images.length > 0) {
      const first = product.images[0];
      primaryImg = typeof first === 'string' ? first : (first?.url || '');
    }
    if (!primaryImg && Array.isArray(product.imageUrls) && product.imageUrls.length > 0) {
      primaryImg = product.imageUrls[0] || '';
    }

    primaryImg = resolveDurableImageUrl(primaryImg);
    const resolvedImages = Array.isArray(product.images)
      ? product.images.map((img: any) => {
          const u = typeof img === 'string' ? img : (img?.url || img?.secure_url || '');
          const clean = resolveDurableImageUrl(u);
          return clean ? { url: clean, key: extractS3Key(u) || undefined } : null;
        }).filter(Boolean)
      : (primaryImg ? [{ url: primaryImg }] : []);

    const resolvedImageUrls = Array.isArray(product.imageUrls)
      ? product.imageUrls.map((u: any) => resolveDurableImageUrl(u)).filter(Boolean)
      : (primaryImg ? [primaryImg] : []);

    return res.json({
      ...product,
      id: product.id || product._id?.toString(),
      imageUrl: primaryImg,
      image: primaryImg,
      images: resolvedImages,
      imageUrls: resolvedImageUrls
    });
  } catch (err: any) {
    console.error("Error fetching single product:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Product Creation Endpoint with Cloudinary Persistence
app.post(['/api/products', '/api/public/products', '/api/admin/products'], async (req, res) => {
  try {
    const mongoDb = db.getDb();
    if (!mongoDb) return res.status(500).json({ error: 'Database unavailable' });

    const payload = { ...req.body };
    delete payload._id;

    // Process primary image if base64 data URI
    let primaryImageUrl = payload.imageUrl || payload.image || '';
    if (primaryImageUrl && typeof primaryImageUrl === 'string' && primaryImageUrl.startsWith('data:image/')) {
      const uploadRes = await uploadToS3(primaryImageUrl, 'products');
      if (uploadRes.success && uploadRes.secure_url) {
        primaryImageUrl = uploadRes.secure_url;
      }
    }

    // Process multiple images array if provided
    let processedImages: any[] = [];
    if (Array.isArray(payload.images) && payload.images.length > 0) {
      for (const imgItem of payload.images) {
        const rawUrl = typeof imgItem === 'string' ? imgItem : (imgItem?.url || '');
        if (rawUrl && rawUrl.startsWith('data:image/')) {
          const uploadRes = await uploadToS3(rawUrl, 'products');
          if (uploadRes.success && uploadRes.secure_url) {
            processedImages.push({ url: uploadRes.secure_url, publicId: uploadRes.publicId });
          }
        } else if (rawUrl) {
          processedImages.push(typeof imgItem === 'object' ? imgItem : { url: rawUrl });
        }
      }
    } else if (primaryImageUrl) {
      processedImages = [{ url: primaryImageUrl }];
    }

    // If primaryImageUrl was empty but processedImages has items, use the first
    if (!primaryImageUrl && processedImages.length > 0) {
      primaryImageUrl = processedImages[0].url || '';
    }

    const processedImageUrls = processedImages.map(img => typeof img === 'string' ? img : img.url).filter(Boolean);

    const newProduct = {
      ...payload,
      imageUrl: primaryImageUrl,
      image: primaryImageUrl,
      images: processedImages,
      imageUrls: processedImageUrls,
      isActive: payload.isActive !== false,
      isAvailable: payload.isAvailable !== false,
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const insertResult = await mongoDb.collection('products').insertOne(newProduct);
    await invalidatePublicProductsCache();
    const savedProduct = {
      ...newProduct,
      _id: insertResult.insertedId,
      id: insertResult.insertedId.toString()
    };

    // Publish event after DB commit
    await eventPublisher.publishEvent(
      RealtimeEntities.PRODUCT,
      RealtimeActions.CREATED,
      savedProduct.id,
      savedProduct
    );

    return res.status(201).json({
      success: true,
      message: 'Product created successfully with permanent image persistence.',
      product: savedProduct
    });
  } catch (err: any) {
    console.error("Error creating product:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Product Update Endpoint (PRESERVES EXISTING IMAGES WHEN NOT CHANGED)
const handleUpdateProduct = async (req: any, res: any) => {
  try {
    const mongoDb = db.getDb();
    if (!mongoDb) return res.status(500).json({ error: 'Database unavailable' });

    const { id } = req.params;
    let query: any = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { $or: [{ _id: new ObjectId(id) }, { _id: id }, { id: id }] };
    }

    const existing = await mongoDb.collection('products').findOne(query);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updatePayload = { ...req.body };
    delete updatePayload._id;
    delete updatePayload.id;

    // Check if new images are provided or if existing should be preserved
    let updatedImageUrl = updatePayload.imageUrl !== undefined ? updatePayload.imageUrl : (updatePayload.image !== undefined ? updatePayload.image : undefined);
    let updatedImages = updatePayload.images;
    let updatedImageUrls = updatePayload.imageUrls;

    // If updatePayload did not provide an image or sent empty string, and user did not explicitly flag removeImage,
    // PRESERVE the existing product's images!
    const isExplicitlyRemoving = updatePayload.removeImage === true;

    if (!isExplicitlyRemoving) {
      if (!updatedImageUrl && !updatedImages?.length && !updatedImageUrls?.length) {
        // Retain existing image references
        updatedImageUrl = existing.imageUrl || existing.image || '';
        updatedImages = existing.images || (updatedImageUrl ? [{ url: updatedImageUrl }] : []);
        updatedImageUrls = existing.imageUrls || (updatedImageUrl ? [updatedImageUrl] : []);
      }
    }

    // If new image is base64, upload to Cloudinary
    if (updatedImageUrl && typeof updatedImageUrl === 'string' && updatedImageUrl.startsWith('data:image/')) {
      const uploadRes = await uploadToS3(updatedImageUrl, 'products');
      if (uploadRes.success && uploadRes.secure_url) {
        updatedImageUrl = uploadRes.secure_url;
      }
    }

    // Process images array if provided
    if (Array.isArray(updatedImages) && updatedImages.length > 0) {
      const processed: any[] = [];
      for (const imgItem of updatedImages) {
        const rawUrl = typeof imgItem === 'string' ? imgItem : (imgItem?.url || '');
        if (rawUrl && rawUrl.startsWith('data:image/')) {
          const uploadRes = await uploadToS3(rawUrl, 'products');
          if (uploadRes.success && uploadRes.secure_url) {
            processed.push({ url: uploadRes.secure_url, publicId: uploadRes.publicId });
          }
        } else if (rawUrl) {
          processed.push(typeof imgItem === 'object' ? imgItem : { url: rawUrl });
        }
      }
      updatedImages = processed;
      updatedImageUrls = processed.map(img => typeof img === 'string' ? img : img.url).filter(Boolean);
      if (!updatedImageUrl && updatedImages.length > 0) {
        updatedImageUrl = updatedImages[0].url || '';
      }
    }

    updatePayload.imageUrl = updatedImageUrl;
    updatePayload.image = updatedImageUrl;
    updatePayload.images = updatedImages;
    updatePayload.imageUrls = updatedImageUrls;
    updatePayload.updatedAt = new Date().toISOString();

    await mongoDb.collection('products').updateOne(query, { $set: updatePayload });
    await invalidatePublicProductsCache();

    const finalProduct = await mongoDb.collection('products').findOne(query);
    const mappedFinal = {
      ...finalProduct,
      id: finalProduct?._id?.toString() || id
    };

    // Publish event after DB commit
    await eventPublisher.publishEvent(
      RealtimeEntities.PRODUCT,
      RealtimeActions.UPDATED,
      mappedFinal.id,
      mappedFinal
    );

    return res.json({
      success: true,
      message: 'Product updated successfully while preserving images.',
      product: mappedFinal
    });
  } catch (err: any) {
    console.error("Error updating product:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

app.put(['/api/products/:id', '/api/public/products/:id', '/api/admin/products/:id'], handleUpdateProduct);
app.patch(['/api/products/:id', '/api/public/products/:id', '/api/admin/products/:id'], handleUpdateProduct);

// Product Deletion Endpoint
app.delete(['/api/products/:id', '/api/public/products/:id', '/api/admin/products/:id'], async (req, res) => {
  try {
    const mongoDb = db.getDb();
    if (!mongoDb) return res.status(500).json({ error: 'Database unavailable' });

    const { id } = req.params;
    let query: any = { _id: id };
    if (ObjectId.isValid(id)) {
      query = { $or: [{ _id: new ObjectId(id) }, { _id: id }, { id: id }] };
    }

    await mongoDb.collection('products').deleteOne(query);
    await invalidatePublicProductsCache();

    // Publish event after DB commit
    await eventPublisher.publishEvent(
      RealtimeEntities.PRODUCT,
      RealtimeActions.DELETED,
      id,
      { id }
    );

    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err: any) {
    console.error("Error deleting product:", err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.delete('/api/public/products/delete-all', async (req, res) => {
  try {
    const mongoDb = db.getDb();
    if (mongoDb) {
      await mongoDb.collection('products').deleteMany({});
      await invalidatePublicProductsCache();
      await eventPublisher.publishEvent(
        RealtimeEntities.PRODUCT,
        RealtimeActions.DELETED,
        'all',
        { all: true }
      );
      return res.json({ success: true, message: 'All products deleted successfully.' });
    }
    return res.status(500).json({ error: 'Database unavailable' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Observability Health & Metrics Endpoints
app.get(['/api/realtime/health', '/health/realtime'], async (req, res) => {
  try {
    const health = await getRealtimeHealth();
    return res.json(health);
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get(['/api/realtime/metrics', '/metrics/realtime'], async (req, res) => {
  try {
    const metrics = await getRealtimeHealth();
    return res.json(metrics);
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

// Catch-all 404 handler for non-existent API routes with CORS headers
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.status(404).json({ status: 'error', message: `Route ${req.method} ${req.url} not found` });
});

// Global Express Error Handler with OWASP Safe Error Sanitization
app.use((err: any, req: any, res: any, next: any) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');

  console.error('[Unhandled Server Error]:', err?.stack || err);
  const status = typeof err.status === 'number' ? err.status : (typeof err.statusCode === 'number' ? err.statusCode : 500);
  const message = (process.env.NODE_ENV === 'production' && status >= 500)
    ? 'An unexpected error occurred. Please try again later.'
    : (err.message || 'Internal Server Error');

  res.status(status).json({ status: 'error', message });
});

// Create HTTP server and initialize global real-time architecture
const server = http.createServer(app);
initRealtimeInfrastructure(server).catch(err => {
  console.error('[Realtime]: Infrastructure initialization issue:', err);
});

async function startApp() {
  try {
    console.log('[Server]: Connecting to MongoDB Atlas single source of truth...');
    await db.connect();
    console.log('[Server]: Database connection initialized and ready.');

    server.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[Server]: Connect App Backend running on 0.0.0.0:${PORT} with DevSecOps Security`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server FATAL]: Port ${PORT} is already in use by another process. Please check 'sudo lsof -i :${PORT}' or ensure previous PM2 process gracefully shut down.`);
        process.exit(1);
      } else {
        console.error('[Server Error]:', err);
      }
    });
  } catch (err: any) {
    console.error('[Server FATAL]: Database connection failed during startup:', err.message);
    process.exit(1);
  }
}

startApp();
