import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ROOM_GAP, ROOM_COUNT } from './path.js'
import { capDpr } from './quality.js'
import lmMeta from './models/lightmaps.json'

const ROOMS = ['backrooms', 'pool', 'corridor', 'mall']
const asset = (f) => new URL(`./models/${f}`, import.meta.url).href
// Per-room fog: colour + density. The dark gaps between rooms fade to black.
const FOG = [
  [new THREE.Color(0x2a2410), 0.05],
  [new THREE.Color(0xb9cdd1), 0.026],
  [new THREE.Color(0x06080b), 0.07],
  [new THREE.Color(0x0a0e18), 0.038],
]
const BLACK = new THREE.Color(0)
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t) }
// Art-direction multiplier on top of the baked intensity: the mall is "after hours".
const EXPOSURE = { backrooms: 1.0, pool: 0.5, corridor: 1.0, mall: 0.38 }

export function createWorld(canvas, tier) {
  // Throws when WebGL is unavailable; main.js falls back to text-only.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', powerPreference: 'high-performance' })
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(FOG[0][0].clone(), FOG[0][1])
  scene.background = scene.fog.color
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 140)

  const gltf = new GLTFLoader()
  const tex = new THREE.TextureLoader()
  const hotspots = [], spots = [], neons = [], glitches = []
  let entity = null

  async function loadRoom(i) {
    const name = ROOMS[i]
    const [g, lm] = await Promise.all([gltf.loadAsync(asset(`${name}.glb`)), tex.loadAsync(asset(`${name}_lm.webp`))])
    lm.flipY = false
    lm.channel = 1
    lm.colorSpace = THREE.SRGBColorSpace
    const root = g.scene
    root.position.z = -i * ROOM_GAP
    root.traverse((o) => {
      if (o.name.startsWith('spot_')) spots.push({ room: i, obj: o })
      if (!o.isMesh) return
      const src = o.material
      let m
      if (o.userData.neon) {
        // Emissive panels stay unlit and >1 so bloom picks them up.
        o.geometry.computeBoundingBox()
        const s = o.geometry.boundingBox.getSize(new THREE.Vector3())
        const big = s.x * s.z > 4 // skylights: huge panels would flood the screen with bloom
        const c = src.emissive.clone().multiplyScalar(Math.min(src.emissiveIntensity ?? 1, 4) * (big ? 0.5 : 1.6))
        m = new THREE.MeshBasicMaterial({ color: c })
        m.userData.base = c.clone()
        neons.push(o)
      } else {
        m = new THREE.MeshBasicMaterial({ map: src.map, color: src.color, lightMap: lm, lightMapIntensity: lmMeta[name].intensity * EXPOSURE[name] })
      }
      if (o.userData.hotspot === 'water') Object.assign(m, { transparent: true, opacity: 0.74, depthWrite: false })
      o.material = m
      src.dispose()
      o.userData.room = i
      if (o.userData.hotspot) hotspots.push(o)
      if (o.userData.glitch) glitches.push(o)
    })
    scene.add(root)
    await renderer.compileAsync(root, camera, scene)
  }

  async function loadEntity() {
    const g = await gltf.loadAsync(asset('entity.glb'))
    entity = g.scene
    entity.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x040404, transparent: true })
        o.userData.entity = true
      }
    })
    entity.userData.entity = true
    scene.add(entity)
    api.entity = entity
  }

  const yieldFrame = () => new Promise((r) => setTimeout(r, 0))

  function updateFog(z) {
    const local = -z
    const r = Math.min(Math.max(Math.floor(local / ROOM_GAP), 0), ROOM_COUNT - 1)
    const inRoom = local - r * ROOM_GAP // 0..60
    const next = Math.min(r + 1, ROOM_COUNT - 1)
    const toNext = smooth(40, 58, inRoom)
    const gap = r === ROOM_COUNT - 1 ? smooth(35, 43, inRoom) : smooth(26, 36, inRoom) * (1 - smooth(52, 59, inRoom))
    scene.fog.color.copy(FOG[r][0]).lerp(FOG[next][0], toNext).lerp(BLACK, gap)
    scene.fog.density = THREE.MathUtils.lerp(FOG[r][1], FOG[next][1], toNext) + gap * 0.06
  }

  function setSize(w, h) {
    // Re-read DPR on every resize (monitor changes) and cap total pixels for TVs / weak GPUs.
    const dpr = capDpr(w, h, Math.min(devicePixelRatio, tier === 'high' ? 2 : 1.5), tier === 'high' ? 2.5e6 : 1.2e6)
    renderer.setPixelRatio(dpr)
    api.composer?.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.fov = camera.aspect < 1 ? 78 : 62 // portrait phones need a wider vertical view
    camera.updateProjectionMatrix()
    api.composer?.setSize(w, h)
  }

  const api = {
    renderer, scene, camera, hotspots, spots, neons, glitches, entity,
    ticks: [], // per-frame hooks (t, dt), called by scroll.js
    composer: null,
    // First room + entity block the loader; the others stream in afterwards.
    async loadFirst() { await Promise.all([loadRoom(0), loadEntity()]) },
    async loadRest(onRoom) {
      for (let i = 1; i < ROOMS.length; i++) {
        await yieldFrame()
        try {
          await loadRoom(i)
          onRoom?.(i)
        } catch (err) {
          console.warn(`room ${ROOMS[i]} failed to load`, err) // keep going so later rooms still appear
        }
      }
    },
    updateFog,
    setSize,
    render(dt) { api.composer ? api.composer.render(dt) : renderer.render(scene, camera) },
  }
  return api
}
