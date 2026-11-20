import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Ensure backend .env is loaded regardless of current working directory
dotenv.config();
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Configure Cloudinary securely from backend environment variables.
 * Never hardcoded; credentials strictly sourced from process.env.
 */
function configureCloudinary() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  if (cloud_name && api_key && api_secret) {
    cloudinary.config({
      cloud_name,
      api_key,
      api_secret,
      secure: true
    });
  }
}

// Initialize configuration
configureCloudinary();

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

export interface CloudinaryUploadResult {
  success: boolean;
  url: string;
  secure_url: string;
  key?: string;
  publicId?: string;
  category?: 'image' | 'document' | 'video' | 'audio' | 'file';
  mimeType?: string;
  extension?: string;
  size?: number;
  originalName?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  resource_type?: string;
  error?: string;
  toString(): string;
  [Symbol.toPrimitive]?(hint: string): string;
}

function createResultObject(result: any, originalName = 'file'): CloudinaryUploadResult {
  const secureUrl: string = result.secure_url || result.url || '';
  const resourceType: string = result.resource_type || 'image';

  let category: 'image' | 'document' | 'video' | 'audio' | 'file' = 'file';
  if (resourceType === 'image') category = 'image';
  else if (resourceType === 'video') category = 'video';
  else if (resourceType === 'raw') category = 'document';

  const resObj: CloudinaryUploadResult = {
    success: true,
    url: secureUrl,
    secure_url: secureUrl,
    key: result.public_id,
    publicId: result.public_id,
    format: result.format,
    resource_type: resourceType,
    category,
    bytes: result.bytes,
    size: result.bytes,
    width: result.width,
    height: result.height,
    originalName,
    extension: result.format || (path.extname(originalName).replace('.', '').toLowerCase() || undefined),
    toString() {
      return secureUrl;
    },
    [Symbol.toPrimitive]() {
      return secureUrl;
    }
  };

  return resObj;
}

/**
 * Uploads an image, video, document, or audio file to Cloudinary.
 * Sourced strictly through backend environment configuration.
 *
 * Supports:
 * - Base64 Data URI strings (`data:image/jpeg;base64,...`, `data:application/pdf;base64,...`)
 * - Remote HTTPS URLs
 * - Buffers (memory uploads)
 * - Local file paths
 */
export async function uploadToCloudinary(
  fileInput: string | Buffer,
  folder = 'general',
  filenameHint?: string
): Promise<CloudinaryUploadResult> {
  // Re-verify configuration in case env was loaded late
  configureCloudinary();

  if (!isCloudinaryConfigured()) {
    const errorMsg = 'Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured in backend environment variables.';
    console.error('[Cloudinary Config Error]:', errorMsg);
    return {
      success: false,
      url: '',
      secure_url: '',
      error: errorMsg,
      toString() { return ''; }
    };
  }

  if (!fileInput) {
    return {
      success: false,
      url: '',
      secure_url: '',
      error: 'No file payload provided for Cloudinary upload.',
      toString() { return ''; }
    };
  }

  // If already an uploaded permanent Cloudinary URL, return as-is
  if (typeof fileInput === 'string') {
    const trimmed = fileInput.trim();
    if (trimmed.startsWith('https://res.cloudinary.com/') || trimmed.startsWith('http://res.cloudinary.com/')) {
      const secureUrl = trimmed.startsWith('http://') ? trimmed.replace(/^http:\/\//, 'https://') : trimmed;
      return {
        success: true,
        url: secureUrl,
        secure_url: secureUrl,
        key: secureUrl,
        publicId: secureUrl,
        category: 'image',
        toString() { return secureUrl; }
      };
    }
  }

  const safeFolder = String(folder || 'general').replace(/[^a-zA-Z0-9_\-\/]/g, '_');
  const baseName = path.basename(filenameHint || 'file').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const publicId = `${baseName}_${Date.now()}`;

  const uploadOptions: Record<string, any> = {
    folder: safeFolder,
    public_id: publicId,
    resource_type: 'auto', // Automatically handles images, videos, audio, and documents (PDF, docx, etc.)
    use_filename: true,
    unique_filename: true,
    overwrite: false
  };

  try {
    // 1. Buffer upload via upload_stream
    if (Buffer.isBuffer(fileInput)) {
      return await new Promise<CloudinaryUploadResult>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error || !result) {
            console.error('[Cloudinary Upload Stream Error]:', error);
            return resolve({
              success: false,
              url: '',
              secure_url: '',
              error: `Cloudinary upload stream failed: ${error?.message || error || 'Unknown error'}`,
              toString() { return ''; }
            });
          }
          resolve(createResultObject(result, filenameHint));
        });
        Readable.from(fileInput).pipe(uploadStream);
      });
    }

    // 2. String upload (Base64 data URI, Remote HTTPS URL, or Local File Path)
    if (typeof fileInput === 'string') {
      const trimmed = fileInput.trim();

      // Check for insecure plaintext HTTP
      if (trimmed.startsWith('http://')) {
        return {
          success: false,
          url: '',
          secure_url: '',
          error: 'Insecure plaintext HTTP file URLs are not permitted. Use HTTPS or base64 data URI.',
          toString() { return ''; }
        };
      }

      // Base64 data URI or valid local file path or HTTPS URL
      if (trimmed.startsWith('data:') || trimmed.startsWith('https://') || fs.existsSync(trimmed)) {
        const result = await cloudinary.uploader.upload(trimmed, uploadOptions);
        return createResultObject(result, filenameHint);
      }

      return {
        success: false,
        url: '',
        secure_url: '',
        error: 'Invalid file format. Cloudinary upload requires a Buffer, valid file path, HTTPS URL, or base64 data string.',
        toString() { return ''; }
      };
    }

    return {
      success: false,
      url: '',
      secure_url: '',
      error: 'Invalid file input type provided.',
      toString() { return ''; }
    };
  } catch (err: any) {
    console.error('[Cloudinary Upload Error]:', err?.message || err);
    return {
      success: false,
      url: '',
      secure_url: '',
      error: err?.message || 'Failed to upload media to Cloudinary',
      toString() { return ''; }
    };
  }
}

