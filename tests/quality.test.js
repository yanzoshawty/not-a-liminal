import { expect, test } from 'vitest'
import { pickTier } from '../src/quality.js'

test('phones get low tier', () => {
  expect(pickTier({ width: 390, coarse: true, memory: 4, cores: 6 })).toBe('low')
})
test('desktop gets high tier', () => {
  expect(pickTier({ width: 1920, coarse: false, memory: 8, cores: 8 })).toBe('high')
})
test('TV without deviceMemory still gets high tier', () => {
  expect(pickTier({ width: 3840, coarse: false, memory: undefined, cores: 4 })).toBe('high')
})
test('weak laptop gets low tier', () => {
  expect(pickTier({ width: 1440, coarse: false, memory: 2, cores: 2 })).toBe('low')
})

import { capDpr } from '../src/quality.js'

test('4K TV at DPR 1 is scaled under the pixel budget', () => {
  const d = capDpr(3840, 2160, 1, 2.5e6)
  expect(3840 * 2160 * d * d).toBeLessThanOrEqual(2.5e6 + 1)
})
test('1080p desktop at DPR 2 is capped, small window keeps native DPR', () => {
  expect(capDpr(1920, 1080, 2, 2.5e6)).toBeLessThan(2)
  expect(capDpr(800, 600, 2, 2.5e6)).toBe(2)
})
