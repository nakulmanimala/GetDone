const DEFAULT_MAX_DIMENSION = 1200
const DEFAULT_QUALITY = 0.75

export interface ClipboardItemLike {
  kind: string
  type: string
  getAsFile(): File | null
}

export function findImageFile(items: Iterable<ClipboardItemLike> | null | undefined): File | null {
  if (!items) return null
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  return null
}

// Downscales and re-encodes a pasted image before it's stored, keeping the
// localStorage-backed task list (and the S3 snapshot it syncs as) small.
// Real-browser-only (jsdom's 2D canvas context is unavailable without the
// unlisted `canvas` package), so this is verified manually, not unit tested.
export async function compressImageFile(
  file: Blob,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    context.drawImage(bitmap, 0, 0, width, height)

    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}
