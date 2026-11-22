import type { ImageAttachment } from '../../types/llm';

export const DEEPSEEK_IMAGE_LIMITS = {
  /** Single HTTP request body max size: 48 MiB */
  maxRequestBodyBytes: 48 * 1024 * 1024,
  /** Single image file size limit (base64 / external URL): 32 MiB */
  maxSingleBase64Bytes: 32 * 1024 * 1024,
  /** Total images size per request without file_id: 64 MiB */
  maxTotalBase64Bytes: 64 * 1024 * 1024,
  /** Max images per single request */
  maxImagesPerRequest: 600,
  /** Max longest side (px) when < 15 images */
  maxDimensionDefault: 8192,
  /** Max longest side (px) when >= 15 images */
  maxDimensionManyImages: 4096,
  /** Threshold count where max dimension drops to 4096px */
  manyImagesThreshold: 15,
} as const;

export interface ProcessedImageResult {
  blob: Blob;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  previewUrl: string;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function estimateBase64BinaryBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Client-side Canvas preprocessing for exam photos:
 * - Fixes EXIF orientation automatically via createImageBitmap
 * - Scales longest side <= maxDimension (default 2048px, well within DeepSeek 4096/8192px limits)
 * - Re-encodes large HEIC-converted PNGs (10-20 MB) into ~300-700 KB JPEG
 * - Keeps full RGB color (NEVER grayscale) so red-pen vocabulary boxes stay crisp!
 */
export async function preprocessExamImage(
  file: Blob,
  options: {
    maxDimension?: number;
    quality?: number;
    maxTargetBytes?: number;
    rotateDeg?: 0 | 90 | 180 | 270;
  } = {},
): Promise<ProcessedImageResult> {
  const maxDim = options.maxDimension ?? 2048;
  const initialQuality = options.quality ?? 0.86;
  const maxTargetBytes = options.maxTargetBytes ?? 4 * 1024 * 1024; // 4 MiB soft ceiling per compressed page
  const rotateDeg = options.rotateDeg ?? 0;
  const originalBytes = file.size;

  const bitmap = await createImageBitmap(file);
  try {
    let targetW = bitmap.width;
    let targetH = bitmap.height;

    const longest = Math.max(targetW, targetH);
    if (longest > maxDim) {
      const ratio = maxDim / longest;
      targetW = Math.round(targetW * ratio);
      targetH = Math.round(targetH * ratio);
    }

    const swapped = rotateDeg === 90 || rotateDeg === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swapped ? targetH : targetW;
    canvas.height = swapped ? targetW : targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D 图像处理');

    // Fill white background in case source PNG has transparency
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.drawImage(bitmap, -targetW / 2, -targetH / 2, targetW, targetH);

    const encodeJpeg = (q: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('图像 JPEG 压缩失败'))),
          'image/jpeg',
          q,
        );
      });

    let blob = await encodeJpeg(initialQuality);
    // Adaptive quality step-down if an unusually dense page still exceeds target size
    for (const fallbackQ of [0.8, 0.75, 0.72]) {
      if (blob.size <= maxTargetBytes) break;
      if (fallbackQ >= initialQuality) continue;
      blob = await encodeJpeg(fallbackQ);
    }

    const base64 = await blobToPureBase64(blob);
    const previewUrl = URL.createObjectURL(blob);

    return {
      blob,
      base64,
      mimeType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
      originalBytes,
      compressedBytes: blob.size,
      previewUrl,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Packs OCR images into batches respecting both page count (default 2 for OCR accuracy)
 * and safe Base64 request body payload budget (well under DeepSeek's 48 MiB limit).
 */
export function packOcrImageBatches(
  images: ImageAttachment[],
  maxPerBatch = 2,
  maxBatchBase64Chars = 30 * 1024 * 1024, // ~30 MiB of Base64 chars, safely under 48 MiB request body limit
): ImageAttachment[][] {
  const limitCount = Math.max(1, maxPerBatch);
  const batches: ImageAttachment[][] = [];
  let current: ImageAttachment[] = [];
  let currentChars = 0;

  for (const img of images) {
    const imgChars = img.base64.length + 128;
    if (
      current.length > 0 &&
      (current.length >= limitCount || currentChars + imgChars > maxBatchBase64Chars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(img);
    currentChars += imgChars;
  }

  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

export function blobToPureBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取图片 Base64 失败'));
    reader.readAsDataURL(blob);
  });
}

export async function blobsToAttachments(blobs: Array<{ blob: Blob; width?: number; height?: number }>): Promise<ImageAttachment[]> {
  return Promise.all(
    blobs.map(async (item) => ({
      mimeType: item.blob.type || 'image/jpeg',
      base64: await blobToPureBase64(item.blob),
      width: item.width,
      height: item.height,
    })),
  );
}
