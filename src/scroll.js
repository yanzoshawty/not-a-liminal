import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Vector3 } from 'three'
import { lerpKeys, roomAt } from './path.js'

gsap.registerPlugin(ScrollTrigger)

const H = 1.6
// [section index, fraction of the section, x, y, z] in three.js world space.
// Sections: 0 hero, 1 intro, 2 backrooms, 3 pool, 4 corridor, 5 mall, 6 outro.
// Each room is fully visible while its card is on screen; the dark gap is crossed in the
// last ~20% of the previous section.
const SPEC = [
  [0, 0, 0, H, -0.6], [1, 0, 0, H, -2], [2, 0, 0, H, -6], [2, 0.8, 0, H, -29],
  [3, 0, 0, 1.9, -61], [3, 0.8, 0, 1.9, -87],
  [4, 0, 0, H, -121], [4, 0.8, 0, H, -148],
  [5, 0, 0, 1.8, -181], [5, 0.3, 3, 1.8, -192], [5, 0.55, 3, 1.8, -199], [5, 1, 0, 1.8, -205],
  // outro: walk out through the mall's back door into the dark
  [6, 0.4, 0, 1.8, -212], [6, 1, 0, 1.8, -224],
]

export function bindScroll(world, { reduceMotion, fineMotion, onRoom }) {
  const sections = gsap.utils.toArray('main > section')
  let keys = []
  const proxy = { y: scrollY }
  const mouse = { x: 0, y: 0 }
  let locked = false
  let override = null
  let room = -1

  function buildKeys() {
    const max = ScrollTrigger.maxScroll(window)
    // Read all layout first, then compute (no interleaved writes).
    const boxes = sections.map((s) => ({ top: s.offsetTop, h: s.offsetHeight }))
    keys = SPEC.map(([si, f, x, y, z]) => [Math.min(boxes[si].top + f * boxes[si].h, max), x, y, z])
    keys[keys.length - 1][0] = max
  }

  const yTo = gsap.quickTo(proxy, 'y', { duration: reduceMotion ? 0.15 : 1.2, ease: 'power3' })
  const mx = gsap.quickTo(mouse, 'x', { duration: 1.6, ease: 'power2' })
  const my = gsap.quickTo(mouse, 'y', { duration: 1.6, ease: 'power2' })

  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => { if (!locked) yTo(self.scroll()) } })
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
    if (override) {
      cam.position.copy(override.pos)
      cam.lookAt(override.look)
    } else {
      pose()
      if (!reduceMotion) {
        pos.y += Math.sin(t * 0.8) * 0.015
        pos.x += Math.sin(t * 0.5) * 0.02
        look.x += mouse.x * 0.6
        look.y -= mouse.y * 0.3
      }
      cam.position.copy(pos)
      cam.lookAt(look)
    }
    world.updateFog(cam.position.z)
    const r = roomAt(cam.position.z)
    if (r !== room) { room = r; onRoom?.(r) }
    world.tick?.(t, dt / 1000)
    world.render(dt / 1000)
  })

  revealCards(reduceMotion)

  return {
    pose: (y) => pose(y, new Vector3(), new Vector3()),
    progressY: () => proxy.y,
    setOverride(o) { override = o },
    lock() { locked = true; document.documentElement.classList.add('locked') },
    unlock() { locked = false; override = null; document.documentElement.classList.remove('locked') },
    get room() { return room },
  }
}

function revealCards(reduceMotion) {
  // opacity only (not autoAlpha): hidden-by-visibility buttons could not be reached by Tab / TV remote
  const els = gsap.utils.toArray('main .card, main .hotspot-list')
  if (reduceMotion) return
  gsap.set(els, { opacity: 0, y: 28 })
  ScrollTrigger.batch(els, {
    start: 'top 88%',
    onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.08, overwrite: true }),
    onLeaveBack: (b) => gsap.to(b, { opacity: 0, y: 28, duration: 0.5, ease: 'power2.in', overwrite: true }),
  })
  // keyboard focus landing on a not-yet-revealed element shows it at once
  addEventListener('focusin', (e) => {
    const el = e.target.closest?.('.card, .hotspot-list')
    if (el) gsap.to(el, { opacity: 1, y: 0, duration: 0.3, overwrite: true })
  })
}
