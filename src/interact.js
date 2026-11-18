import { gsap } from 'gsap'
import { Raycaster, Vector2, Vector3, Box3, RingGeometry, MeshBasicMaterial, Mesh } from 'three'
import { HOTSPOTS, ENTITY_INFO } from './hotspots.js'
import { chooseSpot } from './entity.js'
import { ROOM_GAP, ROOM_COUNT, roomAt, frameDistance } from './path.js'
import { readFlag, writeFlag, store } from './prefs.js'
import { notify } from './notify.js'

const MIN_ENTITY_DIST = 12 // the entity is never visible closer than this to the camera
const FADE_DIST = 20 // fading starts here
const NEXT_ROOM_CHANCE = 0.35 // how often it waits at the threshold of the next room instead
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
  document.querySelectorAll('[data-hotspot]').forEach((btn) => btn.addEventListener('click', () => {
    openCard(btn.dataset.hotspot === 'entity' ? ENTITY_INFO : HOTSPOTS[btn.dataset.hotspot])
  }))
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
  let entitySeen = false
  let onClose = null
  let onResize = null
  addEventListener('resize', () => onResize?.())

  // ---------------------------------------------------------- picking
  function pick(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)
    ray.setFromCamera(ndc, world.camera)
    // First hit against everything, so walls block objects behind them.
    const hit = ray.intersectObjects(world.scene.children, true).find((h) => h.object.visible && (!h.object.userData.entity || world.entity.visible))
    if (!hit) return null
    if (hit.object.userData.entity) return { id: 'entity', obj: world.entity, point: hit.point }
    const id = hit.object.userData.hotspot
    return id ? { id, obj: hit.object, point: hit.point } : null
  }
  const blocked = (t) => t.closest?.('.card, button, a, dialog, .hotspot-list, .controls')

  addEventListener('click', (e) => {
    if (busy || blocked(e.target)) return
    const p = pick(e.clientX, e.clientY)
    if (p) activate(p.id, p.obj, p.point)
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
        setHover(p?.id && p.id !== 'entity' ? p.obj : null)
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
      if (id === 'entity') return activate('entity', world.entity)
      // glitch ids exist once per room: resolve inside the button's own section
      const room = id.startsWith('glitch_') ? Number(btn.closest('[data-room]')?.dataset.room) : null
      activate(id, world.hotspots.find((o) => o.userData.hotspot === id && (room === null || o.userData.room === room)) ?? null)
    })
  })

  // ---------------------------------------------------------- open / close
  function activate(id, obj, point) {
    if (busy) return
    if (id === 'entity') {
      vanishEntity()
      if (entitySeen) return
      entitySeen = true
      return showInfo(ENTITY_INFO) // no camera move: nothing ever approaches the entity
    }
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

  // ---------------------------------------------------------- entity
  const tmp = new Vector3()
  let current = null // index into world.spots, or -1 for the next-room threshold
  let lastDist = 0 // distance at the last spawn; reset per room
  let hidden = true
  let entityRoom = -1
  let respawnCall = null
  let entityOn = readFlag(store, 'nal:entity', true)

  function entityMats() {
    const mats = []
    world.entity?.traverse((o) => o.isMesh && mats.push(o.material))
    return mats
  }

  function candidates() {
    const cam = world.camera.position
    return world.spots
      .map((s, i) => ({ i, p: s.obj.getWorldPosition(new Vector3()), room: s.room }))
      .map((s) => ({ ...s, d: s.p.distanceTo(cam) }))
      .filter((s) => s.room === scroll.room && s.d >= FADE_DIST + 4 && s.d <= 40)
  }

  // Just inside the next room's entrance, on the doorway axis: visible as a faint silhouette
  // straight through both doors while you are still in the current room.
  function threshold() {
    const r = scroll.room
    const cam = world.camera.position
    const inRoom = -cam.z - r * ROOM_GAP
    if (r >= ROOM_COUNT - 1 || inRoom > 24 || !world.spots.some((s) => s.room === r + 1)) return null
    const p = new Vector3(0, 0, -(r + 1) * ROOM_GAP - 3)
    return { i: -1, p, room: r + 1, d: p.distanceTo(cam) }
  }

  function placeEntity() {
    if (!entityOn || !world.entity) return
    const list = candidates()
    const next = threshold()
    const s = next && (Math.random() < NEXT_ROOM_CHANCE || !list.length) ? next
      : list.length ? chooseSpot(list, current, lastDist, Math.random) // never reappears closer than before
      : null
    if (!s) { respawnCall = gsap.delayedCall(3, placeEntity); return }
    current = s.i
    lastDist = s.d
    entityRoom = s.room
    const far = s.room !== scroll.room
    entityMats().forEach((m) => { m.fog = !far; m.needsUpdate = true }) // fog would erase it at 50+ m
    world.entity.position.copy(s.p)
    world.entity.visible = true
    hidden = false
    gsap.to(entityMats(), { opacity: far ? 0.55 : 0.92, duration: motion.reduced ? 0.3 : 3, ease: 'sine.inOut', overwrite: true })
  }

  function vanishEntity(respawn = true) {
    if (!world.entity || hidden) return
    hidden = true
    respawnCall?.kill()
    gsap.to(entityMats(), {
      opacity: 0, duration: 0.8, ease: 'power2.in', overwrite: true,
      onComplete: () => {
        world.entity.visible = false
        if (respawn) respawnCall = gsap.delayedCall(gsap.utils.random(4, 8), placeEntity)
      },
    })
  }

  // "Sosok: tampil / sembunyi" button, remembered per browser.
  const toggle = document.getElementById('entity-toggle')
  const label = toggle.querySelector('.ctl-label')
  function setEntity(on) {
    entityOn = on
    writeFlag(store, 'nal:entity', on)
    toggle.setAttribute('aria-pressed', String(on))
    label.textContent = on ? 'Sosok: tampil' : 'Sosok: sembunyi'
    if (on) { respawnCall?.kill(); respawnCall = gsap.delayedCall(1, placeEntity) }
    else { respawnCall?.kill(); vanishEntity(false) }
  }
  toggle.addEventListener('click', () => setEntity(!entityOn))

  if (world.entity) {
    world.entity.visible = false
    entityMats().forEach((m) => { m.opacity = 0 })
    setEntity(entityOn)
  }

  let lastRoom = -1
  world.ticks.push(() => {
    const e = world.entity
    if (!e) return
    const cam = world.camera.position
    if (scroll.room !== lastRoom) {
      lastRoom = scroll.room
      lastDist = 0
      if (!hidden && entityRoom !== scroll.room) vanishEntity()
    }
    if (e.visible) {
      tmp.copy(cam).sub(e.position)
      e.rotation.y = Math.atan2(tmp.x, tmp.z) // always faces you, from afar
      const d = tmp.length()
      if (d < MIN_ENTITY_DIST) { e.visible = false; if (!hidden) vanishEntity() } // fade tween still schedules the respawn
      else if (!hidden && d < FADE_DIST) vanishEntity() // start fading early so a fast scroll never gets close
    }
  })
}
