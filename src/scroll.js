import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Vector3 } from 'three'
import { lerpKeys, roomAt, noclip } from './path.js'

gsap.registerPlugin(ScrollTrigger)

const H = 1.6
// [section index, fraction of the section, x, y, z] in three.js world space.
// Sections: 0 hero, 1 intro, 2 backrooms, 3 pool, 4 corridor, 5 mall, 6 outro.
// Each room is fully visible while its card is on screen; the dark gap is crossed in the
// last ~30% of the previous section.
const SPEC = [
  [0, 0, 0, H, -0.6], [1, 0, 0, H, -2], [2, 0, 0, H, -6], [2, 0.7, 0, H, -29],
  [3, 0, 0, 1.9, -62.6], [3, 0.7, 0, 1.9, -87],
  [4, 0, 0, H, -122.6], [4, 0.7, 0, H, -148],
  [5, 0, 0, 1.8, -182.6], [5, 0.3, 3, 1.8, -192], [5, 0.55, 3, 1.8, -199], [5, 1, 0, 1.8, -205],
  // outro: walk out through the mall's back door into the dark
  [6, 0.4, 0, 1.8, -212], [6, 1, 0, 1.8, -224],
]

// motion: { reduced } read live every frame, so the "Gerak" button applies instantly.
export function bindScroll(world, { motion, fineMotion, onRoom, onNoclip }) {
  const sections = gsap.utils.toArray('main > section')
  let keys = []
  const proxy = { y: scrollY }
  const mouse = { x: 0, y: 0 }
  let locked = false
  let focus = null // { pos, look, blend 0..1 }: blended over the live pose, never replaces it
  let room = -1
let offsetOn = false

  function buildKeys() {
    const max = ScrollTrigger.maxScroll(window)
    // Read all layout first, then compute (no interleaved writes).
    const boxes = sections.map((s) => ({ top: s.offsetTop, h: s.offsetHeight }))
    keys = SPEC.map(([si, f, x, y, z]) => [Math.min(boxes[si].top + f * boxes[si].h, max), x, y, z])
    keys[keys.length - 1][0] = max
  }

  const yTo = gsap.quickTo(proxy, 'y', { duration: 2.0, ease: 'power3' })
  const mx = gsap.quickTo(mouse, 'x', { duration: 1.6, ease: 'power2' })
  const my = gsap.quickTo(mouse, 'y', { duration: 1.6, ease: 'power2' })
  const follow = (y) => {
    if (!motion.reduced) return yTo(y)
    gsap.killTweensOf(proxy) // reduced: camera tracks scroll directly, no glide
    proxy.y = y
  }

  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => { if (!locked) follow(self.scroll()) } })
  ScrollTrigger.addEventListener('refreshInit', buildKeys)
  buildKeys()

  if (fineMotion) {
    addEventListener('pointermove', (e) => {
      mx((e.clientX / innerWidth - 0.5) * 2)
      my((e.clientY / innerHeight - 0.5) * 2)
    }, { passive: true })
  }

  const pos = new Vector3(), look = new Vector3()
  function pose(y = proxy.y, outPos = pos, outLook = look) {
    outPos.fromArray(lerpKeys(keys, y))
    outLook.fromArray(lerpKeys(keys, y + innerHeight * 0.6))
    if (outLook.distanceToSquared(outPos) < 1) outLook.set(outPos.x, outPos.y, outPos.z - 2)
    outLook.y = outPos.y - 0.05
    return { pos: outPos, look: outLook }
  }

  let t = 0
  gsap.ticker.add((_, dt) => {
    t += dt / 1000
    const cam = world.camera
    pose()
    if (!motion.reduced) {
      pos.y += Math.sin(t * 0.8) * 0.015
      pos.x += Math.sin(t * 0.5) * 0.02
      look.x += mouse.x * 0.6
      look.y -= mouse.y * 0.3
    }
    if (focus) {
      pos.lerp(focus.pos, focus.blend)
      look.lerp(focus.look, focus.blend)
      // shifts the projection so the framed object sits in the screen area the dialog leaves free
      const w = innerWidth, h = innerHeight
      cam.setViewOffset(w, h, focus.offX * focus.blend, focus.offY * focus.blend, w, h)
      offsetOn = true
    } else if (offsetOn) {
      cam.clearViewOffset()
      offsetOn = false
    }
    cam.position.copy(pos)
    cam.lookAt(look)
    world.updateFog(cam.position.z)
    const r = roomAt(cam.position.z)
    if (r !== room) { room = r; onRoom?.(r) }
    onNoclip?.(noclip(cam.position.z))
    for (const fn of world.ticks) fn(t, dt / 1000)
    world.render(dt / 1000)
  })

  revealCards(motion)

  return {
    pose: (y) => pose(y, new Vector3(), new Vector3()),
    camera: () => world.camera.position,
    setFocus(f) { focus = f },
    lock() { locked = true; document.documentElement.classList.add('locked') },
    unlock() {
      locked = false
      focus = null
      document.documentElement.classList.remove('locked')
      proxy.y = scrollY // resync if the page resized/scrolled while the dialog was open
    },
    get room() { return room },
  }
}

function revealCards(motion) {
  // opacity only (not autoAlpha): hidden-by-visibility buttons could not be reached by Tab / TV remote
  const els = gsap.utils.toArray('main .card, main .hotspot-list')
  const show = { opacity: 1, y: 0 }
  if (!motion.reduced) gsap.set(els, { opacity: 0, y: 28 })
  ScrollTrigger.batch(els, {
    start: 'top 88%',
    onEnter: (b) => motion.reduced ? gsap.set(b, show) : gsap.to(b, { ...show, duration: 1.1, ease: 'power3.out', stagger: 0.08, overwrite: true }),
    onLeaveBack: (b) => motion.reduced ? gsap.set(b, show) : gsap.to(b, { opacity: 0, y: 28, duration: 0.5, ease: 'power2.in', overwrite: true }),
  })
  motion.onChange?.push((reduced) => { if (reduced) gsap.set(els, { ...show, overwrite: true }) })
  // keyboard focus landing on a not-yet-revealed element shows it at once
  addEventListener('focusin', (e) => {
    const el = e.target.closest?.('.card, .hotspot-list')
    if (el) gsap.to(el, { opacity: 1, y: 0, duration: 0.3, overwrite: true })
  })
}
