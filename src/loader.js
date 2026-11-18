// Fade the loader out once the first room is ready; no button, straight to the landing.
export function finishLoading() {
  const el = document.getElementById('loader')
  if (!el) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { el.remove(); resolve() }
    el.addEventListener('transitionend', done, { once: true })
    setTimeout(done, 1600) // transitionend never fires when reduced-motion/hidden tab skips it
    el.classList.add('done')
  })
}
