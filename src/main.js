import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import './styles.css'
import { pickTier } from './quality.js'
import { finishLoading } from './loader.js'
import { readFlag, writeFlag, store } from './prefs.js'
import { notify } from './notify.js'

const root = document.documentElement
const fine = matchMedia('(pointer: fine)').matches
const tier = pickTier({
  width: Math.max(screen.width, innerWidth),
  coarse: matchMedia('(pointer: coarse)').matches,
  memory: navigator.deviceMemory,
  cores: navigator.hardwareConcurrency ?? 4,
})
root.classList.add(`tier-${tier}`)

// Motion: OS setting is the default, the "Gerak" button overrides it (remembered).
const motion = {
  reduced: readFlag(store, 'nal:reduced-motion', matchMedia('(prefers-reduced-motion: reduce)').matches),
  onChange: [],
}
const motionBtn = document.getElementById('motion')
function applyMotion() {
  root.classList.toggle('reduce-motion', motion.reduced)
  motionBtn.setAttribute('aria-pressed', String(!motion.reduced))
  motionBtn.querySelector('.ctl-label').textContent = motion.reduced ? 'Gerak: dikurangi' : 'Gerak: penuh'
}
applyMotion()
motionBtn.addEventListener('click', () => {
  motion.reduced = !motion.reduced
  writeFlag(store, 'nal:reduced-motion', motion.reduced)
  applyMotion()
  motion.onChange.forEach((fn) => fn(motion.reduced))
})

// Resize / rotation: cover the relayout with a short "menyesuaikan ruangan…" screen, then
// rebuild sizes + scroll keys once the size has settled. Small height-only changes (mobile URL
// bar showing/hiding) are ignored so scrolling on phones never flashes the overlay.
function watchResize(onSettled) {
  const reflow = document.getElementById('reflow')
  let w = innerWidth, h = innerHeight, timer = 0
  addEventListener('resize', () => {
    const big = innerWidth !== w || Math.abs(innerHeight - h) > h * 0.2
    if (!big) return
    w = innerWidth; h = innerHeight
    reflow.classList.add('show')
    clearTimeout(timer)
    timer = setTimeout(async () => {
      await onSettled()
      reflow.classList.remove('show')
    }, 450)
  })
}

async function textOnly(reason) {
  root.classList.add('no-webgl')
  notify(reason)
  const { initTextOnly } = await import('./interact.js')
  initTextOnly() // hotspot buttons still open their info cards
  await finishLoading()
}

async function boot() {
  const [{ createWorld }, { bindScroll }, { initInteract }, { initSound }, { initGlitches }] = await Promise.all([
    import('./world.js'), import('./scroll.js'), import('./interact.js'), import('./audio.js'), import('./glitch.js'),
  ])
  const { ScrollTrigger } = await import('gsap/ScrollTrigger')
  const sound = initSound()

  let world
  try {
    world = createWorld(document.getElementById('world'), tier)
  } catch (err) {
    console.warn('WebGL unavailable, showing text only', err)
    return textOnly('Browser atau perangkatmu belum mendukung tampilan 3D (WebGL). Ceritanya tetap bisa kamu baca.')
  }

  const canvas = world.renderer.domElement
  const fit = () => world.setSize(canvas.clientWidth, canvas.clientHeight)
  fit()
  new ResizeObserver(fit).observe(canvas)
  watchResize(() => new Promise((done) => {
    setTimeout(done, 1500) // never leave the overlay up if no refresh event arrives
    fit()
    ScrollTrigger.addEventListener('refresh', function once() { ScrollTrigger.removeEventListener('refresh', once); done() })
    ScrollTrigger.refresh()
  }))

  if (tier === 'high') {
    const { createPost } = await import('./post.js')
    world.composer = createPost(world, motion)
  }

  let lastNoclip = 0
  function noclipFx(i) {
    sound.setNoclip(i)
    if (world.composer) world.composer.glitch = i
    else if (Math.abs(i - lastNoclip) > 0.01 || (i === 0 && lastNoclip)) { lastNoclip = i; root.style.setProperty('--noclip', i) }
  }

  await world.loadFirst()
  const scroll = bindScroll(world, { motion, fineMotion: fine && tier === 'high', onRoom: (r) => sound.setRoom(r), onNoclip: noclipFx })
  initInteract(world, scroll, { motion, fine })
  initGlitches(world, { motion, tier })
  await finishLoading()
  world.loadRest().catch((err) => console.warn(err))
}

boot().catch((err) => {
  console.error(err)
  textOnly('Ruangan 3D gagal dimuat. Coba muat ulang halaman; ceritanya tetap bisa kamu baca di bawah.')
})
