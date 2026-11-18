import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import './styles.css'
import { pickTier } from './quality.js'
import { finishLoading } from './loader.js'

const root = document.documentElement
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const fine = matchMedia('(pointer: fine)').matches
const tier = pickTier({
  width: Math.max(screen.width, innerWidth),
  coarse: matchMedia('(pointer: coarse)').matches,
  memory: navigator.deviceMemory,
  cores: navigator.hardwareConcurrency ?? 4,
})
root.classList.add(`tier-${tier}`)

async function boot() {
  const [{ createWorld }, { bindScroll }, { initInteract }, { initSound }] = await Promise.all([
    import('./world.js'), import('./scroll.js'), import('./interact.js'), import('./audio.js'),
  ])
  const sound = initSound()

  let world
  try {
    world = createWorld(document.getElementById('world'), tier)
  } catch (err) {
    console.warn('WebGL unavailable, showing text only', err)
    return textOnly()
  }

  const canvas = world.renderer.domElement
  world.setSize(canvas.clientWidth, canvas.clientHeight)
  new ResizeObserver(() => world.setSize(canvas.clientWidth, canvas.clientHeight)).observe(canvas)

  if (tier === 'high') {
    const { createPost } = await import('./post.js')
    world.composer = createPost(world, reduceMotion)
  }

  await world.loadFirst()
  const scroll = bindScroll(world, { reduceMotion, fineMotion: fine && tier === 'high', onRoom: (r) => sound.setRoom(r) })
  initInteract(world, scroll, { reduceMotion, fine })
  await finishLoading()
  world.loadRest().catch((err) => console.warn(err))
}

async function textOnly() {
  root.classList.add('no-webgl')
  const { initTextOnly } = await import('./interact.js')
  initTextOnly() // hotspot buttons still open their info cards
  await finishLoading()
}

boot().catch((err) => {
  console.error(err)
  textOnly()
})
