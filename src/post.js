import { Vector2 } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// Film look for desktop/TV only: soft bloom on neon, grain, vignette, slight chromatic aberration.
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uMotion: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uMotion; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r = dot(d, d);
      vec2 off = d * r * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= 1.0 - r * 1.1;
      c += (rand(vUv * 1000.0 + fract(uTime * uMotion)) - 0.5) * 0.05;
      gl_FragColor = vec4(c, 1.0);
    }`,
}

export function createPost(world, reduceMotion) {
  const { renderer, scene, camera } = world
  const size = renderer.getSize(new Vector2())
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.6, 0.5, 2.5)) // threshold above lit walls: only neon blooms
  composer.addPass(new OutputPass())
  const film = new ShaderPass(FilmShader)
  film.uniforms.uMotion.value = reduceMotion ? 0 : 1 // static grain when motion is reduced
  composer.addPass(film)
  const render = composer.render.bind(composer)
  composer.render = (dt) => { film.uniforms.uTime.value += dt || 0.016; render(dt) }
  return composer
}
