import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// `vite preview` serves the same security headers as Vercel, so CSP breakage shows up locally.
// upgrade-insecure-requests and HSTS are dropped because preview runs on plain http://localhost.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
const headers = Object.fromEntries(
  vercel.headers[0].headers
    .filter((h) => h.key !== 'Strict-Transport-Security')
    .map((h) => [h.key, h.value.replace(/;\s*upgrade-insecure-requests/, '')]),
)

export default defineConfig({
  preview: { headers },
})
