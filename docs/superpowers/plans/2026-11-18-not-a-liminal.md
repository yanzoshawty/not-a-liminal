# not-a-liminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web edukasi liminal space dengan 4 ruang 3D buatan Blender yang dijelajahi lewat scroll, bisa diklik, ada entity, loader tanpa bar, dan BGM generatif.

**Architecture:** Satu canvas WebGL fixed (Three.js) berisi 4 ruang GLB berjajar di sumbu −Z. GSAP ScrollTrigger men-scrub kamera di sepanjang `CatmullRomCurve3`. Teks edukasi berupa HTML statis di atas canvas. Klik ditangani dengan raycaster + `<dialog>`, dan ada tombol DOM sebagai cadangan untuk keyboard/remote.

**Tech Stack:** Vite, three, gsap (+ScrollTrigger), @fontsource, vitest (logic murni), Blender 4.5 via MCP (bpy), Vercel.

**Spec:** `docs/superpowers/specs/2026-11-18-not-a-liminal-design.md`

## Global Constraints

- Semua path relatif terhadap `not-a-liminal/`.
- **Claude tidak menjalankan `git commit`/`push`/`vercel`.** Command-nya ditulis untuk user di akhir (Task 7).
- Copy: bahasa Indonesia santai. Istilah Inggris (liminal space, Backrooms, entity, poolrooms, anemoia) tidak diterjemahkan.
- Mood eerie tanpa jumpscare: tidak ada suara keras, entity tidak pernah mendekati kamera.
- Entity orisinal: siluet tinggi kurus tanpa wajah.
- Tanpa script/font/CDN pihak ketiga saat runtime. CSP persis sesuai spec.
- BGM default mati. Preferensi di `localStorage` key `nal:sound`, dibungkus try/catch.
- Budget aset: total GLB ≤ 12 MB (high), tiap ruang ≤ 3 MB.
- `prefers-reduced-motion`: tanpa sway/parallax/flicker.

## Review Focus

1. HP dengan GPU lemah atau WebGL gagal: halaman tetap bisa dibaca (teks HTML tampil, ada pesan kecil). Test di Task 3.
2. `localStorage` diblokir (private mode): toggle suara tetap jalan tanpa error. Test di Task 6.
3. Klik hotspot saat kamera sedang tween, atau klik berulang cepat: tidak ada dua dialog, dan kamera kembali ke posisi scroll yang benar. Test di Task 5.
4. Resize/rotasi layar dan TV 4K: canvas dan tipografi menyesuaikan, DPR tetap dibatasi. Test di Task 3.
5. Tab disembunyikan: render loop dan audio berhenti. Test di Task 6.

---

### Task 1: Scaffold, loader, header keamanan

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/loader.js`, `src/quality.js`, `src/styles.css`, `vercel.json`, `.gitignore`
- Test: `tests/quality.test.js`

**Interfaces:**
- Produces: `pickTier({width, coarse, memory, cores}) -> 'high'|'low'`. `finishLoading(): Promise<void>` (fade-out overlay `#loader`, lalu `remove()`).

- [ ] **Step 1:** `npm create vite` (vanilla) di `not-a-liminal/`, lalu install `three gsap @fontsource-variable/inter @fontsource/ibm-plex-mono` dan dev `vitest`.
- [ ] **Step 2: Test gagal**
```js
expect(pickTier({width:390, coarse:true, memory:4, cores:6})).toBe('low')
expect(pickTier({width:1920, coarse:false, memory:8, cores:8})).toBe('high')
expect(pickTier({width:3840, coarse:false, memory:undefined, cores:4})).toBe('high') // TV: deviceMemory sering undefined
expect(pickTier({width:1440, coarse:false, memory:2, cores:2})).toBe('low')
```
- [ ] **Step 3:** Implementasi `pickTier`: low jika coarse, atau width < 1024, atau memory < 4, atau cores < 4. Selain itu high.
- [ ] **Step 4:** `npx vitest run`, hasilnya PASS.
- [ ] **Step 5:** `index.html` berisi loader inline (teks berkedip, CSS-only, tanpa bar), `<canvas id="world">`, `<main>` berisi semua section teks (diisi di Task 4), tombol `#sound`, dan `<dialog id="info">`. `vercel.json` berisi header CSP, nosniff, Referrer-Policy, Permissions-Policy, COOP sesuai spec, plus `Cache-Control: public, max-age=31536000, immutable` untuk `/assets/(.*)` dan `/models/(.*)`.
- [ ] **Step 6:** `npm run build` sukses, dan `dist/index.html` tidak berisi `<script>` inline (supaya CSP `script-src 'self'` valid).

### Task 2: Aset Blender (4 ruang + entity)

**Files:**
- Create: `blender/build_rooms.py` (bisa dijalankan ulang; satu fungsi per ruang), `public/models/{backrooms,pool,corridor,mall,entity}.glb`

