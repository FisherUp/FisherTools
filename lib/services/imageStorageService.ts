import { supabase } from "../supabaseClient";

export const IMAGE_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024; // Supabase free storage: 1GB
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_INVENTORY_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_IMAGE_BYTES = 20 * 1024 * 1024;

const INVENTORY_BUCKET = "inventory-images";
const RECEIPTS_BUCKET = "receipts";
const STORAGE_BUCKETS = [RECEIPTS_BUCKET, INVENTORY_BUCKET] as const;

export type ImageBucket = (typeof STORAGE_BUCKETS)[number];
export type StoredImageKind = "receipt" | "inventory";

export type StoredImageRecord = {
  id: string;
  orgId: string;
  bucket: ImageBucket;
  kind: StoredImageKind;
  path: string;
  label: string;
  createdAt?: string | null;
};

export type ImageBucketUsage = {
  bucket: ImageBucket;
  label: string;
  totalBytes: number;
  fileCount: number;
  referencedFileCount: number;
  unreferencedFileCount: number;
  usedListV2: boolean;
  error?: string;
};

export type ImageStorageUsage = {
  totalBytes: number;
  quotaBytes: number;
  fileCount: number;
  referencedFileCount: number;
  unreferencedFileCount: number;
  buckets: ImageBucketUsage[];
  checkedAt: string;
  errors: string[];
};

export type UploadImageResult = {
  storagePath: string;
  originalBytes: number;
  uploadedBytes: number;
  compressed: boolean;
};

export type CompressionProgress = {
  index: number;
  total: number;
  currentLabel: string;
  message: string;
};

export type CompressionBatchResult = {
  total: number;
  compressed: number;
  skipped: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  errors: string[];
};

type CompressOptions = {
  maxDimension: number;
  quality: number;
  skipBelowBytes: number;
};

type InventoryImageRow = {
  id: string;
  org_id: string;
  name: string | null;
  image_path: string | null;
  updated_at?: string | null;
};

type AttachmentImageRow = {
  id: string;
  org_id: string;
  transaction_id: string | null;
  storage_path: string | null;
  created_at?: string | null;
};

type StorageObjectInfo = {
  size?: number;
  metadata?: Record<string, unknown> | null;
};

const BUCKET_LABELS: Record<ImageBucket, string> = {
  receipts: "票据图片",
  "inventory-images": "物资图片",
};

const UPLOAD_OPTIONS: Record<StoredImageKind, CompressOptions> = {
  receipt: { maxDimension: 1600, quality: 0.76, skipBelowBytes: 350 * 1024 },
  inventory: { maxDimension: 1000, quality: 0.75, skipBelowBytes: 300 * 1024 },
};

