/** Pick a different spawn spot than `current` (uniform over the others). */
export function nextSpot(current, count, rand) {
  if (count <= 1) return 0
  const i = Math.floor(rand() * (count - 1)) // 0..count-2, then skip over current
  return i >= current ? i + 1 : i
}

/** list: [{i, d}] spawn spots with distance to camera. Never closer than lastDist ("it never approaches"). */
export function chooseSpot(list, current, lastDist, rand) {
  const farther = list.filter((s) => s.d >= lastDist)
  if (!farther.length) return list.reduce((a, b) => (b.d > a.d ? b : a))
  const at = farther.findIndex((s) => s.i === current)
  return farther[at >= 0 ? nextSpot(at, farther.length, rand) : Math.floor(rand() * farther.length)]
}

/** d: distance to camera. Below `min` hide at once, inside `fade` start fading out. */
export const visibility = (d, fade, min) => (d < min ? 'hide' : d < fade ? 'fade' : 'show')

/** Smiler's z in the dark void after room r (0..2), just before the next room's entrance. */
export const smilerZ = (r) => -(r + 1) * 60 + 3