**Interfaces:**
- Produces: setiap GLB punya node root bernama ruang. Hotspot = mesh dengan custom property `hotspot="<id>"` (diekspor ke `userData.hotspot`). Titik spawn entity = empty bernama `spot_*`. Origin ruang di (0,0,0), lantai y=0, kamera mengarah ke −Z, panjang ruang ±30 m.
- Hotspot id: backrooms `lamp, wallpaper, carpet`; pool `ladder, water, skylight`; corridor `door, locker, exit_sign`; mall `escalator, fountain, bench`.

- [ ] **Step 1:** `mcp__blender__get_scene_info`, lalu scene baru yang kosong. Pakai skill `liminal-space-style` dan `blender-export-pipelines`.
- [ ] **Step 2:** Modelkan tiap ruang secara procedural. Backrooms: labirin dinding kuning + panel neon. Pool: keramik putih + air + skylight. Corridor: lorong sekolah/hotel dengan pintu berjajar. Mall: atrium tutup dengan eskalator mati + air mancur kering.
- [ ] **Step 3:** Bake Cycles (Combined, ±64 samples + denoise) ke 1 atlas 2048 WebP per ruang. Material diganti emission/basecolor dari bake. Panel neon tetap mesh terpisah (`neon_*`) untuk bloom/flicker.
- [ ] **Step 4:** Entity: siluet tinggi (±2.4 m), kurus, tanpa wajah, satu material gelap.
- [ ] **Step 5:** Export glTF (meshopt, WebP) satu file per ruang. Verifikasi dengan `mcp__blender__look` per ruang, dan cek ukuran file ≤ budget.

### Task 3: Dunia 3D, kamera scroll, tier kualitas

**Files:**
- Create: `src/world.js`, `src/scroll.js`, `src/post.js`
- Test: `tests/scroll.test.js`

**Interfaces:**
- Consumes: `pickTier`, `finishLoading`, GLB dari Task 2.
- Produces: `createWorld(canvas, tier) -> {scene, camera, renderer, rooms: Object3D[], hotspots: Object3D[], spots: Vector3[], entity: Object3D, load(onRoom): Promise, start(), stop()}`. `segmentAt(progress:number, count:number) -> number` (index 0..count-1, di-clamp). `bindScroll(world) -> {lock(), unlock(), progress(): number}`.
- `ROOM_GAP = 60` (meter antar origin ruang).

- [ ] **Step 1: Test gagal:** `segmentAt(0,4)===0`, `segmentAt(0.999,4)===3`, `segmentAt(1,4)===3`, `segmentAt(-0.1,4)===0`, `segmentAt(0.26,4)===1`.
- [ ] **Step 2:** Implementasi `segmentAt` (`gsap.utils.clamp` + floor). Test harus PASS.
- [ ] **Step 3:** `createWorld`: renderer `antialias` hanya untuk high. DPR `min(devicePixelRatio, high?2:1.5)`. `FogExp2` dengan warna per ruang. GLTFLoader + MeshoptDecoder memakai `LoadingManager`. Ruang 0 di-await, sisanya dimuat di background dengan yield antar ruang. Pakai `compileAsync`. Jika `WebGLRenderer` throw: tambahkan class `no-webgl` di `<html>` dan tetap panggil `finishLoading()`.
- [ ] **Step 4:** `post.js` (khusus high): EffectComposer, UnrealBloomPass (strength rendah, threshold tinggi supaya hanya neon), lalu ShaderPass grain+vignette+chromatic ringan. Low: CSS grain overlay.
- [ ] **Step 5:** `bindScroll`: ScrollTrigger pada `<main>` dengan `scrub: 1.2` → `curve.getPointAt(p)` / `lookAt` titik sedikit di depan. Sway kecil dan parallax mouse (high), keduanya dimatikan saat reduced-motion lewat `gsap.matchMedia`. Pakai `gsap.ticker` untuk render, `quickTo` untuk parallax. Jeda saat `document.hidden`.
- [ ] **Step 6:** Resize: `ResizeObserver` → `setSize` + update aspect. Cek manual di 390×844, 1440×900, dan 3840×2160 (devtools): tidak ada scroll horizontal, dan DPR tetap dibatasi.

### Task 4: Konten & layout responsif

**Files:**
- Modify: `index.html` (section), `src/styles.css`
- Create: `src/hotspots.js`

**Interfaces:**
- Produces: `HOTSPOTS: Record<id, {title, body}>` (12 id dari Task 2), `ENTITY_INFO: {title, body}`.

