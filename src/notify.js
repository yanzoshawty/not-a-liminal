// Small polite toast (role=status) for "your browser can't do X" messages.
let timer = 0
export function notify(text, ms = 6000) {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = text
  el.classList.add('show')
  clearTimeout(timer)
  timer = setTimeout(() => el.classList.remove('show'), ms)
}
