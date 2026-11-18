import { gsap } from 'gsap'
import { Raycaster, Vector2, Vector3, Box3, RingGeometry, MeshBasicMaterial, Mesh } from 'three'
import { HOTSPOTS, ENTITIES } from './hotspots.js'
import { ROOM_GAP, ROOM_COUNT, roomAt, frameDistance } from './path.js'
import { notify } from './notify.js'
import { initEntities } from './entities.js'

const canDialog = typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype

/** Fill and open the info card; on browsers without <dialog> show the text as a toast instead. */
function openCard(info) {
  document.getElementById('info-title').textContent = info.title
  document.getElementById('info-body').textContent = info.body
  if (canDialog) { document.getElementById('info').showModal(); return true }
  notify(`${info.title}: ${info.body}`, 10000)
  return false
}

/** No-WebGL fallback: hotspot buttons still open their info card. */
export function initTextOnly() {
  const dialog = document.getElementById('info')
  document.getElementById('info-close').addEventListener('click', () => dialog.close())
  document.querySelectorAll('[data-hotspot]').forEach((btn) => btn.addEventListener('click', () => openCard(HOTSPOTS[btn.dataset.hotspot])))
  document.querySelectorAll('[data-entity]').forEach((btn) => btn.addEventListener('click', () => openCard(ENTITIES[btn.dataset.entity])))
}

