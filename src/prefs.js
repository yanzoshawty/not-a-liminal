const KEY = 'nal:sound'
// Storage can be missing or throw (private mode, blocked cookies): default to sound off.
export function readSoundPref(storage) {
  try { return storage?.getItem(KEY) === '1' } catch { return false }
}
export function writeSoundPref(storage, on) {
  try { storage?.setItem(KEY, on ? '1' : '0') } catch { /* preference just won't persist */ }
}