- [ ] **Step 1:** Tulis section `hero`, `intro`, `seg-backrooms`, `seg-pool`, `seg-corridor`, `seg-mall`, `outro`. Setiap segment punya `data-room="0..3"`, tinggi `300svh`, dan kartu teks di awal. Teks santai sesuai spec. Sertakan asal Backrooms (postingan 4chan 2019) tanpa menyalin wiki.
- [ ] **Step 2:** Setiap segment punya `<div class="hotspot-list">` berisi `<button data-hotspot="id">` (fokusable, ukuran ≥44px) sebagai cadangan klik untuk keyboard/remote.
- [ ] **Step 3:** CSS: token warna di `:root`, `clamp()` untuk tipografi, dan skala naik di `@media (min-width:1920px)`. Kartu teks semi-transparan dengan backdrop blur (high) atau solid (low/no-webgl), maksimal 65ch. Ada safe-area padding dan `:focus-visible` yang tebal. `content-visibility` tidak dipakai di hero.
- [ ] **Step 4:** Cek `npm run build`, lalu preview di 3 ukuran dari Task 3 Step 6: teks terbaca dan tidak tertimpa elemen lain.

### Task 5: Interaksi klik & entity

**Files:**
- Create: `src/interact.js`, `src/entity.js`
- Test: `tests/entity.test.js`

**Interfaces:**
- Consumes: `world`, `bindScroll().lock/unlock`, `HOTSPOTS`, `ENTITY_INFO`.
- Produces: `nextSpot(currentIndex:number, count:number, rand:()=>number) -> number` (≠ current jika count>1). `initInteract(world, scroll)`.

- [ ] **Step 1: Test gagal:** dengan `rand` yang selalu mengembalikan nilai yang memetakan ke current, hasil tetap ≠ current. `count=1` → 0. Hasil selalu dalam range untuk 100 nilai acak.
- [ ] **Step 2:** Implementasi `nextSpot`. Test harus PASS.
- [ ] **Step 3:** `initInteract`: pointer → Raycaster pada `hotspots + entity`. Hover (pointer:fine) mengubah kursor menjadi pointer dan emissive naik sedikit. Klik hotspot: jika `busy` abaikan; jika tidak, `busy=true`, `scroll.lock()`, tween kamera mendekat ke objek (1.2 s, `power2.inOut`), jalankan reaksi objek sesuai id, lalu `dialog.showModal()` dengan info. Saat `close` (Esc/tombol): tween kembali ke titik kurva `scroll.progress()`, lalu `unlock()` dan `busy=false`. Tombol DOM `data-hotspot` memanggil handler yang sama.
- [ ] **Step 4:** Reaksi: lamp/neon flicker (timeline intensitas, dilewati jika reduced-motion), door geser, water riak (uniform), escalator bergerak 2 s, sisanya pulse emissive ringan.
- [ ] **Step 5:** Entity: opacity fade 0.8 s → pindah ke `spots[nextSpot(...)]` → fade-in perlahan setelah 4–8 s. Posisinya selalu ≥ 12 m dari kamera. Klik pertama juga menampilkan `ENTITY_INFO`.
- [ ] **Step 6:** Cek manual: klik cepat 5× tetap menghasilkan 1 dialog, dan setelah tutup posisi kamera cocok dengan scroll. Tab + Enter di tombol hotspot memberi hasil sama dengan klik.

### Task 6: BGM generatif

**Files:**
- Create: `src/audio.js`
- Test: `tests/audio.test.js`

**Interfaces:**
- Produces: `readSoundPref(storage) -> boolean`, `writeSoundPref(storage, on)` (keduanya aman jika storage throw). `createBgm() -> {start(), stop(), setRoom(i), get on()}`.

- [ ] **Step 1: Test gagal:** storage palsu yang `getItem` throw menghasilkan `false` tanpa exception. `setItem` throw tidak menghasilkan exception. Nilai `'1'` dibaca sebagai `true`.
- [ ] **Step 2:** Implementasi pref. Test harus PASS.
- [ ] **Step 3:** `createBgm`: `AudioContext` baru dibuat saat `start()` (gesture). Drone = 2 oscillator detune → lowpass 400 Hz. Hum = sine 60 Hz + harmonik sangat pelan. ConvolverNode dari impulse noise. Master gain fade-in 4 s ke 0.18. `setRoom` meng-crossfade wet reverb/filter (pool lebih basah, mall lebih dalam). `stop` fade-out 1 s lalu `suspend()`.
- [ ] **Step 4:** Tombol `#sound` (`aria-pressed`) men-toggle dan menyimpan pref. Jika pref true, mulai pada gesture pertama (pointerdown/keydown), bukan saat load. `visibilitychange` → suspend/resume. `segmentAt` berubah → `setRoom`.

### Task 7: Verifikasi & serah terima deploy

- [ ] **Step 1:** `npx vitest run` → semua PASS. `npm run build` → sukses. `npm audit --omit=dev` → 0 high/critical.
- [ ] **Step 2:** `npx vite preview`. Cek di browser: loader hilang otomatis, tidak ada error CSP/console, dan keempat ruang + entity + klik + suara berfungsi.
- [ ] **Step 3:** Skill blue-team: review `vercel.json` (CSP, header) dan pastikan tidak ada secret/aset sumber besar yang ikut ke `dist`.
- [ ] **Step 4:** Berikan command ke user (tidak dijalankan Claude): `git init`, `git add`, `git commit`, `gh repo create not-a-liminal --public --source . --push`, lalu import di Vercel / `vercel --prod`.