// motion: { reduced } is read live, so the "Gerak" button applies without reload.
export function initInteract(world, scroll, { motion, fine }) {
  const ray = new Raycaster()
  ray.far = 45
  const ndc = new Vector2()
  const dialog = document.getElementById('info')
  const dur = (s) => (motion.reduced ? 0 : s)
  let busy = false
  let hovered = null
  const seen = new Set() // entities whose card was shown after a 3D click
  const ents = initEntities(world, scroll, { motion })
  let onClose = null
  let onResize = null
  addEventListener('resize', () => onResize?.())

  // ---------------------------------------------------------- picking
  function pick(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
    ray.setFromCamera(ndc, world.camera)
    // First hit against everything, so walls block objects behind them.
    const hit = ray.intersectObjects(world.scene.children, true).find((h) => h.object.visible && (!h.object.userData.entity || world.entities[h.object.userData.entity].visible))
    if (!hit) return null
    const ent = hit.object.userData.entity
    if (ent) return { id: ent, entity: true, point: hit.point }
    const id = hit.object.userData.hotspot
    return id ? { id, obj: hit.object, point: hit.point } : null
  }
  const blocked = (t) => t.closest?.('.card, button, a, dialog, .hotspot-list, .controls')

  addEventListener('click', (e) => {
    if (busy || blocked(e.target)) return
    const p = pick(e.clientX, e.clientY)
    if (p?.entity) entityClick(p.id)
    else if (p) activate(p.id, p.obj, p.point)
  })

  if (fine) {
    let pending = false, lx = 0, ly = 0
    addEventListener('pointermove', (e) => {
      lx = e.clientX; ly = e.clientY
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        const p = busy || blocked(document.elementFromPoint(lx, ly) || document.body) ? null : pick(lx, ly)
        setHover(p && !p.entity ? p.obj : null)
        document.body.style.cursor = p ? 'pointer' : ''
      })
    }, { passive: true })
  }

  function setHover(obj) {
    if (obj === hovered) return
    if (hovered) restore(hovered)
    hovered = obj
    if (obj) { remember(obj); obj.material.color.copy(obj.userData.baseColor).multiplyScalar(1.3) }
  }
  function remember(obj) { obj.userData.baseColor ??= obj.material.color.clone() }
  function restore(obj) { obj.material.color.copy(obj.userData.baseColor) }

  // ---------------------------------------------------------- buttons (keyboard / remote / screen reader)
  document.querySelectorAll('[data-hotspot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.hotspot
      // glitch ids exist once per room: resolve inside the button's own section
      const room = id.startsWith('glitch_') ? Number(btn.closest('[data-room]')?.dataset.room) : null
      activate(id, world.hotspots.find((o) => o.userData.hotspot === id && (room === null || o.userData.room === room)) ?? null)
    })
  })

  // Entities never pull the camera closer: they vanish and show their card (no focusOn).
  document.querySelectorAll('[data-entity]').forEach((btn) => btn.addEventListener('click', () => {
    if (busy) return
    ents.vanish(btn.dataset.entity)
    showInfo(ENTITIES[btn.dataset.entity])
  }))
  function entityClick(id) {
    ents.vanish(id)
    if (seen.has(id)) return
    seen.add(id)
    showInfo(ENTITIES[id])
  }

  // ---------------------------------------------------------- open / close
  function activate(id, obj, point) {
    if (busy) return
    busy = true
    setHover(null)
    react(id, obj, point)
    showInfo(HOTSPOTS[id])
    if (obj) focusOn(obj) // after showInfo: needs the open dialog's rect
  }

  function showInfo(info) {
    busy = true
    if (!openCard(info)) setTimeout(closeFlow, 2500) // no <dialog>: let the camera linger, then return
  }

  function focusOn(obj) {
    scroll.lock()
    const box = new Box3().setFromObject(obj)
    const center = box.getCenter(new Vector3())
    // Long rows (lockers) can never fit whole in a corridor: cap the radius so we still get a close look.
    const radius = Math.min(box.getSize(new Vector3()).length() / 2, 3)
    const room = roomAt(center.z)
    const top = -room * ROOM_GAP // room interior runs from z=top down to top-32
    const strip = room === ROOM_COUNT - 1 ? 3.5 : 1.2 // walls are beyond |x|=1.7; the mall has a side detour
    const clamp = gsap.utils.clamp
    const focus = { pos: new Vector3(), look: center, blend: 0, offX: 0, offY: 0 }
    // Stand on the room's centreline strip and back off along z, never through a wall; the object
    // is fitted into the area the dialog leaves free. Re-run on resize.
    const frame = () => {
      const r = dialog.open ? dialog.getBoundingClientRect() : { width: 0, height: 0 }
      const side = innerWidth >= 900
      focus.offX = side ? r.width / 2 + 12 : 0
      focus.offY = side ? 0 : r.height / 2
      const cam = world.camera
      const d = frameDistance(radius, cam.fov, cam.aspect, side ? 1 - (r.width + 24) / innerWidth : 1, side ? 1 : 1 - r.height / innerHeight)
      const x = clamp(-strip, strip, center.x)
      const dz = Math.sqrt(Math.max(0, d * d - (center.x - x) ** 2))
      focus.pos.set(x, clamp(1.2, 2.3, center.y + 0.3), clamp(top - 31, top - 1, center.z + dz))
    }
    frame()
    onResize = frame
    document.documentElement.classList.add('focusing')
    scroll.setFocus(focus)
    gsap.to(focus, { blend: 1, duration: dur(2.2), ease: 'power2.inOut' })
    onClose = () => {
      onResize = null
      document.documentElement.classList.remove('focusing')
      gsap.to(focus, {
        blend: 0, duration: dur(1.8), ease: 'power2.inOut', overwrite: true,
        onComplete: () => { scroll.unlock(); busy = false },
      })
    }
  }

  function closeFlow() {
    const fn = onClose
    onClose = null
    undo?.()
    undo = null
    if (fn) fn()
    else busy = false
  }
  document.getElementById('info-close').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', closeFlow)

  // ---------------------------------------------------------- reactions
  let undo = null
  function react(id, obj, point) {
    if (!obj) return
    remember(obj)
    const base = obj.userData.baseColor
    const c = obj.material.color
    if (id === 'lamp' || id === 'exit_sign') {
      if (motion.reduced) return
      const tl = gsap.timeline({ onComplete: () => c.copy(base) })
      ;[0.1, 1, 0.3, 1, 0.05, 0.8, 1].forEach((k, i) => tl.call(() => c.copy(base).multiplyScalar(k), null, i * 0.09 + (i > 3 ? 0.25 : 0)))
    } else if (id === 'door') {
      obj.userData.baseZ ??= obj.position.z // absolute targets: an interrupted open/close can't drift
      gsap.to(obj.position, { z: obj.userData.baseZ - 0.85, duration: dur(1.6), ease: 'power2.inOut', overwrite: true })
      undo = () => gsap.to(obj.position, { z: obj.userData.baseZ, duration: dur(1.2), ease: 'power2.inOut', overwrite: true })
    } else if (id === 'water') {
      ripple(point ?? new Box3().setFromObject(obj).getCenter(new Vector3()))
    } else if (id === 'escalator') {
      if (!motion.reduced) gsap.fromTo(obj.position, { y: 0 }, { y: 0.015, duration: 0.06, repeat: 9, yoyo: true, ease: 'none', delay: 0.4 })
    } else {
      gsap.timeline().to(c, { r: base.r * 1.4, g: base.g * 1.4, b: base.b * 1.4, duration: 0.5, ease: 'sine.out' })
        .to(c, { r: base.r, g: base.g, b: base.b, duration: 1.2, ease: 'sine.inOut' })
    }
  }

  const ringGeo = new RingGeometry(0.12, 0.17, 48)
  function ripple(at) {
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      m.position.set(at.x, at.y + 0.01, at.z)
      world.scene.add(m)
      gsap.timeline({ delay: i * 0.35, onComplete: () => { world.scene.remove(m); m.material.dispose() } })
        .to(m.scale, { x: 22, y: 22, duration: dur(2.6) || 0.01, ease: 'power1.out' }, 0)
        .to(m.material, { opacity: 0, duration: dur(2.6) || 0.01, ease: 'power1.in' }, 0)
    }
  }
}
