import { expect, test } from 'vitest'
import { readSoundPref, writeSoundPref } from '../src/prefs.js'

const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }

test('blocked storage reads as sound off', () => {
  expect(readSoundPref(throwing)).toBe(false)
})
test('blocked storage write does not throw', () => {
  expect(() => writeSoundPref(throwing, true)).not.toThrow()
})
test('stored "1" reads as on, round trip works', () => {
  const mem = new Map()
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) }
  expect(readSoundPref(store)).toBe(false)
  writeSoundPref(store, true)
  expect(readSoundPref(store)).toBe(true)
  writeSoundPref(store, false)
  expect(readSoundPref(store)).toBe(false)
})
test('missing storage (null) reads as off', () => {
  expect(readSoundPref(null)).toBe(false)
})

import { readFlag, writeFlag } from '../src/prefs.js'

test('readFlag falls back when unset or storage blocked', () => {
  expect(readFlag(throwing, 'nal:entity', true)).toBe(true)
  expect(readFlag(null, 'nal:motion', false)).toBe(false)
})
test('writeFlag/readFlag round trip overrides the fallback', () => {
  const mem = new Map()
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) }
  writeFlag(store, 'nal:entity', false)
  expect(readFlag(store, 'nal:entity', true)).toBe(false)
  expect(() => writeFlag(throwing, 'nal:entity', true)).not.toThrow()
})
