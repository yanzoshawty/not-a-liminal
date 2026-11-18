import { expect, test } from 'vitest'
import { nextSpot } from '../src/entity.js'

test('never picks the spot the entity is standing on', () => {
  // rand that maps straight onto the current index must still move
  expect(nextSpot(2, 5, () => 0.4)).not.toBe(2)
  expect(nextSpot(0, 5, () => 0)).not.toBe(0)
})
test('single spot stays put', () => {
  expect(nextSpot(0, 1, Math.random)).toBe(0)
})
test('always returns an index in range', () => {
  for (let i = 0; i < 100; i++) {
    const n = nextSpot(i % 7, 7, Math.random)
    expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(7); expect(n).not.toBe(i % 7)
  }
})

import { chooseSpot } from '../src/entity.js'

test('respawn never comes closer than the previous distance', () => {
  const list = [{ i: 0, d: 15 }, { i: 1, d: 22 }, { i: 2, d: 35 }]
  for (let k = 0; k < 50; k++) {
    const s = chooseSpot(list, -1, 22, Math.random)
    expect(s.d).toBeGreaterThanOrEqual(22)
  }
})
test('when nothing is farther, picks the farthest spot', () => {
  const list = [{ i: 0, d: 15 }, { i: 1, d: 18 }]
  expect(chooseSpot(list, -1, 30, Math.random).i).toBe(1)
})
test('does not reuse the current spot when another qualifies', () => {
  const list = [{ i: 4, d: 30 }, { i: 7, d: 31 }]
  expect(chooseSpot(list, 4, 0, () => 0).i).toBe(7)
})

import { visibility, smilerZ } from '../src/entity.js'

test('visibility: show far, fade inside the fade distance, hide below the minimum', () => {
  expect(visibility(30, 20, 12)).toBe('show')
  expect(visibility(15, 20, 12)).toBe('fade')
  expect(visibility(5, 20, 12)).toBe('hide')
})
test('smiler sits in the void after room r', () => {
  expect(smilerZ(0)).toBe(-57)
  expect(smilerZ(2)).toBe(-177)
})
