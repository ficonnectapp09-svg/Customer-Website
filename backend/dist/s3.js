"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToCloudinary = exports.EXTENSION_TO_MIME = exports.ALLOWED_MIME_MAP = void 0;
exports.getS3Client = getS3Client;
exports.detectMagicBytes = detectMagicBytes;
exports.extractS3Key = extractS3Key;
exports.getDurableImageUrl = getDurableImageUrl;
exports.resolveDurableImageUrl = resolveDurableImageUrl;
exports.getPresignedViewUrl = getPresignedViewUrl;
exports.getObjectStream = getObjectStream;
exports.uploadToS3 = uploadToS3;
exports.isPersistentImageUrl = isPersistentImageUrl;
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
// Ensure backend .env is loaded regardless of current working directory
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../.env') });
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
const AWS_REGION = process.env.AWS_REGION || '';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || '';
if (!AWS_REGION || !AWS_S3_BUCKET) {
    console.warn('[AWS S3] WARNING: AWS_REGION or AWS_S3_BUCKET environment variable is not set. S3 uploads will fail until configured.');
}
let s3ClientInstance = null;
function getS3Client() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;
    if (!region || !bucket) {
        throw new Error('[AWS S3] AWS_REGION and AWS_S3_BUCKET must be configured in environment variables.');
    }
    if (!s3ClientInstance) {
        s3ClientInstance = new client_s3_1.S3Client({ region });
    }
    return s3ClientInstance;
}
const presignedUrlCache = new Map();
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of presignedUrlCache.entries()) {
        if (entry.expiresAt <= now) {
            presignedUrlCache.delete(k);
        }
    }
}, 10 * 60 * 1000);
if (typeof cleanupInterval?.unref === 'function') {
    cleanupInterval.unref();
}
// Comprehensive MIME allowlist supporting Images, Documents, and Audio
exports.ALLOWED_MIME_MAP = {
    // Images (Max 15MB)
    'image/jpeg': { ext: 'jpg', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/jpg': { ext: 'jpg', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/png': { ext: 'png', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/webp': { ext: 'webp', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/gif': { ext: 'gif', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/avif': { ext: 'avif', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
    'image/svg+xml': { ext: 'svg', category: 'image', maxSizeBytes: 5 * 1024 * 1024 },
    // Documents (Max 25MB)
    'application/pdf': { ext: 'pdf', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
    'application/msword': { ext: 'doc', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
    'application/vnd.ms-excel': { ext: 'xls', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
    'text/csv': { ext: 'csv', category: 'document', maxSizeBytes: 10 * 1024 * 1024 },
    'text/plain': { ext: 'txt', category: 'document', maxSizeBytes: 10 * 1024 * 1024 },
    // Audio (Max 20MB)
    'audio/webm': { ext: 'webm', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'video/webm': { ext: 'webm', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/mpeg': { ext: 'mp3', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/mp3': { ext: 'mp3', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/wav': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/x-wav': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/wave': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/m4a': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/x-m4a': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/mp4': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/ogg': { ext: 'ogg', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'application/ogg': { ext: 'ogg', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
    'audio/aac': { ext: 'aac', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 }
};
exports.EXTENSION_TO_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/m4a',
    ogg: 'audio/ogg',
    aac: 'audio/aac'
};
/**
 * Validates magic bytes of binary buffer to verify true content type.
 */
function detectMagicBytes(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4)
        return null;
    // JPEG
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
        return 'image/jpeg';
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
        return 'image/png';
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38)
        return 'image/gif';
    // PDF
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
        return 'application/pdf';
    // WebM (EBML)
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3)
        return 'audio/webm';
    // MP3 ID3
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33)
        return 'audio/mpeg';
    // RIFF (WAV or WEBP)
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12) {
        const sub = buf.toString('ascii', 8, 12);
        if (sub === 'WEBP')
            return 'image/webp';
        if (sub === 'WAVE')
            return 'audio/wav';
    }
    // OGG
    if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53)
        return 'audio/ogg';
    // Office OpenXML / ZIP
    if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04)
        return 'application/zip';
    return null;
}
/**
 * Extracts a clean S3 object key from a key or URL.
 */
function extractS3Key(urlOrKey) {
    if (!urlOrKey || typeof urlOrKey !== 'string')
        return null;
    const trimmed = urlOrKey.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('https://res.cloudinary.com/')) {
        return null;
    }
    const mediaMatch = trimmed.match(/\/api\/(?:media|uploads)\/s3\/([^?#]+)/i);
    if (mediaMatch && mediaMatch[1]) {
        return decodeURIComponent(mediaMatch[1]).replace(/^\/+/, '');
    }
    const cfDomain = (process.env.AWS_CLOUDFRONT_URL || process.env.CLOUDFRONT_URL || '').replace(/https?:\/\//i, '').replace(/\/+$/, '');
    if (cfDomain && trimmed.includes(cfDomain)) {
        try {
            const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
            return decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
        }
        catch {
            // Fallback
        }
    }
    if (trimmed.includes('amazonaws.com')) {
        try {
            const parsed = new URL(trimmed);
            let p = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
            const parts = p.split('/');
            if (parts.length > 1 && ['products', 'vendor_uploads', 'admin_uploads', 'subadmin_docs', 'connect_uploads', 'voice_notes', 'kyc', 'documents', 'banners', 'categories', 'general', 'profiles', 'thumbnails', 'field_visits', 'tasks'].includes(parts[1])) {
                p = parts.slice(1).join('/');
            }
            return p;
        }
        catch {
            const match = trimmed.match(/amazonaws\.com\/([^?#]+)/);
            if (match && match[1]) {
                return decodeURIComponent(match[1]).replace(/^\/+/, '');
            }
        }
    }
    if (/^[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp|gif|avif|svg|pdf|doc|docx|xls|xlsx|csv|txt|webm|mp3|wav|m4a|ogg|aac)$/i.test(trimmed)) {
        return trimmed;
    }
    return null;
}
function getDurableImageUrl(objectKey) {
    if (!objectKey)
        return '';
    const cleanKey = objectKey.replace(/^\/+/, '');
    const cloudfrontDomain = process.env.AWS_CLOUDFRONT_URL || process.env.CLOUDFRONT_URL;
    if (cloudfrontDomain) {
        const cfBase = cloudfrontDomain.startsWith('http') ? cloudfrontDomain : `https://${cloudfrontDomain}`;
        return `${cfBase.replace(/\/+$/, '')}/${cleanKey}`;
    }
    const backendBase = process.env.BACKEND_URL || 'https://connect-app-ukpk.onrender.com';
    return `${backendBase.replace(/\/+$/, '')}/api/media/s3/${cleanKey}`;
}
function resolveDurableImageUrl(input) {
    if (!input || typeof input !== 'string')
        return '';
    const trimmed = input.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined')
        return '';
    if (trimmed.includes('api.ficapp.in') || trimmed.includes('vendor.ficapp.in') || trimmed.includes('/uploads/img_')) {
        return '';
    }
    if (trimmed.startsWith('https://res.cloudinary.com/')) {
        return trimmed;
    }
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return trimmed;
    }
    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
        return trimmed;
    }
    if (trimmed.includes('/api/media/s3/') || trimmed.includes('/api/uploads/s3/')) {
        return trimmed;
    }
    const cfDomain = (process.env.AWS_CLOUDFRONT_URL || process.env.CLOUDFRONT_URL || '').replace(/https?:\/\//i, '').replace(/\/+$/, '');
    if (cfDomain && trimmed.includes(cfDomain)) {
        return trimmed;
    }
    const key = extractS3Key(trimmed);
    if (key) {
        return getDurableImageUrl(key);
    }
    return trimmed;
}
async function getPresignedViewUrl(key, expiresIn = 3600) {
    if (!key || typeof key !== 'string')
        return '';
    const cleanKey = extractS3Key(key) || key.replace(/^\/+/, '');
    const cacheKey = `${cleanKey}:${expiresIn}`;
    const cached = presignedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
        return cached.url;
    }
    const bucket = process.env.AWS_S3_BUCKET;
    const client = getS3Client();
    const command = new client_s3_1.GetObjectCommand({
        Bucket: bucket,
        Key: cleanKey
    });
    const signedUrl = await (0, s3_request_presigner_1.getSignedUrl)(client, command, { expiresIn });
    presignedUrlCache.set(cacheKey, {
        url: signedUrl,
        expiresAt: Date.now() + (expiresIn - 60) * 1000
    });
    return signedUrl;
}
async function getObjectStream(key) {
    try {
        const bucket = process.env.AWS_S3_BUCKET;
        const client = getS3Client();
        const cleanKey = key.replace(/^\/+/, '');
        const command = new client_s3_1.GetObjectCommand({
            Bucket: bucket,
            Key: cleanKey
        });
        const response = await client.send(command);
        return {
            success: true,
            body: response.Body,
            contentType: response.ContentType || 'application/octet-stream',
            contentLength: response.ContentLength,
            etag: response.ETag
        };
    }
    catch (err) {
        return {
            success: false,
            error: err.name === 'NoSuchKey' ? 'Object not found in S3 bucket' : (err.message || 'Failed to fetch object from S3')
        };
    }
}
/**
 * Uploads Images, Documents, Files, or Audio (Buffer or base64 URI or remote URL) to AWS S3.
 * Returns a permanent, durable viewing URL, clean S3 object key, and file metadata.
 */
async function uploadToS3(fileInput, folder = 'general', filenameHint) {
    try {
        let fileBuffer;
        let mimeType = 'application/octet-stream';
        let extension = 'bin';
        let originalName = filenameHint || 'file';
        if (Buffer.isBuffer(fileInput)) {
            fileBuffer = fileInput;
            if (filenameHint) {
                const ext = path_1.default.extname(filenameHint).replace('.', '').toLowerCase();
                if (ext && exports.EXTENSION_TO_MIME[ext]) {
                    extension = ext;
                    mimeType = exports.EXTENSION_TO_MIME[ext];
                }
            }
            // Content magic bytes inspection
            const magicMime = detectMagicBytes(fileBuffer);
            if (magicMime && exports.ALLOWED_MIME_MAP[magicMime]) {
                mimeType = magicMime;
                extension = exports.ALLOWED_MIME_MAP[magicMime].ext;
            }
        }
        else if (typeof fileInput === 'string') {
            const trimmed = fileInput.trim();
            if (trimmed.startsWith('https://res.cloudinary.com/')) {
                return { success: true, url: trimmed, secure_url: trimmed, key: trimmed, publicId: trimmed };
            }
            if (trimmed.includes('/api/media/s3/') || trimmed.includes('/api/uploads/s3/')) {
                const key = extractS3Key(trimmed) || trimmed;
                return { success: true, url: trimmed, secure_url: trimmed, key, publicId: key };
            }
            if (trimmed.includes('amazonaws.com')) {
                const existingKey = extractS3Key(trimmed);
                if (existingKey) {
                    const durableUrl = getDurableImageUrl(existingKey);
                    return { success: true, url: durableUrl, secure_url: durableUrl, key: existingKey, publicId: existingKey };
                }
            }
            if (trimmed.startsWith('data:')) {
                const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
                if (!match) {
                    return { success: false, url: '', secure_url: '', error: 'Malformed base64 data URI.' };
                }
                mimeType = match[1].toLowerCase().trim();
                const conf = exports.ALLOWED_MIME_MAP[mimeType];
                if (!conf) {
                    return { success: false, url: '', secure_url: '', error: `MIME type '${mimeType}' is not permitted. Only verified image, document, and audio formats are accepted.` };
                }
                extension = conf.ext;
                fileBuffer = Buffer.from(match[2], 'base64');
            }
            else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                if (trimmed.startsWith('http://')) {
                    return { success: false, url: '', secure_url: '', error: 'Insecure plaintext HTTP file URLs are not permitted. Use HTTPS.' };
                }
                const parsed = new URL(trimmed);
                const host = parsed.hostname.toLowerCase();
                if (host === 'localhost' ||
                    host === '127.0.0.1' ||
                    host === '0.0.0.0' ||
                    host.startsWith('192.168.') ||
                    host.startsWith('10.') ||
                    host.startsWith('172.16.') ||
                    host.startsWith('169.254.')) {
                    return { success: false, url: '', secure_url: '', error: 'Requests to internal network addresses are restricted.' };
                }
                const res = await fetch(trimmed);
                if (!res.ok) {
                    return { success: false, url: '', secure_url: '', error: 'Failed to download remote file: ' + res.statusText };
                }
                const arrayBuf = await res.arrayBuffer();
                fileBuffer = Buffer.from(arrayBuf);
                const ct = res.headers.get('content-type');
                if (ct) {
                    mimeType = ct.split(';')[0].trim().toLowerCase();
                    if (exports.ALLOWED_MIME_MAP[mimeType]) {
                        extension = exports.ALLOWED_MIME_MAP[mimeType].ext;
                    }
                }
            }
            else {
                return { success: false, url: '', secure_url: '', error: 'Invalid file format: must be an HTTPS URL or base64 data URI.' };
            }
        }
        else {
            return { success: false, url: '', secure_url: '', error: 'Invalid file input type.' };
        }
        // Verify MIME configuration and size limits
        const mimeConfig = exports.ALLOWED_MIME_MAP[mimeType] || { category: 'file', maxSizeBytes: 15 * 1024 * 1024, ext: extension };
        if (!exports.ALLOWED_MIME_MAP[mimeType]) {
            return {
                success: false,
                url: '',
                secure_url: '',
                error: `File format '${mimeType}' is not supported. Supported categories: Images (JPG, PNG, WebP, GIF), Documents (PDF, DOCX, XLSX, CSV), Audio (WebM, MP3, WAV, M4A).`
            };
        }
        if (fileBuffer.length > mimeConfig.maxSizeBytes) {
            const maxMb = Math.round(mimeConfig.maxSizeBytes / (1024 * 1024));
            return {
                success: false,
                url: '',
                secure_url: '',
                error: `Payload size (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum permissible limit of ${maxMb} MB for ${mimeConfig.category}s.`
            };
        }
        const bucket = process.env.AWS_S3_BUCKET;
        const client = getS3Client();
        const safeFolder = /^[a-zA-Z0-9_-]{1,50}$/.test(folder) ? folder : 'general';
        const randSuffix = crypto_1.default.randomBytes(8).toString('hex');
        const objectKey = `${safeFolder}/${Date.now()}-${randSuffix}.${extension}`;
        const putCommand = new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: fileBuffer,
            ContentType: mimeType,
            Metadata: {
                'original-name': encodeURIComponent(path_1.default.basename(originalName)),
                category: mimeConfig.category
            }
        });
        await client.send(putCommand);
        const durableUrl = getDurableImageUrl(objectKey);
        return {
            success: true,
            url: durableUrl,
            secure_url: durableUrl,
            key: objectKey,
            publicId: objectKey,
            category: mimeConfig.category,
            mimeType,
            extension,
            size: fileBuffer.length,
            originalName
        };
    }
    catch (err) {
        console.error('[AWS S3 Upload Error]:', err.message);
        return {
            success: false,
            url: '',
            secure_url: '',
            error: err.message || 'Failed to upload file to AWS S3'
        };
    }
}
exports.uploadToCloudinary = uploadToS3;
function isPersistentImageUrl(url) {
    if (!url || typeof url !== 'string')
        return false;
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('blob:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.includes('/tmp/')) {
        return false;
    }
    if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
        return false;
    }
    if (lower.includes('connect-vendor.onrender.com/uploads/')) {
        return false;
    }
    return lower.startsWith('http://') || lower.startsWith('https://');
}
