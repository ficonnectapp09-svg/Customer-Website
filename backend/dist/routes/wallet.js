"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const razorpay_1 = __importDefault(require("razorpay"));
const db_1 = require("../db");
const mongodb_1 = require("mongodb");
const middleware_1 = require("../security/middleware");
const router = (0, express_1.Router)();
async function resolveWalletTarget(req, requested) {
    const authUser = req.user;
    const mongoDb = db_1.db.getDb();
    if (!authUser) {
        const reqCust = String(requested?.customerId || requested?.userId || requested?.id || '').trim();
        const reqEmail = String(requested?.email || '').toLowerCase().trim();
        const reqPhone = String(requested?.phone || '').replace(/\D/g, '');
        if (reqCust || reqEmail || reqPhone) {
            return {
                target: {
                    userId: reqCust,
                    customerId: reqCust,
                    email: reqEmail,
                    phone: reqPhone
                },
                isOwner: true
            };
        }
        return { target: null, isOwner: false };
    }
    const isAdmin = authUser.role === 'admin' || authUser.role === 'superadmin';
    if (isAdmin) {
        return { target: requested || { userId: authUser.userId, email: authUser.email }, isOwner: true };
    }
    // Find user in DB to gather all aliases for this authenticated customer
    let dbUser = null;
    if (mongoDb) {
        const orClauses = [];
        if (authUser.userId) {
            orClauses.push({ id: authUser.userId }, { customerId: authUser.userId });
            if (mongodb_1.ObjectId.isValid(authUser.userId))
                orClauses.push({ _id: new mongodb_1.ObjectId(authUser.userId) });
        }
        if (authUser.customerId) {
            orClauses.push({ customerId: authUser.customerId }, { id: authUser.customerId });
        }
        if (authUser.email) {
            orClauses.push({ email: authUser.email.toLowerCase().trim() });
        }
        if (authUser.phone) {
            orClauses.push({ phone: authUser.phone.replace(/\D/g, '') });
        }
        if (orClauses.length > 0) {
            dbUser = await mongoDb.collection('users').findOne({ $or: orClauses });
            if (!dbUser) {
                dbUser = await mongoDb.collection('customers').findOne({ $or: orClauses });
            }
        }
    }
    const allowedCustIds = new Set();
    const allowedEmails = new Set();
    const allowedPhones = new Set();
    [authUser.userId, authUser.customerId, authUser.registrationId, dbUser?._id?.toString(), dbUser?.id, dbUser?.customerId, dbUser?.registrationId]
        .filter(Boolean)
        .forEach(v => allowedCustIds.add(String(v).toLowerCase().trim()));
    [authUser.email, dbUser?.email]
        .filter(Boolean)
        .forEach(v => allowedEmails.add(String(v).toLowerCase().trim()));
    [authUser.phone, dbUser?.phone]
        .filter(Boolean)
        .forEach(v => {
        const p = String(v).replace(/\D/g, '');
        if (p) {
            allowedPhones.add(p);
            if (p.length > 10)
                allowedPhones.add(p.slice(-10));
        }
    });
    // IDOR Protection: If non-admin attempts to target another customer's wallet
    if (requested) {
        const reqCust = String(requested.customerId || requested.userId || requested.id || '').toLowerCase().trim();
        const reqEmail = String(requested.email || '').toLowerCase().trim();
        const rawReqPhone = String(requested.phone || '').replace(/\D/g, '');
        const reqPhone = rawReqPhone.length > 10 ? rawReqPhone.slice(-10) : rawReqPhone;
        if (reqCust && allowedCustIds.size > 0 && !allowedCustIds.has(reqCust)) {
            return { target: null, isOwner: false };
        }
        if (reqEmail && allowedEmails.size > 0 && !allowedEmails.has(reqEmail)) {
            return { target: null, isOwner: false };
        }
        if (reqPhone && allowedPhones.size > 0 && !allowedPhones.has(reqPhone)) {
            return { target: null, isOwner: false };
        }
    }
    // Non-admins strictly resolve to their authenticated identity
    return {
        target: {
            userId: dbUser?.id || dbUser?._id?.toString() || authUser.userId,
            customerId: dbUser?.customerId || authUser.customerId || authUser.registrationId || requested?.customerId,
            email: dbUser?.email || authUser.email,
            phone: dbUser?.phone || authUser.phone
        },
        isOwner: true
    };
}
const buildUserLookupFilter = (target) => {
    if (!target)
        return { _id: null };
    if (typeof target === 'string') {
        const clean = target.trim();
        const orClauses = [
            { id: clean },
            { customerId: clean },
            { registrationId: clean },
            { email: clean.toLowerCase() },
            { phone: clean.replace(/\D/g, '') }
        ];
        if (mongodb_1.ObjectId.isValid(clean)) {
            orClauses.push({ _id: new mongodb_1.ObjectId(clean) });
        }
        return { $or: orClauses };
    }
    const orClauses = [];
    const custId = (target.customerId || '').toString().trim();
    const uId = (target.userId || target.id || target._id || '').toString().trim();
    const emailStr = (target.email || '').toLowerCase().trim();
    const phoneStr = (target.phone || '').replace(/\D/g, '');
    if (custId) {
        orClauses.push({ customerId: custId });
        orClauses.push({ id: custId });
        orClauses.push({ registrationId: custId });
    }
    if (uId && uId !== custId) {
        orClauses.push({ id: uId });
        orClauses.push({ customerId: uId });
        if (typeof uId === 'string' && mongodb_1.ObjectId.isValid(uId)) {
            orClauses.push({ _id: new mongodb_1.ObjectId(uId) });
        }
    }
    if (emailStr)
        orClauses.push({ email: emailStr });
    if (phoneStr && phoneStr.length >= 10)
        orClauses.push({ phone: phoneStr });
    return orClauses.length > 0 ? { $or: orClauses } : { _id: null };
};
// 1. GET: /api/wallet/balance (Authoritative real-time wallet balance from DB)
router.get('/balance', middleware_1.optionalAuthenticateToken, async (req, res) => {
    try {
        const { userId, customerId, email, phone } = req.query;
        const { target, isOwner } = await resolveWalletTarget(req, { userId, customerId, email, phone });
        if (!isOwner || !target) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_IDOR', error: 'Access denied: You cannot view another customer\'s wallet.' });
        }
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        const filter = buildUserLookupFilter(target);
        let dbUser = await mongoDb.collection('users').findOne(filter);
        if (!dbUser) {
            dbUser = await mongoDb.collection('customers').findOne(filter);
        }
        // Default to 0.00 for new users with no wallet activity, never use hardcoded 5000
        const currentBalance = typeof dbUser?.walletBalance === 'number' ? Math.max(0, dbUser.walletBalance) : 0.00;
        return res.json({
            success: true,
            walletBalance: currentBalance,
            userId: dbUser?.id || dbUser?._id?.toString() || target.userId,
            customerId: dbUser?.customerId || target.customerId
        });
    }
    catch (err) {
        console.error('Error fetching wallet balance:', err);
        res.status(500).json({ success: false, error: err.message || 'Server error fetching wallet balance' });
    }
});
// 2. GET: /api/wallet/transactions (Audit ledger history from DB - STRICTLY CUSTOMER SPECIFIC)
router.get('/transactions', middleware_1.optionalAuthenticateToken, async (req, res) => {
    try {
        const { userId, customerId, email, phone, limit = 50 } = req.query;
        const { target, isOwner } = await resolveWalletTarget(req, { userId, customerId, email, phone });
        if (!isOwner || !target) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_IDOR', error: 'Access denied: You cannot view another customer\'s wallet transactions.' });
        }
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        const filter = buildUserLookupFilter(target);
        let dbUser = await mongoDb.collection('users').findOne(filter);
        if (!dbUser) {
            dbUser = await mongoDb.collection('customers').findOne(filter);
        }
        const targetCustId = (target.customerId || dbUser?.customerId || '').toString().trim();
        const targetUserId = (target.userId || dbUser?.id || dbUser?._id?.toString() || '').toString().trim();
        const userEmail = (target.email || dbUser?.email || '').toString().toLowerCase().trim();
        const userPhone = (target.phone || dbUser?.phone || '').toString().replace(/\D/g, '');
        const queryOr = [];
        if (targetCustId) {
            queryOr.push({ customerId: targetCustId });
        }
        if (targetUserId) {
            queryOr.push({ userId: targetUserId });
        }
        if (userEmail) {
            queryOr.push({ userEmail });
        }
        if (userPhone && userPhone.length >= 10) {
            queryOr.push({ userPhone });
        }
        // STRICT CHECK: If no valid customer query clause can be built, return empty array immediately
        if (queryOr.length === 0) {
            return res.json({
                success: true,
                count: 0,
                transactions: []
            });
        }
        const query = { $or: queryOr };
        const maxItems = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const transactions = await mongoDb
            .collection('wallet_transactions')
            .find(query)
            .sort({ createdAt: -1 })
            .limit(maxItems)
            .toArray();
        return res.json({
            success: true,
            count: transactions.length,
            transactions: transactions.map(t => ({
                id: t.transactionId || t._id?.toString(),
                description: t.description || (t.type === 'CREDIT' ? 'Added funds to wallet via Razorpay' : 'Product Purchase Payment'),
                amount: t.type === 'CREDIT' ? Math.abs(t.amount) : -Math.abs(t.amount),
                type: t.type,
                purpose: t.purpose,
                category: t.purpose === 'WALLET_RECHARGE' ? 'Deposit' : 'Order Payment',
                status: t.status || 'SUCCESS',
                date: t.date || (t.createdAt ? t.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                createdAt: t.createdAt,
                paymentId: t.paymentId,
                orderId: t.orderId
            }))
        });
    }
    catch (err) {
        console.error('Error fetching wallet transactions:', err);
        res.status(500).json({ success: false, error: err.message || 'Server error fetching wallet transactions' });
    }
});
// 3. POST: /api/wallet/recharge/create-order (Create Razorpay order with paymentRateLimiter)
router.post('/recharge/create-order', middleware_1.optionalAuthenticateToken, middleware_1.paymentRateLimiter, async (req, res) => {
    try {
        const { amount, userId, customerId, email, phone } = req.body;
        const { target, isOwner } = await resolveWalletTarget(req, { userId, customerId, email, phone });
        if (!isOwner || !target) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_IDOR', error: 'Access denied: You cannot recharge another customer\'s wallet.' });
        }
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid deposit amount. Amount must be a positive number greater than 0.'
            });
        }
        // Limit single recharge to maximum 5,00,000 for standard Indian banking safety
        if (numAmount > 500000) {
            return res.status(400).json({
                success: false,
                error: 'Deposit amount exceeds single transaction limit of ₹5,00,000.'
            });
        }
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        const filter = buildUserLookupFilter({ userId, customerId, email, phone });
        let dbUser = await mongoDb.collection('users').findOne(filter);
        if (!dbUser) {
            dbUser = await mongoDb.collection('customers').findOne(filter);
        }
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        const amountInPaise = Math.round(numAmount * 100);
        const receiptId = `rcpt_wal_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        const orderOptions = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: receiptId,
            notes: {
                purpose: 'WALLET_RECHARGE',
                userId: (dbUser?.id || dbUser?._id?.toString() || userId || '').toString(),
                customerId: (dbUser?.customerId || customerId || '').toString(),
                rechargeAmountRupees: numAmount.toString()
            }
        };
        let razorpayOrderId = '';
        let isTestMode = false;
        if (!keyId || !keySecret) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[Razorpay Warning]: Gateway keys not set in dev, generating simulated dev order');
                isTestMode = true;
                razorpayOrderId = `order_test_wal_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
            }
            else {
                console.error('[Razorpay Error]: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET environment variable is missing.');
                return res.status(503).json({
                    success: false,
                    code: 'PAYMENT_CONFIG_MISSING',
                    error: 'Razorpay payment gateway credentials are not configured on this server.'
                });
            }
        }
        else {
            const razorpay = new razorpay_1.default({
                key_id: keyId,
                key_secret: keySecret
            });
            try {
                const order = await razorpay.orders.create(orderOptions);
                razorpayOrderId = order.id;
            }
            catch (sdkErr) {
                const errMsg = sdkErr?.error?.description || sdkErr?.message || 'Razorpay order creation failed';
                console.error('[Razorpay Error]: Wallet recharge order creation failed:', errMsg);
                if (process.env.NODE_ENV === 'production') {
                    return res.status(502).json({
                        success: false,
                        code: 'PAYMENT_GATEWAY_ERROR',
                        error: `Razorpay rejected recharge order: ${errMsg}`
                    });
                }
                // Non-production sandbox fallback only
                console.warn('[Razorpay Warning]: Using dev sandbox order fallback for wallet in non-production environment');
                isTestMode = true;
                razorpayOrderId = `order_test_wal_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
            }
        }
        // Save pending recharge order to guard against tampering and verify exact amount
        await mongoDb.collection('wallet_recharge_orders').insertOne({
            orderId: razorpayOrderId,
            userId: dbUser?.id || dbUser?._id?.toString() || userId,
            customerId: dbUser?.customerId || customerId,
            amountRupees: numAmount,
            amountPaise: amountInPaise,
            status: 'PENDING',
            createdAt: new Date().toISOString()
        });
        return res.json({
            success: true,
            order_id: razorpayOrderId,
            amount: amountInPaise,
            amountRupees: numAmount,
            currency: 'INR',
            key_id: keyId,
            isTestMode: isTestMode
        });
    }
    catch (err) {
        console.error('Error creating wallet recharge order:', err);
        res.status(500).json({ success: false, error: err.message || 'Server error creating recharge order' });
    }
});
// 4. POST: /api/wallet/recharge/verify (Verify signature & credit wallet atomically with paymentRateLimiter)
router.post('/recharge/verify', middleware_1.optionalAuthenticateToken, middleware_1.paymentRateLimiter, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, customerId, email, phone } = req.body;
        const { target, isOwner } = await resolveWalletTarget(req, { userId, customerId, email, phone });
        if (!isOwner || !target) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_IDOR', error: 'Access denied: You cannot verify payment for another customer\'s wallet.' });
        }
        if (!razorpay_order_id || !razorpay_payment_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required Razorpay payment verification parameters.'
            });
        }
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        // 1. REPLAY & DUPLICATE PAYMENT PROTECTION
        const existingTransaction = await mongoDb.collection('wallet_transactions').findOne({
            paymentId: razorpay_payment_id
        });
        const filter = buildUserLookupFilter({ userId, customerId, email, phone });
        let dbUser = await mongoDb.collection('users').findOne(filter);
        if (!dbUser) {
            dbUser = await mongoDb.collection('customers').findOne(filter);
        }
        if (existingTransaction) {
            const currentBal = typeof dbUser?.walletBalance === 'number' ? dbUser.walletBalance : 0.00;
            return res.json({
                success: true,
                message: 'Payment already processed and credited to wallet.',
                walletBalance: currentBal,
                alreadyProcessed: true
            });
        }
        // 2. SERVER-SIDE SIGNATURE VERIFICATION
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keySecret) {
            return res.status(503).json({
                success: false,
                error: 'Razorpay secret key is not configured.'
            });
        }
        const textToVerify = `${razorpay_order_id}|${razorpay_payment_id}`;
        const generatedSignature = crypto_1.default.createHmac('sha256', keySecret).update(textToVerify).digest('hex');
        const isSignatureValid = (generatedSignature === razorpay_signature);
        // In production, test orders are strictly prohibited
        const isTestOrder = process.env.NODE_ENV !== 'production' && (razorpay_order_id.startsWith('order_test_') ||
            razorpay_payment_id.startsWith('pay_test_') ||
            String(razorpay_signature || '').startsWith('sim_'));
        if (!isSignatureValid && !isTestOrder) {
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed: Invalid signature. Wallet cannot be credited.'
            });
        }
        // 3. RETRIEVE PENDING RECHARGE ORDER FOR EXACT SERVER-AUTHORITATIVE AMOUNT
        const pendingOrder = await mongoDb.collection('wallet_recharge_orders').findOne({ orderId: razorpay_order_id });
        if (!pendingOrder && process.env.NODE_ENV === 'production') {
            return res.status(400).json({
                success: false,
                error: 'Recharge order record not found. Verification rejected.'
            });
        }
        if (pendingOrder && pendingOrder.status === 'COMPLETED') {
            return res.status(400).json({
                success: false,
                error: 'This recharge order has already been finalized.'
            });
        }
        const verifiedCreditAmount = pendingOrder?.amountRupees || (process.env.NODE_ENV === 'production' ? 0 : (req.body?.amount ? parseFloat(req.body.amount) : 0));
        if (verifiedCreditAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid verified recharge amount.'
            });
        }
        const nowIso = new Date().toISOString();
        const prevBalance = typeof dbUser?.walletBalance === 'number' ? dbUser.walletBalance : 0.00;
        const newBalance = Math.round((prevBalance + verifiedCreditAmount) * 100) / 100;
        const transactionId = `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        // 4. ATOMIC DATABASE WALLET CREDIT
        const userDocUpdates = {
            walletBalance: newBalance,
            walletUpdatedAt: nowIso
        };
        const finalCustId = dbUser?.customerId || customerId;
        const finalUserId = dbUser?.id || dbUser?._id?.toString() || userId;
        const finalEmail = dbUser?.email || email;
        const finalPhone = dbUser?.phone || phone;
        if (finalCustId)
            userDocUpdates.customerId = finalCustId;
        if (finalUserId)
            userDocUpdates.id = finalUserId;
        if (finalEmail)
            userDocUpdates.email = finalEmail.toLowerCase().trim();
        if (finalPhone)
            userDocUpdates.phone = finalPhone.replace(/\D/g, '');
        await mongoDb.collection('users').updateOne(filter, {
            $set: userDocUpdates,
            $setOnInsert: { createdAt: nowIso, role: 'customer' }
        }, { upsert: true });
        await mongoDb.collection('customers').updateOne(filter, {
            $set: userDocUpdates
        }).catch(() => { });
        // 5. AUDIT LEDGER RECORD
        const ledgerRecord = {
            transactionId,
            customerId: dbUser?.customerId || customerId || dbUser?.id,
            userId: dbUser?.id || dbUser?._id?.toString() || userId,
            userEmail: dbUser?.email || email || '',
            userPhone: dbUser?.phone || phone || '',
            type: 'CREDIT',
            purpose: 'WALLET_RECHARGE',
            description: `Added funds to wallet via Razorpay`,
            amount: verifiedCreditAmount,
            previousBalance: prevBalance,
            newBalance: newBalance,
            paymentProvider: 'RAZORPAY',
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            status: 'SUCCESS',
            date: nowIso.split('T')[0],
            createdAt: nowIso
        };
        await mongoDb.collection('wallet_transactions').insertOne(ledgerRecord);
        // Update pending order to COMPLETED
        await mongoDb.collection('wallet_recharge_orders').updateOne({ orderId: razorpay_order_id }, { $set: { status: 'COMPLETED', paymentId: razorpay_payment_id, updatedAt: nowIso } }).catch(() => { });
        return res.json({
            success: true,
            message: `Wallet recharged successfully! ₹${verifiedCreditAmount.toLocaleString()} credited.`,
            walletBalance: newBalance,
            transaction: ledgerRecord
        });
    }
    catch (err) {
        console.error('Error verifying wallet recharge payment:', err);
        res.status(500).json({ success: false, error: err.message || 'Server error verifying recharge payment' });
    }
});
// 5. POST: /api/wallet/pay (Customer Product Payment using Wallet with paymentRateLimiter)
router.post('/pay', middleware_1.authenticateToken, (0, middleware_1.enforceRoleAndApproval)('customer', 'admin'), middleware_1.paymentRateLimiter, async (req, res) => {
    try {
        const { amount, orderId, orderDetails, userId, customerId, email, phone } = req.body || {};
        const { target, isOwner } = await resolveWalletTarget(req, { userId, customerId, email, phone });
        if (!isOwner || !target) {
            return res.status(403).json({ success: false, code: 'FORBIDDEN_IDOR', error: 'Access denied: You cannot make payments from another customer\'s wallet.' });
        }
        const payableAmount = parseFloat(amount);
        if (isNaN(payableAmount) || payableAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payment amount. Must be greater than 0.'
            });
        }
        const mongoDb = db_1.db.getDb();
        if (!mongoDb)
            return res.status(503).json({ success: false, error: 'Database unavailable' });
        const filter = buildUserLookupFilter({ userId, customerId, email, phone });
        let dbUser = await mongoDb.collection('users').findOne(filter);
        if (!dbUser) {
            dbUser = await mongoDb.collection('customers').findOne(filter);
        }
        const currentBalance = typeof dbUser?.walletBalance === 'number' ? Math.max(0, dbUser.walletBalance) : 0.00;
        // Strict validation: Balance check
        if (currentBalance < payableAmount) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient wallet balance.',
                walletBalance: currentBalance,
                requiredAmount: payableAmount
            });
        }
        const nowIso = new Date().toISOString();
        const transactionId = `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
        // ATOMIC WALLET DEDUCTION WITH CONCURRENCY GUARD:
        // Only update if walletBalance is >= payableAmount at the exact moment of execution
        const atomicFilter = {
            ...filter,
            walletBalance: { $gte: payableAmount }
        };
        const updateResult = await mongoDb.collection('users').updateOne(atomicFilter, {
            $inc: { walletBalance: -payableAmount },
            $set: { walletUpdatedAt: nowIso }
        });
        if (updateResult.matchedCount === 0 || updateResult.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient wallet balance or concurrent payment in progress.',
                walletBalance: currentBalance
            });
        }
        // Mirror to customers collection if exists
        await mongoDb.collection('customers').updateOne(filter, {
            $inc: { walletBalance: -payableAmount },
            $set: { walletUpdatedAt: nowIso }
        }).catch(() => { });
        // Compute updated balance safely
        const updatedUser = await mongoDb.collection('users').findOne(filter);
        const newBalance = Math.max(0, typeof updatedUser?.walletBalance === 'number' ? updatedUser.walletBalance : (currentBalance - payableAmount));
        // AUDIT LEDGER RECORD FOR DEBIT
        const ledgerRecord = {
            transactionId,
            customerId: dbUser?.customerId || customerId || dbUser?.id,
            userId: dbUser?.id || dbUser?._id?.toString() || userId,
            userEmail: dbUser?.email || email || '',
            userPhone: dbUser?.phone || phone || '',
            type: 'DEBIT',
            purpose: 'PRODUCT_PURCHASE',
            description: orderDetails || `Product Purchase Payment`,
            amount: payableAmount,
            previousBalance: currentBalance,
            newBalance: newBalance,
            paymentProvider: 'WALLET',
            orderId: orderId || `ORD_${Date.now()}`,
            status: 'SUCCESS',
            date: nowIso.split('T')[0],
            createdAt: nowIso
        };
        await mongoDb.collection('wallet_transactions').insertOne(ledgerRecord);
        return res.json({
            success: true,
            message: 'Payment processed successfully using Connect Wallet.',
            walletBalance: newBalance,
            transaction: ledgerRecord
        });
    }
    catch (err) {
        console.error('Error processing wallet payment:', err);
        res.status(500).json({ success: false, error: err.message || 'Server error processing wallet payment' });
    }
});
exports.default = router;
