// Storage can be missing or throw (private mode, blocked cookies): fall back to the default.
export function readFlag(storage, key, fallback) {
  try {
    const v = storage?.getItem(key)
    return v === '1' ? true : v === '0' ? false : fallback
  } catch { return fallback }
}
export function writeFlag(storage, key, on) {
  try { storage?.setItem(key, on ? '1' : '0') } catch { /* preference just won't persist */ }
}

export const readSoundPref = (storage) => readFlag(storage, 'nal:sound', false)
export const writeSoundPref = (storage, on) => writeFlag(storage, 'nal:sound', on)

export const store = (() => { try { return localStorage } catch { return null } })()
