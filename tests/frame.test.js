import { describe, it, expect } from 'vitest'
import { frameDistance } from '../src/path.js'

describe('frameDistance', () => {
  it('scales with radius and grows as the free area shrinks', () => {
    expect(frameDistance(2, 60, 1.78, 1, 1)).toBeCloseTo(2 * frameDistance(1, 60, 1.78, 1, 1))
    expect(frameDistance(1, 60, 1.78, 0.5, 1)).toBeGreaterThan(frameDistance(1, 60, 1.78, 1, 1))
  })
  it('fits the sphere exactly (margin 1): half-extent equals the visible half-height', () => {
    expect(frameDistance(1, 90, 1, 1, 1, 1)).toBeCloseTo(1)
  })
})
