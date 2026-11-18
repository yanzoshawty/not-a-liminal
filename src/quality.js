// deviceMemory is undefined on Safari/many TVs: treat unknown as capable.
export function pickTier({ width, coarse, memory, cores }) {
  if (coarse || width < 1024 || (memory !== undefined && memory < 4) || cores < 4) return 'low'
  return 'high'
}

/** Largest DPR <= dpr that keeps w*h*dpr^2 within maxPixels (4K TVs would otherwise render 8+ MP). */
export function capDpr(w, h, dpr, maxPixels) {
  return Math.min(dpr, Math.sqrt(maxPixels / Math.max(w * h, 1)))
}
