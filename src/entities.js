import { gsap } from 'gsap'
import { Vector3, Raycaster, Group, Mesh, CircleGeometry, RingGeometry, PlaneGeometry, MeshBasicMaterial, MathUtils } from 'three'
import { chooseSpot, visibility, smilerZ } from './entity.js'
import { ROOM_GAP, ROOM_COUNT } from './path.js'
import { readFlag, writeFlag, store } from './prefs.js'

// Nothing ever approaches the camera: each entity fades once you are within `fade` metres,
// is gone instantly below `min`, and only comes back after the camera changes room (tall also
// respawns farther ahead inside its room).
const FAR = { fade: 20, min: 12 }
const NEAR = { fade: 10, min: 6 } // smiler: floats in the dark void, no walls to keep you away
const HEAD_YAW = MathUtils.degToRad(60)
const tmp = new Vector3()

/** Two eyes + a wide grin, unlit and fog-free so they glow out of the black gap between rooms. */
function buildSmiler() {
  const mat = new MeshBasicMaterial({ fog: false, transparent: true, opacity: 0, depthWrite: false })
  mat.color.setRGB(2.2, 2.1, 1.6) // >1: pale yellow-white that bloom picks up
  const g = new Group()
  const eyes = [-0.26, 0.26].map((x) => {
    const e = new Mesh(new CircleGeometry(0.075, 24), mat)
    e.position.set(x, 0.18, 0)
    e.scale.set(1, 1.5, 1)
    g.add(e)
    return e
  })
  const grin = new Mesh(new RingGeometry(0.42, 0.47, 48, 1, Math.PI + 0.3, Math.PI - 0.6), mat)
  grin.position.y = 0.32
  g.add(grin)
  g.traverse((o) => { o.userData.entity = 'smiler' })
  g.userData.entity = 'smiler'
  g.visible = false
  return { g, eyes }
}

