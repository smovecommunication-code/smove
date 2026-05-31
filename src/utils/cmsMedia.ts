import type { MediaFile, MediaType } from '../domain/contentSchemas';
import { extractUploadPublicPath, resolveMediaRecordUrl } from './mediaResolver';

const IMAGE_MIME_PATTERN = /^image\//i;
const VIDEO_MIME_PATTERN = /^video\//i;
const DATA_URL_PATTERN = /^data:([^;,]+)?[;,]/i;

type UnknownRecord = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const optionalText = (value: unknown): string | undefined => {
  const normalized = text(value);
  return normalized || undefined;
};
const numberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};
const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];

export const isDataUrl = (value: unknown): value is string => typeof value === 'string' && DATA_URL_PATTERN.test(value.trim());

export const inferMimeType = (record: Partial<MediaFile> & UnknownRecord): string | undefined => {
  const explicit = optionalText(record.mimeType) || optionalText(record.contentType) || optionalText(record.mimetype);
  if (explicit) return explicit;

  const dataUrl = [record.url, record.publicUrl, record.thumbnailUrl].find(isDataUrl);
  if (typeof dataUrl === 'string') return dataUrl.trim().match(DATA_URL_PATTERN)?.[1] || undefined;

  const filename = text(record.filename || record.originalName || record.name).toLowerCase();
  if (/\.(?:avif|gif|jpe?g|png|webp|svg)$/.test(filename)) return `image/${filename.endsWith('.jpg') ? 'jpeg' : filename.split('.').pop()}`;
  if (/\.(?:mp4|mov|webm|m4v)$/.test(filename)) return `video/${filename.split('.').pop()}`;
  if (filename.endsWith('.pdf')) return 'application/pdf';
  return undefined;
};

export const inferMediaType = (record: Partial<MediaFile> & UnknownRecord): MediaType => {
  const type = text(record.type).toLowerCase();
  if (type === 'image' || type === 'video' || type === 'file' || type === 'document') return type === 'document' ? 'file' : type;
  const mimeType = inferMimeType(record) || '';
  if (IMAGE_MIME_PATTERN.test(mimeType)) return 'image';
  if (VIDEO_MIME_PATTERN.test(mimeType)) return 'video';
  return 'file';
};

export const normalizeCmsMedia = (input: unknown, options: { now?: string } = {}): MediaFile | null => {
  if (!input || typeof input !== 'object') return null;
  const record = input as Partial<MediaFile> & UnknownRecord;
  const nowIso = options.now || new Date().toISOString();

  const id = text(record.id || record._id || record.key || record.uuid);
  if (!id) return null;

  const rawUrl = text(record.url || record.publicUrl || record.src || record.href);
  const rawThumbnail = text(record.thumbnailUrl || record.thumbnail || record.thumbUrl || record.previewUrl);
  const rawFilename = text(record.filename || record.fileName || record.originalName || record.name || record.title);
  const extractedPublicPath = extractUploadPublicPath(record.publicPath || record.path || record.storagePath || rawUrl || rawThumbnail || rawFilename);
  const filenameFromPath = extractedPublicPath.split('/').filter(Boolean).pop() || '';
  const filename = (rawFilename || filenameFromPath || `${id}`).replace(/^\/?uploads\//, '');
  const originalName = text(record.originalName || record.originalFilename || record.original_file_name) || filename;
  const displayName = text(record.name || record.title || record.label || originalName || filename) || 'media-file';
  const mimeType = inferMimeType({ ...record, filename, originalName, url: rawUrl, thumbnailUrl: rawThumbnail });
  const type = inferMediaType({ ...record, mimeType, filename, originalName, url: rawUrl, thumbnailUrl: rawThumbnail });
  const hasLocalDataUrl = isDataUrl(rawUrl) || isDataUrl(rawThumbnail);
  const publicPath = text(record.publicPath || extractedPublicPath);
  const candidateForResolution = {
    ...record,
    filename: publicPath || !hasLocalDataUrl ? filename : '',
    publicPath,
    url: rawUrl,
    thumbnailUrl: rawThumbnail,
  };
  const resolvedUrl = resolveMediaRecordUrl(candidateForResolution) || (isDataUrl(rawUrl) ? rawUrl : '') || (isDataUrl(rawThumbnail) ? rawThumbnail : '');
  const resolvedThumbnail =
    resolveMediaRecordUrl({ ...candidateForResolution, url: rawThumbnail || rawUrl }) ||
    (isDataUrl(rawThumbnail) ? rawThumbnail : '') ||
    resolvedUrl;

  const metadata = record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : {};
  const size = numberOrUndefined(record.size) ?? numberOrUndefined(record.bytes) ?? 0;
  const width = numberOrUndefined(record.width ?? metadata.width);
  const height = numberOrUndefined(record.height ?? metadata.height);
  const variants = record.variants && typeof record.variants === 'object' ? record.variants : undefined;

  return {
    id,
    name: displayName,
    filename,
    originalName,
    mimeType,
    type,
    size,
    url: resolvedUrl,
    publicPath: publicPath || undefined,
    alt: text(record.alt || record.altText || record.title || displayName) || displayName,
    caption: text(record.caption || record.description) || undefined,
    title: text(record.title || displayName) || displayName,
    label: text(record.label || displayName) || displayName,
    width,
    height,
    metadata,
    source: text(record.source) || (hasLocalDataUrl ? 'local-upload' : 'cms'),
    createdAt: text(record.createdAt || record.uploadedDate) || nowIso,
    updatedAt: text(record.updatedAt) || nowIso,
    archivedAt: record.archivedAt === null ? null : optionalText(record.archivedAt),
    variants: variants as MediaFile['variants'],
    thumbnailUrl: resolvedThumbnail,
    uploadedDate: text(record.uploadedDate || record.createdAt) || nowIso,
    uploadedBy: text(record.uploadedBy) || 'cms',
    tags: stringArray(record.tags),
    ownerUserId: optionalText(record.ownerUserId),
    organizationId: optionalText(record.organizationId),
  };
};

export const normalizeCmsMediaCollection = (input: unknown): MediaFile[] =>
  (Array.isArray(input) ? input : []).map((item) => normalizeCmsMedia(item)).filter((item): item is MediaFile => Boolean(item));