// Seamless alias for backwards compatibility with legacy callers
export const uploadToS3 = uploadToCloudinary;

/**
 * Checks whether an image URL is a permanent durable URL.
 */
export function isPersistentImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('blob:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.includes('/tmp/')) {
    return false;
  }
  if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
    return false;
  }
  if (lower.includes('connect-vendor')) {
    return false;
  }
  return lower.startsWith('http://') || lower.startsWith('https://');
}

/**
 * Extracts a media key or clean identifier from a URL or key.
 */
export function extractS3Key(urlOrKey: string): string | null {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;
  const trimmed = urlOrKey.trim();

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return null;
  }

  // Preserve Cloudinary URLs as-is
  if (trimmed.startsWith('https://res.cloudinary.com/') || trimmed.startsWith('http://res.cloudinary.com/')) {
    return null;
  }

  const mediaMatch = trimmed.match(/\/api\/(?:media|uploads)\/s3\/([^?#]+)/i);
  if (mediaMatch && mediaMatch[1]) {
    return decodeURIComponent(mediaMatch[1]).replace(/^\/+/, '');
  }

  if (trimmed.includes('amazonaws.com')) {
    try {
      const parsed = new URL(trimmed);
      let p = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      const parts = p.split('/');
      if (parts.length > 1 && ['products', 'customers', 'resumes', 'prescriptions', 'general'].includes(parts[1])) {
        p = parts.slice(1).join('/');
      }
      return p;
    } catch {
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

export function getDurableImageUrl(objectKey: string): string {
  if (!objectKey) return '';
  const cleanKey = objectKey.replace(/^\/+/, '');
  // If already full URL, return
  if (cleanKey.startsWith('http://') || cleanKey.startsWith('https://')) {
    return cleanKey;
  }
  const backendBase = process.env.BACKEND_URL || 'https://customer-website-2x11.onrender.com';
  return `${backendBase.replace(/\/+$/, '')}/api/media/s3/${cleanKey}`;
}

export function resolveDurableImageUrl(input: string | any): string {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return '';

  if (trimmed.includes('api.ficapp.in') || trimmed.includes('vendor.ficapp.in') || trimmed.includes('/uploads/img_')) {
    return '';
  }

  // Cloudinary permanent CDN URLs
  if (trimmed.startsWith('https://res.cloudinary.com/') || trimmed.startsWith('http://res.cloudinary.com/')) {
    return trimmed.startsWith('http://') ? trimmed.replace(/^http:\/\//, 'https://') : trimmed;
  }

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
    return trimmed;
  }

  if (trimmed.includes('/api/media/s3/') || trimmed.includes('/api/uploads/s3/')) {
    return trimmed;
  }

  const key = extractS3Key(trimmed);
  if (key) {
    return getDurableImageUrl(key);
  }

  return trimmed;
}

/**
 * Backwards compatibility helper for viewing URLs.
 * If input is a Cloudinary URL or key, returns it directly.
 */
export async function getPresignedViewUrl(key: string, _expiresIn = 3600): Promise<string> {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.startsWith('https://res.cloudinary.com/') || trimmed.startsWith('http://res.cloudinary.com/')) {
    return trimmed;
  }
  return resolveDurableImageUrl(trimmed);
}

/**
 * Resilient streaming helper for legacy media keys.
 * If a legacy S3 asset is requested via CloudFront or HTTP fallback, streams it without requiring AWS SDK.
 */
export async function getObjectStream(key: string): Promise<{
  success: boolean;
  body?: any;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  error?: string;
}> {
  try {
    const cleanKey = key.replace(/^\/+/, '');
    const cfDomain = process.env.AWS_CLOUDFRONT_URL || process.env.CLOUDFRONT_URL;
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION || 'ap-south-1';

    let fetchUrl = '';
    if (cfDomain) {
      const cfBase = cfDomain.startsWith('http') ? cfDomain : `https://${cfDomain}`;
      fetchUrl = `${cfBase.replace(/\/+$/, '')}/${cleanKey}`;
    } else if (bucket) {
      fetchUrl = `https://${bucket}.s3.${region}.amazonaws.com/${cleanKey}`;
    }

    if (!fetchUrl) {
      return {
        success: false,
        error: 'Media object not found. S3 storage has been migrated to Cloudinary CDN.'
      };
    }

    const response = await fetch(fetchUrl);
    if (!response.ok || !response.body) {
      return {
        success: false,
        error: `Failed to retrieve media (HTTP ${response.status})`
      };
    }

    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const readable = Readable.from(buffer);

    return {
      success: true,
      body: readable,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: buffer.length,
      etag: response.headers.get('etag') || undefined
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to stream media object'
    };
  }
}

export { cloudinary };
