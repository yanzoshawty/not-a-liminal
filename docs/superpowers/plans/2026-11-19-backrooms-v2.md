# not-a-liminal v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kamera lebih pelan, fokus objek tanpa tertutup teks, transisi noclip + glitch, 8+ props per ruang, barang glitch, dan 4 entity, tanpa merusak fitur v1.

**Architecture:** Aset tetap dibangun oleh `blender/build_rooms.py` (Blender 4.5 live via MCP, scene `nal_build`), di-bake ulang, lalu diekspor ke `src/models/`. Runtime three.js membaca tag `userData` (`hotspot`, `glitch`, `neon`, `spot_*`, `anchor_*`). Logika murni ada di `src/path.js` / `src/entities.js` / `src/glitch.js` dan di-test dengan vitest. Efek visual diverifikasi lewat screenshot Edge + playwright-core (skrip ada di scratchpad).

**Tech Stack:** Vite 8, three 0.187, gsap 3.15 (ScrollTrigger), vitest 5, Blender 4.5 + MCP.

**Spec:** `docs/superpowers/specs/2026-11-19-backrooms-v2-design.md` (di atas `2026-11-18-not-a-liminal-design.md`).

## Global Constraints

- Root: `not-a-liminal/`. Repo git `yanzoshawty/not-a-liminal` branch `main`. **Jangan push dan jangan deploy.** Commit lokal per task boleh, karena user menjalankan subagent-driven.
- Test: `powershell -NoProfile -Command "Set-Location 'C:\Users\yeet\OneDrive\Documents\yeet source project\not-a-liminal'; npx vitest run"`. Cwd dengan huruf `c:` kecil membuat vitest gagal.
- Mood eerie tanpa jumpscare. Tidak ada entity yang bergerak mendekati kamera. Tidak ada suara keras.
- CSP `vercel.json` tidak boleh diubah: tanpa inline script/style attribute, tanpa eval. Tekstur dibuat dengan `DataTexture` atau canvas.
- Copy: bahasa Indonesia santai, istilah Inggris tidak diterjemahkan.
- Budget: GLB ruang ≤ 3 MB, lightmap 2048, total `dist` ≤ 8 MB.
- Reduced motion dibaca live dari `motion.reduced`, objek `{ reduced, onChange: [] }` milik `main.js`.
- Batas ruang (three z): dinding di `-32, -60, -92, -120, -152, -180, -214`. Origin ruang r = `-r*60`. Panjang ruang: 32 m, kecuali mall 34 m.
- Entity: jarak fade default 20 m, hide 12 m. **Pengecualian Smiler** (berada di void sempit): fade 10 m, hide 6 m. Alasannya, void hanya ±26 m, sehingga dengan 20 m Smiler tidak pernah terlihat.

## Review Focus

1. Fokus objek dibuka saat `focus.blend` sedang tween, lalu jendela di-resize: view offset harus dihitung ulang/bersih dan objek tidak terpotong. Test ada di Task 3 (cek manual + playwright).
2. Kamera berhenti tepat di dalam dinding (scroll berhenti di z boundary): glitch tidak boleh membuat layar tak terbaca permanen, puncak intensitas maksimal sekitar 0.6 dari gelap total. Test ada di Task 1 (`noclip` maks 1, shader memetakannya ke 0.6) dan Task 4.
3. Tombol "Sosok" mati saat salah satu entity sedang fade-in: semua entity harus hilang dan tidak respawn. Test ada di Task 6.
4. Ruang yang streaming-nya belum selesai saat tombol hotspot glitch atau entity ditekan: dialog tetap muncul tanpa error. Test ada di Task 5/6.
5. HP (tier low): tanpa ghost clone dan tanpa shader glitch; overlay CSS noclip tidak boleh menghalangi klik (`pointer-events:none`). Test ada di Task 4/5.

---

### Task 1: Logika murni noclip + jalur kamera lebih pelan

**Files:** Modify `src/path.js`, `src/scroll.js` (SPEC + `quickTo`), `src/styles.css` (`.seg`). Test `tests/scroll.test.js`.

