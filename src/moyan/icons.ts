import { paintPixelArt, pixelArtMetrics, type PixelArtKey } from '../scene/PixelArt'

const cache = new Map<PixelArtKey, string>()

export function iconUrl(key: PixelArtKey): string {
  const cached = cache.get(key)
  if (cached) return cached
  const metrics = pixelArtMetrics(key)
  const canvas = document.createElement('canvas')
  canvas.width = metrics.width
  canvas.height = metrics.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  paintPixelArt(ctx, key, 0, 0, 1)
  const url = canvas.toDataURL('image/png')
  cache.set(key, url)
  return url
}