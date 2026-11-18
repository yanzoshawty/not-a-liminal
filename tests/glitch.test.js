import { describe, it, expect } from 'vitest'
import { pickDelay, checkerTexture } from '../src/glitch.js'

describe('glitch', () => {
  it('pickDelay stays within 4..9 s', () => {
    expect(pickDelay(() => 0)).toBe(4)
    const hi = pickDelay(() => 0.999)
    expect(hi).toBeLessThan(9)
    expect(hi).toBeGreaterThanOrEqual(8.9)
  })
  it('checkerTexture is 8px magenta/black cells', () => {
    const t = checkerTexture()
    const d = t.image.data
    expect([d[0], d[1], d[2]]).toEqual([255, 0, 255])
    const i = 8 * 4 // pixel (8,0)
    expect([d[i], d[i + 1], d[i + 2]]).toEqual([0, 0, 0])
  })
})