**Interfaces:**
- Produces: `BOUNDARIES = [-32, -60, -92, -120, -152, -180, -214]`, `noclip(z: number) => number` (0..1, puncak 1 di boundary, linear turun ke 0 pada jarak 2.5 m, diambil maksimum dari semua boundary).

- [ ] **Step 1:** Tulis test yang gagal: `noclip(-32)===1`, `noclip(-34.5)===0`, `noclip(-33.25)` ≈ 0.5, `noclip(-60)===1`, `noclip(-16)===0`, `noclip(-0.6)===0`, `noclip(-214)===1`.
- [ ] **Step 2:** Jalankan test, harus FAIL (`noclip` belum ada).
- [ ] **Step 3:** Implementasi di `path.js`.
- [ ] **Step 4:** Ubah `scroll.js`: setiap key `[r, 0.8, …]` menjadi `[r, 0.7, …]` (transisi memakan 30% akhir section), dan `quickTo` scroll duration 1.2 → 2.0. Di `styles.css`, `.seg { min-height: 420svh }`.
- [ ] **Step 5:** Jalankan semua test, harus PASS. Build `npx vite build` sukses. Commit `feat: slower camera path + noclip intensity`.

### Task 2: Blender: dinding solid, props 8+, barang glitch, model entity, lalu bake ulang

**Files:** Modify `blender/build_rooms.py`. Output: `src/models/{backrooms,pool,corridor,mall}.glb` + `_lm.webp` + `lightmaps.json`, `src/models/{tall,silhouette,partygoer}.glb`. Hapus `src/models/entity.glb`.

**Interfaces (dipakai Task 5/6):**
- Barang glitch: mesh terpisah dengan custom prop `glitch` ∈ `clip|float|double|missing` dan `hotspot` = `glitch_<tag>`. Setiap ruang punya tepat 1 mesh per tag (4 per ruang).
- Empty anchor: `anchor_silhouette` (corridor, di dalam pintu ujung yang terbuka, Blender (0, 32.3, 0)) dan `anchor_partygoer` (mall, di puncak eskalator, Blender (-5, 30.2, 4.5)). Spot `spot_*` Backrooms tetap ada.
- `partygoer.glb` punya node `head` (pivot di leher). Wajah kuning dengan mata dan senyum hitam lebar dibuat dari tekstur numpy. Semua entity: origin di kaki, menghadap −Y Blender.
- `tall.glb`: ±2.6 m, sangat kurus, tungkai panjang, sedikit membungkuk, kepala kecil, tanpa wajah. **Desain sendiri, bukan replika.** `silhouette.glb`: manusia biasa 1.75 m.

- [ ] **Step 1:** Ganti `end_wall(...)` di awal dan ujung setiap ruang dengan dinding solid (`wall(...)` penuh), **kecuali** ujung corridor yang tetap punya pintu 0.9 m.
- [ ] **Step 2:** Tambah props dari spec §4 (≥ 8 per ruang). Gabungkan per material dalam satu `Part` per ruang. Teks "DILARANG MENYELAM": `bpy.data.curves.new(type='FONT')` → convert to mesh.
- [ ] **Step 3:** Tambah 4 barang glitch per ruang. `clip`: setengah tertanam di dinding/lantai. `float`: ±0.4 m di atas lantai.
- [ ] **Step 4:** Tambah fungsi `tall()`, `silhouette()`, `partygoer()` sebagai ROOM target ekspor tanpa bake. Hapus target `entity`.
- [ ] **Step 5:** Jalankan semua target lewat MCP (`ROOM=...; exec(open(...).read())`). Verifikasi dengan `mcp__blender__look` (camera atau angles) per ruang dan per entity. Ukuran GLB per ruang harus ≤ 3 MB.
- [ ] **Step 6:** Commit `feat(assets): solid walls, props, glitch items, entity models`.

### Task 3: Fokus objek tanpa tertutup teks + zoom lebih pelan

