import path from 'path';
import { Readable } from 'stream';
import {
  uploadToCloudinary,
  CloudinaryUploadResult,
  isCloudinaryConfigured,
  extractS3Key as extractMediaKey,
  getDurableImageUrl as getDurableUrl,
  resolveDurableImageUrl as resolveDurableUrl,
  isPersistentImageUrl as isPersistentUrl
} from './cloudinary';

// Comprehensive MIME allowlist supporting Images, Documents, and Audio
export const ALLOWED_MIME_MAP: Record<string, { ext: string; category: 'image' | 'document' | 'audio'; maxSizeBytes: number }> = {
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

export const EXTENSION_TO_MIME: Record<string, string> = {
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

export type S3UploadResult = CloudinaryUploadResult;

/**
 * Uploads media using the primary storage provider (Cloudinary).
 * AWS S3 has been replaced by Cloudinary; this wrapper preserves 100% backward compatibility
 * for legacy callers without requiring AWS credentials or generating S3 warnings.
 */
export async function uploadToS3(
  fileInput: string | Buffer,
  folder = 'general',
  filenameHint?: string
): Promise<CloudinaryUploadResult> {
  return await uploadToCloudinary(fileInput, folder, filenameHint);
}

export { uploadToCloudinary };
export const extractS3Key = extractMediaKey;
export const getDurableImageUrl = getDurableUrl;
export const resolveDurableImageUrl = resolveDurableUrl;
export const isPersistentImageUrl = isPersistentUrl;

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