const LEGACY_OPTIONS: Record<StoredImageKind, CompressOptions> = {
  receipt: { maxDimension: 1600, quality: 0.76, skipBelowBytes: 450 * 1024 },
  inventory: { maxDimension: 1200, quality: 0.74, skipBelowBytes: 350 * 1024 },
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function getImageUsagePercent(bytes: number, quotaBytes = IMAGE_STORAGE_QUOTA_BYTES): number {
  if (!quotaBytes) return 0;
  return Math.min(100, Math.max(0, (bytes / quotaBytes) * 100));
}

export async function compressImageFile(
  file: File,
  options: Partial<CompressOptions> = {}
): Promise<File> {
  const opts: CompressOptions = {
    maxDimension: options.maxDimension ?? 1200,
    quality: options.quality ?? 0.75,
    skipBelowBytes: options.skipBelowBytes ?? 300 * 1024,
  };

  if (!file.type.startsWith("image/")) return file;
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`原图 ${file.name} 超过 50MB，请先在本地压缩后再上传。`);
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width <= opts.maxDimension && height <= opts.maxDimension && file.size <= opts.skipBelowBytes) {
    return file;
  }

  if (width > opts.maxDimension || height > opts.maxDimension) {
    const ratio = Math.min(opts.maxDimension / width, opts.maxDimension / height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", opts.quality);
  });
  if (!blob) return file;

  if (blob.size >= file.size * 0.96) return file;

  return new File([blob], toJpegName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export async function uploadInventoryImageFile(
  orgId: string,
  itemId: string,
  file: File
): Promise<UploadImageResult> {
  const compressed = await compressImageFile(file, UPLOAD_OPTIONS.inventory);
  if (compressed.size > MAX_INVENTORY_IMAGE_BYTES) {
    throw new Error(
      `文件 ${file.name} 压缩后仍超过 10MB（${formatBytes(compressed.size)}），请手动压缩后再上传。`
    );
  }

  const safeName = safeFileName(compressed.name || file.name);
  const storagePath = `${orgId}/${itemId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from(INVENTORY_BUCKET).upload(storagePath, compressed, {
    upsert: false,
    contentType: compressed.type || file.type,
  });

  if (error) throw new Error("上传图片失败：" + error.message);
  return {
    storagePath,
    originalBytes: file.size,
    uploadedBytes: compressed.size,
    compressed: compressed.size < file.size,
  };
}

export async function uploadReceiptImageFile(
  orgId: string,
  transactionId: string,
  file: File
): Promise<UploadImageResult> {
  const compressed = await compressImageFile(file, UPLOAD_OPTIONS.receipt);
  if (compressed.size > MAX_RECEIPT_IMAGE_BYTES) {
    throw new Error(
      `文件 ${file.name} 压缩后仍超过 20MB（${formatBytes(compressed.size)}），请手动压缩后再上传。`
    );
  }

  const safeName = safeFileName(compressed.name || file.name);
  const storagePath = `${orgId}/${transactionId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(storagePath, compressed, {
    upsert: false,
    contentType: compressed.type || file.type,
  });

  if (error) throw new Error("上传票据失败：" + error.message);
  return {
    storagePath,
    originalBytes: file.size,
    uploadedBytes: compressed.size,
    compressed: compressed.size < file.size,
  };
}

export async function fetchImageRecords(orgId: string): Promise<StoredImageRecord[]> {
  const [{ data: inventoryData, error: inventoryErr }, { data: attachmentData, error: attachmentErr }] =
    await Promise.all([
      supabase
        .from("inventory_items")
        .select("id, org_id, name, image_path, updated_at")
        .eq("org_id", orgId)
        .not("image_path", "is", null),
      supabase
        .from("attachments")
        .select("id, org_id, transaction_id, storage_path, created_at")
        .eq("org_id", orgId)
        .not("storage_path", "is", null),
    ]);

  if (inventoryErr) throw new Error("读取物资图片失败：" + inventoryErr.message);
  if (attachmentErr) throw new Error("读取票据图片失败：" + attachmentErr.message);

  const inventoryRows = (inventoryData ?? []) as InventoryImageRow[];
  const attachmentRows = (attachmentData ?? []) as AttachmentImageRow[];

  const records: StoredImageRecord[] = [];
  for (const row of inventoryRows) {
    if (!row.image_path) continue;
    records.push({
      id: row.id,
      orgId: row.org_id,
      bucket: INVENTORY_BUCKET,
      kind: "inventory",
      path: row.image_path,
      label: row.name ? `物资：${row.name}` : `物资 ${row.id.slice(0, 8)}`,
      createdAt: row.updated_at,
    });
  }

  for (const row of attachmentRows) {
    if (!row.storage_path) continue;
    records.push({
      id: row.id,
      orgId: row.org_id,
      bucket: RECEIPTS_BUCKET,
      kind: "receipt",
      path: row.storage_path,
      label: row.transaction_id ? `票据：${row.transaction_id.slice(0, 8)}` : `票据 ${row.id.slice(0, 8)}`,
      createdAt: row.created_at,
    });
  }

  return records;
}

export async function getImageStorageUsage(orgId: string): Promise<ImageStorageUsage> {
  const records = await fetchImageRecords(orgId);
  const referencedByBucket = new Map<ImageBucket, Set<string>>();
  for (const bucket of STORAGE_BUCKETS) referencedByBucket.set(bucket, new Set());
  for (const record of records) referencedByBucket.get(record.bucket)?.add(record.path);

  const buckets = await Promise.all(
    STORAGE_BUCKETS.map((bucket) =>
      getBucketUsage(bucket, orgId, referencedByBucket.get(bucket) ?? new Set(), records)
    )
  );

  return {
    totalBytes: buckets.reduce((sum, b) => sum + b.totalBytes, 0),
    quotaBytes: IMAGE_STORAGE_QUOTA_BYTES,
    fileCount: buckets.reduce((sum, b) => sum + b.fileCount, 0),
    referencedFileCount: buckets.reduce((sum, b) => sum + b.referencedFileCount, 0),
    unreferencedFileCount: buckets.reduce((sum, b) => sum + b.unreferencedFileCount, 0),
    buckets,
    checkedAt: new Date().toISOString(),
    errors: buckets.flatMap((b) => (b.error ? [`${b.label}：${b.error}`] : [])),
  };
}

export async function compressReferencedImages(
  orgId: string,
  onProgress?: (progress: CompressionProgress) => void
): Promise<CompressionBatchResult> {
  const records = dedupeRecords(await fetchImageRecords(orgId));
  const result: CompressionBatchResult = {
    total: records.length,
    compressed: 0,
    skipped: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
    savedBytes: 0,
    errors: [],
  };

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    onProgress?.({
      index: i + 1,
      total: records.length,
      currentLabel: record.label,
      message: "正在处理",
    });

    try {
      const one = await compressOneStoredImage(record);
      result.beforeBytes += one.beforeBytes;
      result.afterBytes += one.afterBytes;
      if (one.status === "compressed") {
        result.compressed += 1;
        result.savedBytes += one.savedBytes;
      } else {
        result.skipped += 1;
      }
      if (one.warning) result.errors.push(`${record.label}：${one.warning}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed += 1;
      result.errors.push(`${record.label}：${message}`);
    }
  }

  return result;
}

async function getBucketUsage(
  bucket: ImageBucket,
  orgId: string,
  referencedPaths: Set<string>,
  records: StoredImageRecord[]
): Promise<ImageBucketUsage> {
  try {
    const objects = await listBucketObjects(bucket, orgId);
    return {
      bucket,
      label: BUCKET_LABELS[bucket],
      totalBytes: objects.reduce((sum, obj) => sum + obj.size, 0),
      fileCount: objects.length,
      referencedFileCount: objects.filter((obj) => referencedPaths.has(obj.path)).length,
      unreferencedFileCount: objects.filter((obj) => !referencedPaths.has(obj.path)).length,
      usedListV2: true,
    };
  } catch (e: unknown) {
    const fallback = await getBucketUsageFromReferences(bucket, records);
    const message = e instanceof Error ? e.message : String(e);
    return {
      ...fallback,
      error: `Storage 列表不可用，已按数据库引用估算：${message}`,
    };
  }
}

async function listBucketObjects(bucket: ImageBucket, orgId: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  let cursor: string | undefined;

  do {
    const { data, error } = await supabase.storage.from(bucket).listV2({
      prefix: `${orgId}/`,
      limit: 1000,
      cursor,
      with_delimiter: false,
    });
    if (error) throw new Error(error.message);

    for (const object of data?.objects ?? []) {
      const path = normalizeStorageObjectPath(bucket, orgId, String(object.key || object.name || ""));
      if (!path) continue;
      let size = extractSize({ metadata: object.metadata });
      if (!size) {
        const info = await getObjectInfo(bucket, path);
        size = info.size;
      }
      out.push({ path, size });
    }

    cursor = data?.hasNext ? data.nextCursor : undefined;
  } while (cursor);

  return out;
}

async function getBucketUsageFromReferences(
  bucket: ImageBucket,
  records: StoredImageRecord[]
): Promise<ImageBucketUsage> {
  const bucketRecords = dedupeRecords(records.filter((record) => record.bucket === bucket));
  let totalBytes = 0;
  for (const record of bucketRecords) {
    try {
      totalBytes += (await getObjectInfo(record.bucket, record.path)).size;
    } catch {
      // 单个文件不可读时忽略，错误会在具体压缩或打开时暴露。
    }
  }

  return {
    bucket,
    label: BUCKET_LABELS[bucket],
    totalBytes,
    fileCount: bucketRecords.length,
    referencedFileCount: bucketRecords.length,
    unreferencedFileCount: 0,
    usedListV2: false,
  };
}

async function compressOneStoredImage(record: StoredImageRecord): Promise<{
  status: "compressed" | "skipped";
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  warning?: string;
}> {
  const beforeInfo = await getObjectInfo(record.bucket, record.path);
  if (beforeInfo.size > 0 && beforeInfo.size <= LEGACY_OPTIONS[record.kind].skipBelowBytes) {
    return { status: "skipped", beforeBytes: beforeInfo.size, afterBytes: beforeInfo.size, savedBytes: 0 };
  }

  const { data: blob, error } = await supabase.storage.from(record.bucket).download(record.path);
  if (error || !blob) throw new Error(error?.message ?? "下载原图失败");
  if (!isImageFile(record.path, blob.type)) {
    return { status: "skipped", beforeBytes: beforeInfo.size, afterBytes: beforeInfo.size, savedBytes: 0 };
  }

  const source = new File([blob], fileNameFromPath(record.path), {
    type: blob.type || guessImageType(record.path),
    lastModified: Date.now(),
  });
  const compressed = await compressImageFile(source, LEGACY_OPTIONS[record.kind]);
  if (compressed.size >= source.size * 0.96) {
    return { status: "skipped", beforeBytes: beforeInfo.size || source.size, afterBytes: beforeInfo.size || source.size, savedBytes: 0 };
  }

  const newPath = compressedPathFor(record.path);
  const { error: uploadErr } = await supabase.storage.from(record.bucket).upload(newPath, compressed, {
    upsert: false,
    contentType: compressed.type,
  });
  if (uploadErr) throw new Error("上传压缩图失败：" + uploadErr.message);

  try {
    await updateRecordPath(record, newPath);
  } catch (e) {
    await supabase.storage.from(record.bucket).remove([newPath]);
    throw e;
  }

  const { error: removeErr } = await supabase.storage.from(record.bucket).remove([record.path]);
  const warning = removeErr ? `压缩图已生效，但旧图删除失败：${removeErr.message}` : undefined;
  const beforeBytes = beforeInfo.size || source.size;
  const afterBytes = warning ? beforeBytes + compressed.size : compressed.size;
  return {
    status: "compressed",
    beforeBytes,
    afterBytes,
    savedBytes: Math.max(0, beforeBytes - afterBytes),
    warning,
  };
}

async function updateRecordPath(record: StoredImageRecord, newPath: string): Promise<void> {
  if (record.kind === "inventory") {
    const { error } = await supabase
      .from("inventory_items")
      .update({ image_path: newPath })
      .eq("id", record.id)
      .eq("org_id", record.orgId);
    if (error) throw new Error("更新物资图片路径失败：" + error.message);
    return;
  }

  const { error } = await supabase
    .from("attachments")
    .update({ storage_path: newPath, file_url: newPath })
    .eq("id", record.id)
    .eq("org_id", record.orgId);
  if (error) throw new Error("更新票据图片路径失败：" + error.message);
}

async function getObjectInfo(bucket: ImageBucket, path: string): Promise<{ size: number }> {
  const { data, error } = await supabase.storage.from(bucket).info(path);
  if (error || !data) throw new Error(error?.message ?? "读取文件信息失败");
  return { size: extractSize(data as StorageObjectInfo) };
}

function extractSize(info: StorageObjectInfo): number {
  if (typeof info.size === "number") return info.size;
  const meta = info.metadata;
  if (!meta) return 0;
  const keys = ["size", "contentLength", "content_length", "Content-Length"];
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读取图片失败，可能是不受浏览器支持的图片格式。"));
    };
    img.src = url;
  });
}

function normalizeStorageObjectPath(bucket: ImageBucket, orgId: string, rawPath: string): string {
  let path = rawPath;
  if (path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
  if (!path.startsWith(`${orgId}/`)) return "";
  return path;
}

function compressedPathFor(path: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const stem = name.replace(/\.[^.]+$/, "") || "image";
  return `${dir}${safeFileName(stem)}_compressed_${Date.now()}.jpg`;
}

function dedupeRecords(records: StoredImageRecord[]): StoredImageRecord[] {
  const map = new Map<string, StoredImageRecord>();
  for (const record of records) map.set(`${record.bucket}:${record.path}`, record);
  return Array.from(map.values());
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

function toJpegName(name: string): string {
  return safeFileName((name || "image").replace(/\.[^.]+$/, ".jpg"));
}

function fileNameFromPath(path: string): string {
  const name = path.split("/").pop() || "image.jpg";
  return safeFileName(name);
}

function isImageFile(path: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(path);
}

function guessImageType(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  return "image/jpeg";
}
