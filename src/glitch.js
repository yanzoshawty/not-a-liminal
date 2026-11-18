import * as THREE from 'three'

export const pickDelay = (rand = Math.random) => 4 + rand() * 5

export function checkerTexture() {
  const n = 64, data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = ((x >> 3) + (y >> 3)) % 2 === 0
    data.set(on ? [255, 0, 255, 255] : [0, 0, 0, 255], (y * n + x) * 4)
  }
  const t = new THREE.DataTexture(data, n, n)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

// Items arrive per room as rooms stream in: tick() polls world.glitches for new entries.
export function initGlitches(world, { motion, tier }) {
  const floats = [], doubles = []
  let seen = 0
  let checker = null

  function add(o) {
    const tag = o.userData.glitch
    if (tag === 'missing') o.material.map = checker ??= checkerTexture(), o.material.needsUpdate = true
    else if (tag === 'float') floats.push({ o, y: o.position.y, ry: o.rotation.y, ph: Math.random() * 6.28 })
    else if (tag === 'double' && tier === 'high') {
      const ghost = o.clone()
      delete ghost.userData.hotspot // ghosts are decoration, never clickable
      ghost.material = o.material.clone()
      Object.assign(ghost.material, { transparent: true, opacity: 0.35, depthWrite: false })
      ghost.visible = false
      o.parent.add(ghost)
      doubles.push({ o, ghost, base: o.position.clone(), next: pickDelay() * Math.random(), until: 0 })
    }
  }

  world.ticks.push((t) => {
    for (; seen < world.glitches.length; seen++) add(world.glitches[seen])
    for (const f of floats) {
      if (motion.reduced) { f.o.position.y = f.y; f.o.rotation.y = f.ry; continue }
      f.o.position.y = f.y + Math.sin(t * 0.9 + f.ph) * 0.08
      f.o.rotation.y = f.ry + t * 0.15
    }
    for (const d of doubles) {
      if (motion.reduced) { d.ghost.visible = false; d.o.position.copy(d.base); continue }
      if (d.until) {
        if (t > d.until) { d.until = 0; d.ghost.visible = false; d.o.position.copy(d.base); d.next = t + pickDelay() }
        else d.o.position.x = d.base.x + (Math.random() - 0.5) * 0.04
      } else if (t > d.next) {
        d.until = t + 0.3
        d.ghost.position.copy(d.base).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5))
        d.ghost.visible = true
      }
    }
  })
}
