import { Vector2 } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// Film look for desktop/TV only: soft bloom on neon, grain, vignette, slight chromatic aberration.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uMotion: { value: 1 }, uGlitch: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uMotion; uniform float uGlitch; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      float g = uGlitch * uMotion; // displacement/split/static vanish when motion is reduced
      float row = floor(vUv.y * 90.0), tick = floor(uTime * 24.0);
      vec2 uv = vUv + vec2((rand(vec2(row, tick)) - 0.5) * 0.12 * g * step(0.6, rand(vec2(row * 1.7, tick))), 0.0);
      vec2 d = vUv - 0.5; float r = dot(d, d);
      vec2 off = d * r * 0.012 + vec2(0.02 * g, 0.0);
      vec3 c = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      float band = step(0.93, rand(vec2(floor(vUv.y * 14.0), tick))) * g;
      c = mix(c, vec3(rand(vUv * 800.0 + tick)), band * 0.6);
      c *= 1.0 - 0.6 * uGlitch;
      c *= 1.0 - r * 1.1;
      c += (rand(vUv * 1000.0 + fract(uTime * uMotion)) - 0.5) * 0.05;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

export function createPost(world, motion) {
  const { renderer, scene, camera } = world
  const size = renderer.getSize(new Vector2())
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.6, 0.5, 2.5)) // threshold above lit walls: only neon blooms
  composer.addPass(new OutputPass())
  const film = new ShaderPass(FilmShader)
  composer.addPass(film)
  const render = composer.render.bind(composer)
  composer.render = (dt) => {
    film.uniforms.uGlitch.value = composer.glitch || 0
    film.uniforms.uMotion.value = motion.reduced ? 0 : 1 // static grain when motion is reduced
    film.uniforms.uTime.value += dt || 0.016
    render(dt)
  }
  return composer
}
