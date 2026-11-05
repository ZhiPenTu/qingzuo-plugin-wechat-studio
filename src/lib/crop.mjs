import { targetImageSize } from './images.mjs';

export function centerCropRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = Math.round(sourceHeight * targetRatio);
    return { x: Math.round((sourceWidth - width) / 2), y: 0, width, height: sourceHeight };
  }
  const height = Math.round(sourceWidth / targetRatio);
  return { x: 0, y: Math.round((sourceHeight - height) / 2), width: sourceWidth, height };
}

export function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round((targetWidth - width) / 2),
    y: Math.round((targetHeight - height) / 2),
    width,
    height,
  };
}

async function renderImageBytes(bytes, mime, aspect, quality, fit) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('当前环境不支持图片裁剪。');
  }
  const target = targetImageSize(aspect);
  const blob = new Blob([bytes], { type: mime || 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const rect = fit === 'contain'
    ? containRect(bitmap.width, bitmap.height, target.width, target.height)
    : centerCropRect(bitmap.width, bitmap.height, target.width, target.height);
  const canvas = new OffscreenCanvas(target.width, target.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建图片画布。');
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, target.width, target.height);
  if (fit === 'contain') {
    context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, rect.x, rect.y, rect.width, rect.height);
  } else {
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, target.width, target.height);
  }
  bitmap.close?.();
  const output = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await output.arrayBuffer());
}

export async function cropImageBytes(bytes, mime, aspect = '3:4', quality = 0.9) {
  return renderImageBytes(bytes, mime, aspect, quality, 'cover');
}

export async function fitImageBytes(bytes, mime, aspect = '3:4', quality = 0.9) {
  return renderImageBytes(bytes, mime, aspect, quality, 'contain');
}

export async function compressBodyImageBytes(bytes, mime, aspect = '3:4', maxBytes = 960 * 1024) {
  let output = null;
  for (const quality of [0.88, 0.8, 0.72, 0.64, 0.55]) {
    output = await fitImageBytes(bytes, mime, aspect, quality);
    if (output.byteLength <= maxBytes) return output;
  }
  if (!output || output.byteLength > maxBytes) throw new Error('正文图片压缩后仍超过微信 1 MB 限制。');
  return output;
}

export function base64Bytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}
