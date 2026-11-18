import { readSoundPref, writeSoundPref, store } from './prefs.js'
import { notify } from './notify.js'

const AC = window.AudioContext || window.webkitAudioContext
const FADE_IN = 4, FADE_OUT = 2 // seconds, symmetric enough to never feel abrupt

// Per room: lowpass cutoff, reverb wet, fluorescent hum level.
const ROOM_MIX = [
  { cut: 420, wet: 0.35, hum: 0.012 }, // backrooms: close, buzzing
  { cut: 900, wet: 0.8, hum: 0.003 }, // pool: bright, echoing
  { cut: 340, wet: 0.3, hum: 0.014 }, // corridor
  { cut: 260, wet: 0.55, hum: 0.005 }, // mall: deep, hollow
]
const VOLUME = 0.18

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  return buf
}

/** Generative ambient bed: detuned drone + mains hum + air, all built in the browser. */
function createBgm() {
  let ctx, master, filter, wet, hum
  let room = 0

  function build() {
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.6
    const dry = ctx.createGain(); dry.gain.value = 0.7
    wet = ctx.createGain()
    const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 4)
    filter.connect(dry).connect(master)
    filter.connect(verb).connect(wet).connect(master)
    ;[[55, 'sawtooth', 0.05], [55.35, 'sawtooth', 0.05], [82.4, 'triangle', 0.04], [110.2, 'sine', 0.025]].forEach(([f, type, g]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f
      const gn = ctx.createGain(); gn.gain.value = g
      o.connect(gn).connect(filter); o.start()
    })
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045
    const depth = ctx.createGain(); depth.gain.value = 110
    lfo.connect(depth).connect(filter.frequency); lfo.start()
    hum = ctx.createGain(); hum.connect(master)
    ;[[60, 1], [120, 0.45], [180, 0.2]].forEach(([f, g]) => {
      const o = ctx.createOscillator(); o.frequency.value = f
      const gn = ctx.createGain(); gn.gain.value = g
      o.connect(gn).connect(hum); o.start()
    })
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate)
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    const air = ctx.createBufferSource(); air.buffer = nb; air.loop = true
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.4
    const ag = ctx.createGain(); ag.gain.value = 0.012
    air.connect(bp).connect(ag).connect(filter); air.start()
    apply(0)
  }

  function apply(ramp) {
    const m = ROOM_MIX[room], t = ctx.currentTime
    filter.frequency.setTargetAtTime(m.cut, t, ramp)
    wet.gain.setTargetAtTime(m.wet, t, ramp)
    hum.gain.setTargetAtTime(m.hum, t, ramp)
  }

  let stopTimer = 0
  return {
    async start() {
      clearTimeout(stopTimer) // a quick off->on must not be suspended by the old timer
      if (!ctx) build()
      await ctx.resume()
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(VOLUME, ctx.currentTime, FADE_IN / 3) // ~95% after FADE_IN
      return ctx.state === 'running'
    },
    stop() {
      if (!ctx) return
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(0, ctx.currentTime, FADE_OUT / 3)
      stopTimer = setTimeout(() => ctx.suspend(), FADE_OUT * 1000 + 300)
    },
    setRoom(r) { room = r; if (ctx) apply(1.5) },
    suspend() { ctx?.suspend() },
    resume() { ctx?.resume() },
  }
}

export function initSound() {
  const btn = document.getElementById('sound')
  const label = btn.querySelector('.ctl-label')
  const bgm = createBgm()
  let on = false
  let fadeTimer = 0

  function unsupported(err) {
    if (err) console.warn('audio unavailable', err)
    on = false
    btn.setAttribute('aria-pressed', 'false')
    label.textContent = 'Suara: mati'
    notify('Browser kamu belum mendukung suara latar (Web Audio). Semua yang lain tetap bisa dinikmati.')
    return false
  }

  function set(next) {
    if (next && !AC) return unsupported()
    on = next
    btn.setAttribute('aria-pressed', String(on))
    label.textContent = on ? 'Suara: nyala' : 'Suara: mati'
    // icon pulses for as long as the volume is still ramping
    btn.classList.add('fading')
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => btn.classList.remove('fading'), (on ? FADE_IN : FADE_OUT) * 1000)
    writeSoundPref(store, on)
    return on ? bgm.start().catch(unsupported) : bgm.stop()
  }

  btn.addEventListener('click', () => set(!on))

  // Browsers block autoplay; honour a saved "on" at the first real activation gesture.
  // pointerdown does not unlock audio on touch screens, so use click/touchend/keydown and
  // keep listening until the context is actually running.
  if (readSoundPref(store) && AC) {
    const events = ['click', 'touchend', 'keydown']
    const first = async (e) => {
      if (btn.contains(e.target)) return done() // the button handles itself
      if (await set(true)) done()
    }
    const done = () => events.forEach((t) => removeEventListener(t, first, true))
    events.forEach((t) => addEventListener(t, first, true))
  }

  document.addEventListener('visibilitychange', () => {
    if (!on) return
    document.hidden ? bgm.suspend() : bgm.resume()
  })

  return { setRoom: (r) => bgm.setRoom(r) }
}
