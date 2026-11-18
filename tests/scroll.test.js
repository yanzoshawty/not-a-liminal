import { expect, test } from 'vitest'
import { lerpKeys, roomAt } from '../src/path.js'

const keys = [[0, 0, 1.6, 4], [100, 2, 1.6, -6], [300, 2, 2.0, -30]]

test('before first key returns first pose', () => {
  expect(lerpKeys(keys, -50)).toEqual([0, 1.6, 4])
})
test('after last key returns last pose', () => {
  expect(lerpKeys(keys, 999)).toEqual([2, 2.0, -30])
})
test('interpolates between neighbouring keys', () => {
  const [x, y, z] = lerpKeys(keys, 200)
  expect(x).toBeCloseTo(2); expect(y).toBeCloseTo(1.8); expect(z).toBeCloseTo(-18)
})
test('roomAt switches room at the middle of the dark gap', () => {
  expect(roomAt(4)).toBe(0)
  expect(roomAt(-45)).toBe(0)
  expect(roomAt(-47)).toBe(1)
  expect(roomAt(-150)).toBe(2)
  expect(roomAt(-999)).toBe(3)
})
