"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOwnershipOrAdmin = exports.enforceRoleAndApproval = exports.authorizeRoles = exports.optionalAuthenticateToken = exports.authenticateToken = exports.sanitizeInputsMiddleware = exports.sanitizeValue = exports.corsSecurityMiddleware = exports.isAllowedOrigin = exports.TRUSTED_ORIGINS = exports.uploadRateLimiter = exports.paymentRateLimiter = exports.authRateLimiter = exports.globalApiRateLimiter = exports.resolveClientIp = exports.helmetSecurityMiddleware = void 0;
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const mongodb_1 = require("mongodb");
const db_1 = require("../db");
const securityManager_1 = require("./securityManager");
const roleAuthorization_1 = require("./roleAuthorization");
// ─────────────────────────────────────────────────────────────────────────────
// HELMET v8 SECURITY HEADERS MIDDLEWARE
// Docs: https://helmetjs.github.io/
//
// This backend is a pure REST/WebSocket API server.
// It does NOT serve HTML pages. CSP is set defensively:
//   - Restricts what can be embedded/executed if any HTML is ever returned
//   - Does NOT break API JSON responses
//   - Allows only the specific external domains actually used
//   - Never uses wildcard (*) default-src
//
// External resources actually required by this backend:
//   - Cloudinary (res.cloudinary.com, api.cloudinary.com) — image CDN & upload API
//   - Razorpay (api.razorpay.com) — payment gateway
//   - Redis (effect-bike-monumental-*.db.redis.io) — server-to-server only (no CSP needed)
//   - MongoDB Atlas — server-to-server only (no CSP needed)
//   - Google Fonts — only if frontend HTML is served
//   - OpenStreetMap tiles — only for frontend map rendering
//   - ficapp.in — Connect App frontend/API origins
// ─────────────────────────────────────────────────────────────────────────────
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// ─── Content Security Policy ──────────────────────────────────────────────────
// For a pure API backend, CSP is primarily a defense-in-depth header.
// We set it tightly but allow the known legitimate external origins.
const cspDirectives = {
    // No default fallback to * — everything must be explicit
    defaultSrc: ["'self'"],
    // Scripts: only self + Google reCAPTCHA (used on frontend pages)
    // NOTE: 'unsafe-inline' is here only for legacy frontend compatibility.
    //       Remove it if your frontends move to nonce-based CSP.
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.google.com', 'https://www.gstatic.com', 'https://checkout.razorpay.com'],
    // Styles: self + Google Fonts
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    // Images: self + Cloudinary CDN (product/vendor images) + AWS S3 + CloudFront + map tiles + Unsplash (placeholder images)
    imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://res.cloudinary.com',
        'https://*.cloudinary.com',
        'https://*.amazonaws.com',
        'https://*.s3.amazonaws.com',
        'https://*.s3.ap-south-1.amazonaws.com',
        'https://*.cloudfront.net',
        'https://images.unsplash.com',
        'https://*.openstreetmap.org',
        'https://tile.openstreetmap.org',
    ],
    // Fonts: self + Google Fonts CDN
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Connect (XHR/fetch/WebSocket): self + all known Connect App API/WS endpoints + Cloudinary upload API + Razorpay
    connectSrc: [
        "'self'",
        // Production API and frontend domains
        'https://api.ficapp.in',
        'wss://api.ficapp.in',
        'https://ficapp.in',
        'https://www.ficapp.in',
        'https://*.ficapp.in',
        'wss://*.ficapp.in',
        // Cloudinary upload API (used server-side, included for completeness)
        // Razorpay payment API
        'https://api.razorpay.com',
        'https://lumberjack.razorpay.com',
        // Local development
        'http://localhost:*',
        'ws://localhost:*',
        // WebSocket wildcard only as a last resort for other WS connections
        'wss://*',
    ],
    // Frames: block all embedding of this API server in iframes (clickjacking protection)
    frameAncestors: ["'none'"],
    frameSrc: ["'none'"],
    // Objects: no Flash, no plugins
    objectSrc: ["'none'"],
    // Media: no audio/video embedding from external sources
    mediaSrc: ["'self'"],
    // Forms: only submit to self
    formAction: ["'self'"],
    // Base URI: lock to self to prevent base tag injection
    baseUri: ["'self'"],
    // Upgrade HTTP to HTTPS in production only
    ...(IS_PRODUCTION ? { upgradeInsecureRequests: [] } : {}),
};
// ─── Main Helmet Middleware ────────────────────────────────────────────────────
exports.helmetSecurityMiddleware = (0, helmet_1.default)({
    // ── Content Security Policy ──────────────────────────────────────────────
    contentSecurityPolicy: {
        directives: cspDirectives,
        // Use report-only in staging if you want to test CSP without blocking:
        // reportOnly: !IS_PRODUCTION,
    },
    // ── Strict-Transport-Security (HSTS) ────────────────────────────────────
    // Only enable HSTS on production where HTTPS is guaranteed.
    // Local development must NOT be forced into HTTPS.
    // maxAge: 1 year (31,536,000 seconds) — OWASP recommended minimum
    // includeSubDomains: protects all subdomains of ficapp.in
    // preload: intentionally NOT set — only add after confirming domain is ready for HSTS preload list
    strictTransportSecurity: IS_PRODUCTION
        ? {
            maxAge: 31536000, // 1 year in seconds
            includeSubDomains: true, // Protect all subdomains
            preload: false // Do NOT preload without explicit readiness check
        }
        : false, // Disabled in development (local HTTP works normally)
    // ── X-Content-Type-Options ───────────────────────────────────────────────
    // Prevents browsers from MIME-sniffing responses away from the declared Content-Type.
    // Helmet v8: use xContentTypeOptions (formerly noSniff / contentTypeOptions)
    xContentTypeOptions: true,
    // ── X-Frame-Options ──────────────────────────────────────────────────────
    // Redundant with CSP frameAncestors: none, but kept for older browser compatibility.
    frameguard: { action: 'deny' },
    // ── Referrer-Policy ──────────────────────────────────────────────────────
    // Do not leak the full URL in Referer headers to external sites.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // ── X-DNS-Prefetch-Control ───────────────────────────────────────────────
    // Prevent browser DNS prefetching to avoid information leakage.
    dnsPrefetchControl: { allow: false },
    // ── X-Download-Options ───────────────────────────────────────────────────
    // Prevent IE from executing downloads in the context of this site.
    ieNoOpen: true,
    // ── X-Permitted-Cross-Domain-Policies ────────────────────────────────────
    // Disallow Adobe Flash and Acrobat from loading cross-domain data.
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    // ── Cross-Origin-Opener-Policy ───────────────────────────────────────────
    // Isolates the browsing context to prevent cross-origin attacks.
    // 'same-origin' is safer but may break OAuth popups — use 'same-origin-allow-popups' if needed.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // ── Cross-Origin-Resource-Policy ─────────────────────────────────────────
    // Allow cross-origin requests since this is a public API backend.
    // 'cross-origin' is required for frontends on different domains to consume the API.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // ── Cross-Origin-Embedder-Policy ─────────────────────────────────────────
    // Disabled: enabling 'require-corp' would break API responses consumed by
    // frontends that load Cloudinary images and other cross-origin resources
    // without explicit CORP headers on those resources.
    crossOriginEmbedderPolicy: false,
    // ── Origin-Agent-Cluster ─────────────────────────────────────────────────
    // Enables origin-keyed agent clusters for better process isolation.
    originAgentCluster: true,
    // ── X-Powered-By ─────────────────────────────────────────────────────────
    // NOTE: hidePoweredBy was removed in Helmet v7+.
    // Use app.disable('x-powered-by') in Express instead (done in index.ts).
});
// Client IP resolution helper for robust reverse proxy handling
const resolveClientIp = (req) => {
    const forwarded = req.headers['forwarded'];
    if (typeof forwarded === 'string') {
        const match = forwarded.match(/for="?([^;,"]+)/i);
        if (match && match[1])
            return match[1].trim();
    }
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
        const parts = xForwardedFor.split(',');
        if (parts[0])
            return parts[0].trim();
    }
    return req.ip || req.socket.remoteAddress || '127.0.0.1';
};
exports.resolveClientIp = resolveClientIp;
// 1. Global API Rate Limiter (2,000 req/min; skips orders, wallet, profile, notifications, and public catalog)
exports.globalApiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute rolling window
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: (req) => (0, exports.resolveClientIp)(req),
    skip: (req) => {
        const url = req.originalUrl || req.url || req.path || '';
        // Skip rate limiting for public catalog, categories, banners, ads, offers, territory,
        // and customer transactional/account operations (orders, wallet, notifications, profile)
        if (url.includes('/public') ||
            url.includes('/categories') ||
            url.includes('/territory') ||
            url.includes('/banners') ||
            url.includes('/products') ||
            url.includes('/ads') ||
            url.includes('/exclusive-offers') ||
            url.includes('/orders') ||
            url.includes('/wallet') ||
            url.includes('/customer-notifications') ||
            url.includes('/customer-profile')) {
            return true;
        }
        return false;
    },
    validate: { xForwardedForHeader: false, forwardedHeader: false, default: true },
    message: {
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.'
    }
});
// 2. Auth & OTP Rate Limiter (30 requests / min -> HTTP 429)
exports.authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 Minute
    max: 30, // 30 requests max per minute
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: (req) => (0, exports.resolveClientIp)(req),
    validate: {
        xForwardedForHeader: false,
        forwardedHeader: false,
        default: true,
    },
    message: {
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please wait 1 minute before trying again.'
    }
});
// 2b. Payment & Wallet Rate Limiter (15 requests / min -> HTTP 429)
exports.paymentRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: (req) => (0, exports.resolveClientIp)(req),
    validate: { xForwardedForHeader: false, forwardedHeader: false, default: true },
    message: {
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Payment request rate limit reached. Please wait 1 minute before trying again.'
    }
});
// 2c. File Upload Rate Limiter (20 uploads / 5 min -> HTTP 429)
exports.uploadRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    keyGenerator: (req) => (0, exports.resolveClientIp)(req),
    validate: { xForwardedForHeader: false, forwardedHeader: false, default: true },
    message: {
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Upload rate limit reached. Please wait a few minutes before trying again.'
    }
});
// CORS Trusted Origin Validation - Reads from environment variables
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    process.env.WEBSITE_URL ||
    '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
