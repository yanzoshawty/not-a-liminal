import { gsap } from 'gsap'

export const ROOM_GAP = 60 // metres between room origins (rooms are ~32 m long, the rest is dark gap)
export const ROOM_COUNT = 4

/** keys: sorted [scrollY, x, y, z]; returns the camera position at scroll y (clamped at the ends). */
export function lerpKeys(keys, y) {
  if (y <= keys[0][0]) return keys[0].slice(1)
  const last = keys[keys.length - 1]
  if (y >= last[0]) return last.slice(1)
  let i = 1
  while (keys[i][0] < y) i++
  const a = keys[i - 1], b = keys[i]
  const t = (y - a[0]) / (b[0] - a[0] || 1)
  return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * t)
}

const clampRoom = gsap.utils.clamp(0, ROOM_COUNT - 1)
/** Room index for a camera z; switches halfway through the gap after each room. */
export const roomAt = (z) => clampRoom(Math.floor((-z + 14) / ROOM_GAP))

export const BOUNDARIES = [-32, -60, -92, -120, -152, -180, -214]
/** 0..1 noclip intensity: 1 at a boundary, linear to 0 within 2.5 m, max over all boundaries. */
export const noclip = (z) => Math.max(...BOUNDARIES.map((b) => Math.max(0, 1 - Math.abs(z - b) / 2.5)))

/** Camera distance that fits a sphere of `radius` into the free part of the screen (freeW/freeH are 0..1 fractions). */
export function frameDistance(radius, fovDeg, aspect, freeW, freeH, margin = 1.2) {
  const v = Math.tan((fovDeg * Math.PI) / 360)
  return (radius * margin) / Math.min(v * freeH, v * aspect * freeW)
}