**Files:** Modify `src/interact.js` (`focusOn`), `src/scroll.js` (ticker + `setFocus`), `src/styles.css`.

**Interfaces:**
- `scroll.setFocus(f)` dengan `f = { pos: Vector3, look: Vector3, blend: number, offX: number, offY: number }`. Ticker: kalau `f`, `camera.setViewOffset(w, h, f.offX*f.blend, f.offY*f.blend, w, h)`; kalau tidak, `camera.clearViewOffset()`.
- `html.focusing` aktif selama fokus.

- [ ] **Step 1:** Di CSS, `.focusing main .card, .focusing main .hotspot-list { opacity:0 !important; pointer-events:none; transition: opacity .4s }`. Dialog: `@media (min-width: 900px)` jadi panel kanan (`margin-right: 24px`, lebar ≤ 26rem); di bawah itu jadi bottom sheet (`margin-bottom: 0`, lebar 100%, max-height 42vh, radius atas saja). Backdrop transparan.
- [ ] **Step 2:** Di `focusOn`, ukur `dialog.getBoundingClientRect()` setelah `showModal`. Desktop: `offX = rect.width/2 + 12`, `offY = 0`. Mobile: `offX = 0`, `offY = rect.height/2`. Durasi blend masuk 2.2, keluar 1.8. Tambah/hapus `focusing` pada `<html>`.
- [ ] **Step 3:** Resize saat fokus: ukur ulang `offX/offY` di handler `resize`.
- [ ] **Step 4:** Verifikasi dengan playwright: klik `[data-hotspot="locker"]`, tunggu 2.5 s, screenshot 1600×900 dan 390×844. Objek harus terlihat di area kosong dan kartu section tidak terlihat. Esc mengembalikan `locked=false`. Test regresi yang ada tetap hijau. Commit `feat: focus framing beside the info panel`.

### Task 4: Efek noclip (shader, overlay, audio)

**Files:** Modify `src/post.js`, `src/scroll.js` (callback), `src/main.js`, `src/audio.js`, `src/styles.css`, `index.html` (`<div class="noclip" aria-hidden="true">`).

**Interfaces:**
- `bindScroll(world, { motion, fineMotion, onRoom, onNoclip })`. Setiap frame memanggil `onNoclip(noclip(camera.z))`.
- `world.composer.glitch = i` (high tier) → uniform `uGlitch`. Shader memetakan `i` ke maksimal 0.6 untuk gelap, dan melakukan displacement + RGB split + band statis. Saat `motion.reduced`, hanya gelap.
- Low tier: `document.documentElement.style.setProperty('--noclip', i)` (hanya saat berubah > 0.01). `.noclip { opacity: var(--noclip); pointer-events:none }` berisi scanline + noise.
- `sound.setNoclip(i)`: gain noise burst = `0.02 * i` (setTargetAtTime 0.05).

- [ ] **Step 1:** Implementasi.
- [ ] **Step 2:** Verifikasi: screenshot di section 2 frac 0.74 (sekitar dinding −32) pada tier high dan low. Glitch harus terlihat, dan di luar boundary layar harus bersih. Console tanpa error dengan CSP. Commit `feat: noclip glitch transition`.

### Task 5: Barang glitch runtime + hotspot glitch

**Files:** Create `src/glitch.js`. Modify `src/world.js` (kumpulkan `world.glitches`), `src/main.js`, `src/hotspots.js`, `src/interact.js` (tombol per ruang), `index.html`. Test `tests/glitch.test.js`.

**Interfaces:**
- `pickDelay(rand) => number` dalam [4, 9]. `checkerTexture() => DataTexture` (64×64, sel 8 px magenta `#ff00ff` dan hitam).
- `initGlitches(world, { motion, tier })`:
  - `float`: bob dan rotasi lewat `world.tick` tambahan, ditambahkan di samping hook yang sudah ada (jangan menimpa `world.tick` milik interact; gunakan array `world.ticks`).
  - `double`: hanya high tier.
  - `missing`: `material.map = checkerTexture()`.