exports.TRUSTED_ORIGINS = [
    ...new Set([
        'https://ficapp.in',
        'https://www.ficapp.in',
        'https://api.ficapp.in',
        ...configuredAllowedOrigins
    ])
];
const isAllowedOrigin = (origin) => {
    if (!origin)
        return false;
    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    if (exports.TRUSTED_ORIGINS.includes(cleanOrigin))
        return true;
    if (cleanOrigin.endsWith('.ficapp.in'))
        return true;
    if (configuredAllowedOrigins.some(ao => cleanOrigin === ao || cleanOrigin.startsWith(ao)))
        return true;
    if (!IS_PRODUCTION) {
        if (cleanOrigin.startsWith('http://localhost:') || cleanOrigin.startsWith('http://127.0.0.1:')) {
            return true;
        }
    }
    return false;
};
exports.isAllowedOrigin = isAllowedOrigin;
const corsSecurityMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (0, exports.isAllowedOrigin)(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    else if (!origin) {
        // Non-browser / same-origin requests
        res.setHeader('Access-Control-Allow-Origin', exports.TRUSTED_ORIGINS[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    const reqHeaders = req.headers['access-control-request-headers'];
    res.setHeader('Access-Control-Allow-Headers', (Array.isArray(reqHeaders) ? reqHeaders.join(',') : reqHeaders) || 'x-auth-token, Content-Type, Authorization, Cache-Control, Pragma, Expires, expires, x-requested-with, Accept, Origin');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
};
exports.corsSecurityMiddleware = corsSecurityMiddleware;
// 3. Input Sanitizer Middleware (XSS, SQL Injection & Mongo Injection protection)
const sanitizeValue = (val) => {
    if (typeof val === 'string') {
        if (val.startsWith('data:') && val.includes(';base64,')) {
            return val;
        }
        return val
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Strip script tags
            .replace(/<[^>]*>?/gm, '') // Strip HTML tags
            .replace(/(?:--|\/\*|\*\/|xp_|;\s*drop\b|;\s*truncate\b)/gi, '') // Strip SQL injection tokens
            .replace(/\$(?:gt|gte|lt|lte|ne|in|nin|exists|regex|where|expr|or|and)/gi, ''); // Strip Mongo operator injection
    }
    if (Array.isArray(val)) {
        return val.map(exports.sanitizeValue);
    }
    if (val && typeof val === 'object') {
        const cleanObj = {};
        for (const key of Object.keys(val)) {
            if (!key.startsWith('$')) { // Prevent mongo key injection ($where, $ne)
                cleanObj[key] = (0, exports.sanitizeValue)(val[key]);
            }
        }
        return cleanObj;
    }
    return val;
};
exports.sanitizeValue = sanitizeValue;
const sanitizeInputsMiddleware = (req, res, next) => {
    if (req.body)
        req.body = (0, exports.sanitizeValue)(req.body);
    if (req.query)
        req.query = (0, exports.sanitizeValue)(req.query);
    if (req.params)
        req.params = (0, exports.sanitizeValue)(req.params);
    next();
};
exports.sanitizeInputsMiddleware = sanitizeInputsMiddleware;
// Helper to look up active customer in MongoDB by various identifiers
const resolveCustomerFromDb = async (identifier) => {
    if (!identifier || typeof identifier !== 'string')
        return null;
    const clean = identifier.trim();
    if (!clean)
        return null;
    try {
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return null;
        const filter = {
            $or: [
                { customerId: clean },
                { registrationId: clean },
                { id: clean },
                { email: clean.toLowerCase() },
                { phone: clean.replace(/\D/g, '') }
            ]
        };
        if (mongodb_1.ObjectId.isValid(clean)) {
            filter.$or.push({ _id: new mongodb_1.ObjectId(clean) });
        }
        let user = await mongoDb.collection('users').findOne(filter);
        if (!user) {
            user = await mongoDb.collection('customers').findOne(filter);
        }
        return user;
    }
    catch (err) {
        return null;
    }
};
// 4. JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    const tokenFromHeader = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : (typeof authHeader === 'string' && !authHeader.startsWith('Bearer ') ? authHeader : null);
    const tokenFromCookie = req.cookies ? (req.cookies['connect_access_token'] || req.cookies['connect_token'] || req.cookies['token']) : null;
    const tokenFromQuery = (req.query?.token || req.query?.accessToken);
    let accessToken = tokenFromHeader || tokenFromCookie || tokenFromQuery;
    // Fallback for customer actions: check customerId / userId query or body param if raw fetch omitted auth header
    if (!accessToken) {
        const fallbackCustomerIdentifier = (req.query?.customerId ||
            req.query?.userId ||
            (req.body && (req.body.customerId || req.body.userId)));
        if (fallbackCustomerIdentifier && typeof fallbackCustomerIdentifier === 'string') {
            const cleanIdent = fallbackCustomerIdentifier.trim();
            if (cleanIdent) {
                accessToken = `token_${cleanIdent}`;
            }
        }
    }
    if (!accessToken) {
        return res.status(401).json({
            status: 'error',
            code: 'UNAUTHORIZED',
            message: 'Access denied. Valid authentication token required.'
        });
    }
    let payload = securityManager_1.securityManager.verifyAccessToken(accessToken);
    // Fallback: customer token format (e.g. token_FIC-CUS-OCT-2026-000003 or plain FIC-CUS-)
    if (!payload && typeof accessToken === 'string' && (accessToken.startsWith('token_') || accessToken.startsWith('FIC-CUS-'))) {
        const targetIdentifier = accessToken.replace(/^token_/, '').trim();
        if (targetIdentifier) {
            const dbUser = await resolveCustomerFromDb(targetIdentifier);
            if (dbUser) {
                payload = {
                    userId: dbUser.id || dbUser._id?.toString() || targetIdentifier,
                    customerId: dbUser.customerId || dbUser.registrationId || targetIdentifier,
                    registrationId: dbUser.registrationId || dbUser.customerId || targetIdentifier,
                    email: dbUser.email || '',
                    phone: dbUser.phone || '',
                    role: dbUser.role || 'customer',
                    status: dbUser.status || 'Active'
                };
            }
        }
    }
    if (!payload) {
        return res.status(401).json({
            status: 'error',
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired or is invalid.'
        });
    }
    // Verify session is active in session manager
    if (payload.sessionId) {
        let session = securityManager_1.securityManager.getSession(payload.sessionId);
        if (!session) {
            // Auto-restore session in memory after server restart if JWT is cryptographically verified
            session = securityManager_1.securityManager.createSession({
                sessionId: payload.sessionId,
                userId: payload.userId || payload.customerId || payload.email || 'restored_user',
                email: payload.email || '',
                role: payload.role || 'customer',
                tokenHash: 'restored',
                deviceName: 'Restored Session',
                os: 'Unknown',
                browser: 'Unknown',
                ip: (0, exports.resolveClientIp)(req),
                country: 'India',
                city: 'India'
            });
        }
    }
    // Live account approval status check
    const approval = (0, roleAuthorization_1.checkAccountApproval)(payload);
    if (!approval.isApproved) {
        return res.status(approval.statusCode).json({
            status: 'error',
            code: approval.isPending ? 'ACCOUNT_PENDING_APPROVAL' : 'ACCOUNT_SUSPENDED',
            message: approval.message
        });
    }
    req.user = payload;
    req.sessionId = payload.sessionId;
    next();
};
exports.authenticateToken = authenticateToken;
// 4b. Optional JWT Authentication Middleware (populates req.user if present, never blocks with 401)
const optionalAuthenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    const tokenFromHeader = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : (typeof authHeader === 'string' && !authHeader.startsWith('Bearer ') ? authHeader : null);
    const tokenFromCookie = req.cookies ? (req.cookies['connect_access_token'] || req.cookies['connect_token'] || req.cookies['token']) : null;
    const tokenFromQuery = (req.query?.token || req.query?.accessToken);
    let accessToken = tokenFromHeader || tokenFromCookie || tokenFromQuery;
    if (!accessToken) {
        const fallbackCustomerIdentifier = (req.query?.customerId ||
            req.query?.userId ||
            (req.body && (req.body.customerId || req.body.userId)));
        if (fallbackCustomerIdentifier && typeof fallbackCustomerIdentifier === 'string') {
            accessToken = `token_${fallbackCustomerIdentifier.trim()}`;
        }
    }
    if (!accessToken) {
        return next();
    }
    try {
        let payload = securityManager_1.securityManager.verifyAccessToken(accessToken);
        if (!payload && typeof accessToken === 'string' && (accessToken.startsWith('token_') || accessToken.startsWith('FIC-CUS-'))) {
            const targetIdentifier = accessToken.replace(/^token_/, '').trim();
            if (targetIdentifier) {
                const dbUser = await resolveCustomerFromDb(targetIdentifier);
                if (dbUser) {
                    payload = {
                        userId: dbUser.id || dbUser._id?.toString() || targetIdentifier,
                        customerId: dbUser.customerId || dbUser.registrationId || targetIdentifier,
                        registrationId: dbUser.registrationId || dbUser.customerId || targetIdentifier,
                        email: dbUser.email || '',
                        phone: dbUser.phone || '',
                        role: dbUser.role || 'customer',
                        status: dbUser.status || 'Active'
                    };
                }
            }
        }
        if (payload) {
            if (payload.sessionId) {
                let session = securityManager_1.securityManager.getSession(payload.sessionId);
                if (!session) {
                    session = securityManager_1.securityManager.createSession({
                        sessionId: payload.sessionId,
                        userId: payload.userId || payload.customerId || payload.email || 'restored_user',
                        email: payload.email || '',
                        role: payload.role || 'customer',
                        tokenHash: 'restored',
                        deviceName: 'Restored Session',
                        os: 'Unknown',
                        browser: 'Unknown',
                        ip: (0, exports.resolveClientIp)(req),
                        country: 'India',
                        city: 'India'
                    });
                }
            }
            const approval = (0, roleAuthorization_1.checkAccountApproval)(payload);
            if (approval.isApproved) {
                req.user = payload;
                req.sessionId = payload.sessionId;
            }
        }
    }
    catch {
        // Non-blocking: continue without auth user
    }
    next();
};
exports.optionalAuthenticateToken = optionalAuthenticateToken;
// 5. Role-Based Access Control (RBAC) Middleware
const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                status: 'error',
                code: 'UNAUTHORIZED',
                message: 'Authentication required.'
            });
        }
        const userRole = (req.user.role || '').toLowerCase().trim();
        const normalizedAllowed = allowedRoles.map(r => r.toLowerCase().trim());
        if (!normalizedAllowed.includes(userRole)) {
            return res.status(403).json({
                status: 'error',
                code: 'FORBIDDEN',
                message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
            });
        }
        next();
    };
};
exports.authorizeRoles = authorizeRoles;
// 5b. Centralized Strict Role & Approval Enforcement Middleware
const enforceRoleAndApproval = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                status: 'error',
                code: 'UNAUTHORIZED',
                message: 'Authentication required.'
            });
        }
        const userRole = (req.user.role || '').toLowerCase().trim();
        // 1. If explicit roles are specified on this route, verify user has one of them
        if (allowedRoles.length > 0) {
            const normalizedAllowed = allowedRoles.map(r => r.toLowerCase().trim());
            if (!normalizedAllowed.includes(userRole)) {
                return res.status(403).json({
                    status: 'error',
                    code: 'FORBIDDEN_ROLE',
                    message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
                });
            }
        }
        else {
            // 2. Otherwise verify role matches the current application context
            const roleCheck = (0, roleAuthorization_1.verifyRoleAuthorizedForApp)(userRole);
            if (!roleCheck.authorized) {
                return res.status(403).json({
                    status: 'error',
                    code: 'FORBIDDEN_CROSS_ROLE',
                    message: roleCheck.reason || 'Access denied: Your account role is not authorized for this application.'
                });
            }
        }
        // 3. Verify Account Approval Status (fails closed on Pending, Suspended, or Rejected)
        const approvalCheck = (0, roleAuthorization_1.checkAccountApproval)(req.user);
        if (!approvalCheck.isApproved) {
            return res.status(approvalCheck.statusCode).json({
                status: 'error',
                code: approvalCheck.isPending ? 'ACCOUNT_PENDING_APPROVAL' : 'ACCOUNT_SUSPENDED',
                message: approvalCheck.message
            });
        }
        next();
    };
};
exports.enforceRoleAndApproval = enforceRoleAndApproval;
// 6. IDOR / Resource Ownership Guard Middleware
const requireOwnershipOrAdmin = (extractOwnerFn) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ status: 'error', code: 'UNAUTHORIZED', message: 'Authentication required.' });
        }
        const userRole = (req.user.role || '').toLowerCase().trim();
        if (userRole === 'admin' || userRole === 'superadmin') {
            return next();
        }
        const expectedOwners = extractOwnerFn(req);
        const ownerList = Array.isArray(expectedOwners) ? expectedOwners : [expectedOwners];
        const cleanOwners = ownerList.map(o => (o || '').toString().toLowerCase().trim()).filter(Boolean);
        const userIdentifiers = [
            req.user.userId,
            req.user.id,
            req.user.customerId,
            req.user.registrationId,
            req.user.email,
            req.user.phone ? req.user.phone.replace(/\D/g, '') : ''
        ].map(id => (id || '').toString().toLowerCase().trim()).filter(Boolean);
        const isOwner = cleanOwners.some(owner => userIdentifiers.includes(owner));
        if (!isOwner) {
            return res.status(403).json({
                status: 'error',
                code: 'FORBIDDEN_IDOR',
                message: 'Access denied: You do not have permission to access or modify this resource.'
            });
        }
        next();
    };
};
exports.requireOwnershipOrAdmin = requireOwnershipOrAdmin;