export function initEntities(world, scroll, { motion }) {
  const cam = world.camera.position
  const smiler = buildSmiler()
  world.scene.add(smiler.g)
  world.entities.smiler = smiler.g

  // A black figure in a black doorway is invisible: a dim, fog-free glow behind it (the corridor's
  // end wall hides everything outside the 1.8 x 2.2 m opening) turns it into a real silhouette.
  if (world.entities.silhouette) {
    const back = new Mesh(new PlaneGeometry(1.8, 2.2), new MeshBasicMaterial({ color: 0x23272c, fog: false, transparent: true }))
    back.position.set(0, 1.1, -0.6)
    back.userData.entity = 'silhouette'
    world.entities.silhouette.add(back)
  }

  const voidRoom = () => Math.min(Math.max(Math.floor(-cam.z / ROOM_GAP), 0), ROOM_COUNT - 2)

  // Tall: Backrooms spots + a few hand-picked ones down the aisle and the far-left side, the only
  // places 20+ m away that the centre channel can see (the room is 32 m long).
  const EXTRA = [[0, -30.5], [-1, -31.3], [-0.6, -28.5], [-6, -30.5], [-6.5, -31.3], [-8.4, -31.4]].map(([x, z]) => new Vector3(x, 0, z))
  const ray = new Raycaster()
  const chest = new Vector3()
  function inSight(p, d) {
    ray.set(cam, chest.set(p.x, 1.5, p.z).sub(cam).normalize())
    ray.far = d
    return !ray.intersectObjects(world.scene.children, true).some((h) => h.object.visible && !h.object.userData.entity)
  }
  let current = -1, lastDist = 0 // lastDist: distance when it last faded, reset per room
  function placeTall(o) {
    const list = [...world.spots.filter((s) => s.room === 0).map((s) => s.obj.getWorldPosition(new Vector3())), ...EXTRA]
      .map((p, i) => ({ i, p, d: p.distanceTo(cam) }))
      .filter((s) => s.d >= FAR.fade + 1 && s.d <= 45 && s.d >= lastDist && inSight(s.p, s.d))
    if (!list.length) return false
    const s = chooseSpot(list, current, lastDist, Math.random)
    current = s.i
    o.position.copy(s.p)
    return true
  }
  const atAnchor = (id) => (o) => {
    const a = world.anchors[id] // rooms 2 and 3 stream in later: no anchor yet, no entity yet
    if (!a) return false
    a.getWorldPosition(o.position)
    return true
  }

  const ents = [
    { id: 'tall', key: () => scroll.room, room: 0, place: placeTall, opacity: 1, respawn: true, ...FAR },
    { id: 'smiler', key: voidRoom, room: null, opacity: 1, ...NEAR,
      place: (o) => { o.position.set(0, 1.7, smilerZ(voidRoom())); return cam.z > o.position.z } },
    { id: 'silhouette', key: () => scroll.room, room: 2, place: atAnchor('silhouette'), opacity: 1, ...FAR },
    { id: 'partygoer', key: () => scroll.room, room: 3, place: atAnchor('partygoer'), opacity: 1, ...FAR },
  ].filter((e) => world.entities[e.id])
  for (const e of ents) {
    e.obj = world.entities[e.id]
    e.mats = []
    e.obj.traverse((o) => o.isMesh && e.mats.push(o.material))
    e.mats.forEach((m) => { m.opacity = 0 })
    e.shown = false // placed and visible (or fading in)
    e.out = false // dismissed in this room: wait for a room change
    e.lastKey = e.key()
    e.head = e.obj.getObjectByName('head')
  }
  const byId = (id) => ents.find((e) => e.id === id)

  function show(e) {
    e.base = e.obj.position.clone()
    e.jitter = gsap.utils.random(0.8, 2)
    e.obj.visible = true
    e.shown = true
    gsap.to(e.mats, { opacity: e.opacity, duration: motion.reduced ? 0.3 : 3, ease: 'sine.inOut', overwrite: true })
  }

  function vanish(id, instant = false) {
    const e = byId(id)
    if (!e) return
    e.out = true
    if (!e.shown) return
    e.shown = false
    if (instant) { gsap.killTweensOf(e.mats); e.mats.forEach((m) => { m.opacity = 0 }); e.obj.visible = false; return }
    gsap.to(e.mats, { opacity: 0, duration: 0.8, ease: 'power2.in', overwrite: true, onComplete: () => { e.obj.visible = false } })
  }

  // "Sosok: tampil / sembunyi" button hides every entity, remembered per browser.
  let enabled = readFlag(store, 'nal:entity', true)
  const toggle = document.getElementById('entity-toggle')
  const label = toggle.querySelector('.ctl-label')
  function setEnabled(on) {
    enabled = on
    writeFlag(store, 'nal:entity', on)
    toggle.setAttribute('aria-pressed', String(on))
    label.textContent = on ? 'Sosok: tampil' : 'Sosok: sembunyi'
    for (const e of ents) { vanish(e.id); e.out = false } // out reset: they may return once re-enabled
  }
  toggle.addEventListener('click', () => setEnabled(!enabled))
  setEnabled(enabled)

  let retry = 0, blink = 4
  world.ticks.push((t, dt) => {
    retry -= dt
    const tryPlace = retry <= 0
    if (tryPlace) retry = 0.5 // spot search walks every spot: twice a second is plenty
    for (const e of ents) {
      const k = e.key()
      if (k !== e.lastKey) { e.lastKey = k; vanish(e.id); e.out = false; if (e.respawn) { lastDist = 0; current = -1 } }
      e.wait = (e.wait ?? 0) - dt
      if (!e.shown) {
        if (enabled && tryPlace && !e.out && e.wait <= 0 && (e.room === null || e.room === scroll.room) && e.place(e.obj)
          && visibility(e.obj.position.distanceTo(cam), e.fade, e.min) === 'show') show(e)
        continue
      }
      const d = e.base.distanceTo(cam)
      const v = visibility(d, e.fade, e.min)
      if (v === 'show') continue
      vanish(e.id, v === 'hide') // fades out before you get anywhere near
      // Proximity fade, not a click: tall may come back farther ahead, never closer than it was.
      if (e.respawn) { e.out = false; e.wait = 1.5; lastDist = d }
    }

    const tall = byId('tall')
    if (tall?.obj.visible) {
      tmp.copy(cam).sub(tall.obj.position)
      tall.obj.rotation.y = Math.atan2(tmp.x, tmp.z) // always faces you, from afar
      // Glitch jitter: jump a few cm for two frames, then snap back.
      if (tall.shown && !motion.reduced && (tall.jitter -= dt) <= 0) {
        tall.jitter = gsap.utils.random(0.8, 2)
        tall.frames = 2
        tall.obj.position.set(tall.base.x + gsap.utils.random(-0.15, 0.15), tall.base.y, tall.base.z + gsap.utils.random(-0.15, 0.15))
      } else if (tall.frames && --tall.frames === 0) tall.obj.position.copy(tall.base)
    }

    const party = byId('partygoer')
    if (party?.obj.visible && party.head) {
      party.head.getWorldPosition(tmp)
      const yaw = Math.atan2(cam.x - tmp.x, cam.z - tmp.z) - party.obj.rotation.y
      party.head.rotation.y = MathUtils.clamp(yaw, -HEAD_YAW, HEAD_YAW)
    }

    if (smiler.g.visible) {
      smiler.g.quaternion.copy(world.camera.quaternion) // a flat face that always looks straight at you
      blink -= dt
      const s = blink < 0 ? Math.max(0.08, Math.abs(blink + 0.25) / 0.25) : 1 // slow 0.5 s blink
      smiler.eyes.forEach((m) => { m.scale.y = 1.5 * s })
      if (blink < -0.5) blink = gsap.utils.random(3, 6)
    }
  })

  return { vanish: (id) => vanish(id), setEnabled }
}