- Tombol `data-hotspot="glitch_<tag>"` mencari objek di ruang section-nya: `world.hotspots.find(o => o.userData.hotspot===id && o.userData.room===Number(section.dataset.room))`.

- [ ] **Step 1:** Test yang gagal: `pickDelay(()=>0)===4`, `pickDelay(()=>0.999)` < 9 dan ≥ 8.9; `checkerTexture().image.data[0..2]` = 255,0,255 dan pixel (8,0) = 0,0,0.
- [ ] **Step 2:** FAIL → implementasi → PASS.
- [ ] **Step 3:** Ubah `world.tick` menjadi array `world.ticks`, lalu update `interact.js` dan `scroll.js`.
- [ ] **Step 4:** Copy: 4 entri `HOTSPOTS.glitch_clip|float|double|missing`, dan 1–2 tombol glitch per segment HTML.
- [ ] **Step 5:** Verifikasi dengan screenshot satu ruang (missing texture + float terlihat). Test hijau. Commit `feat: glitch items`.

### Task 6: Empat entity

**Files:** Create `src/entities.js`. Modify `src/interact.js` (hapus logika entity lama, panggil `initEntities`), `src/world.js` (load 3 GLB entity, kumpulkan `anchors`), `src/hotspots.js`, `index.html` (tombol + kredit outro). Test `tests/entity.test.js`.

**Interfaces:**
- `visibility(d, fade, min) => 'hide'|'fade'|'show'` (`d < min` → hide, `d < fade` → fade, selain itu show).
- `smilerZ(r) => -(r+1)*60 + 3`, untuk void setelah ruang r = 0..2.
- `initEntities(world, scroll, { motion }) => { vanish(id), setEnabled(on) }`. Id: `tall`, `smiler`, `silhouette`, `partygoer`. Smiler adalah 3 plane emissive (2 mata + senyum) dengan `fog:false`, dibuat di JS.
- Info: `ENTITIES = { tall, smiler, silhouette, partygoer }` di `hotspots.js` (masing-masing `{title, body}`). `ENTITY_INFO` lama dihapus; tombol `data-hotspot="entity"` diganti `data-entity="<id>"`.
- Tombol `#entity-toggle` → `setEnabled`.

- [ ] **Step 1:** Test yang gagal: `visibility(30,20,12)==='show'`, `visibility(15,20,12)==='fade'`, `visibility(5,20,12)==='hide'`, `smilerZ(0)===-57`, `smilerZ(2)===-177`.
- [ ] **Step 2:** FAIL → implementasi `entities.js` → PASS. `tall` memakai `chooseSpot` yang sudah ada (spot Backrooms). `silhouette` dan `partygoer` memakai anchor tetap; kepala partygoer `head.lookAt(camera)` dibatasi ±60°. `tall` jitter: setiap 0.8–2 s posisi bergeser ±0.15 m selama 2 frame (mati saat reduced). Semua: klik → vanish → respawn setelah kamera ganti ruang.
- [ ] **Step 3:** Copy + tombol: Backrooms "Sosok di kejauhan" (`tall`), Poolrooms "Mata di kegelapan" (`smiler`), Lorong "Siluet di ujung lorong", Mall "Sosok berwarna kuning". Kredit outro sesuai spec §6.
- [ ] **Step 4:** Verifikasi: playwright, toggle Sosok mati saat fade-in → tidak ada entity yang terlihat setelah 10 s (cek `visible` via screenshot); semua tombol entity membuka dialog; screenshot partygoer + siluet. Test hijau. Commit `feat: four backrooms entities`.

### Task 7: Verifikasi akhir

- [ ] **Step 1:** Test PASS, build sukses, `npm audit --omit=dev` 0, ukuran `dist` ≤ 8 MB.
- [ ] **Step 2:** Jalankan ulang skrip scratchpad `interact.mjs`, `a11y.mjs`, `features.mjs`, `nowebgl.mjs` dengan header production. Semua lulus, console bersih.
- [ ] **Step 3:** Screenshot tiap ruang di 1600×900, 390×844, dan 3840×2160.
