import type { ImageAttachment } from '../../types/llm';

export interface ProcessedImageResult {
  blob: Blob;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  previewUrl: string;
}

/**
 * Client-side Canvas preprocessing for exam photos:
 * - Fixes EXIF orientation automatically via createImageBitmap
 * - Scales longest side <= maxDimension (default 2048px)
 * - Keeps full RGB color (NEVER grayscale) so red-pen vocabulary boxes stay crisp!
 */
export async function preprocessExamImage(
  file: Blob,
  options: { maxDimension?: number; quality?: number; rotateDeg?: 0 | 90 | 180 | 270 } = {},
): Promise<ProcessedImageResult> {
  const maxDim = options.maxDimension ?? 2048;
  const quality = options.quality ?? 0.86;
  const rotateDeg = options.rotateDeg ?? 0;

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

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图像 JPEG 压缩失败'))),
        'image/jpeg',
        quality,
      );
    });

    const base64 = await blobToPureBase64(blob);
    const previewUrl = URL.createObjectURL(blob);

    return {
      blob,
      base64,
      mimeType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
      previewUrl,
    };
  } finally {
    bitmap.close();
  }
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
