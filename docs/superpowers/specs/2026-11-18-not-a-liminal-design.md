# not-a-liminal — Design

Tanggal: 2026-11-18 · Status: menunggu approval

## Intent

Web edukasi yang menjelaskan **liminal space** dengan bahasa santai dan friendly (istilah Inggris tetap Inggris). Pembaca tidak cuma membaca, tapi juga "berjalan" melewati 4 ruang liminal 3D buatan Blender. Antar ruang dibuat lega supaya visualnya bisa dinikmati pelan-pelan. Mood-nya **eerie tanpa jumpscare**: sunyi, ganjil, merinding pelan.

## Goals

- Menjelaskan liminal space: apa itu, kenapa terasa aneh, dan contohnya.
- 4 segment 3D: **Backrooms Level 0**, **kolam renang kosong (poolrooms)**, **lorong sekolah/hotel**, **mall/parkiran sepi**.
- Objek 3D bisa diklik. Klik memicu info singkat, reaksi objek, kamera mendekat, dan entity merespons.
- Entity bergaya Backrooms yang muncul jauh dan diam. Kalau diklik, dia menghilang lalu muncul di tempat lain.
- Loading page **tanpa loading bar**. Setelah selesai langsung masuk landing tanpa tombol.
- BGM ambient yang tidak mengganggu dan bisa dimatikan.
- Responsif dari smartphone sampai TV. Di **desktop dan TV visualnya paling memanjakan mata**.

## Non-goals

- Tidak ada backend, akun, database, atau analytics.
- Tidak ada mode jalan bebas (WASD/first-person). Kamera mengikuti scroll.
- Tidak ada konten lore Backrooms yang disalin dari wiki. Teks ditulis sendiri.

## Anti-goals (gagal walaupun "jalan")

- Lag atau crash di HP.
- Ada suara tiba-tiba keras, atau ada jumpscare.
- Teks susah dibaca di atas visual 3D.
- Entity meniru entity spesifik dari Backrooms wiki (misalnya Smiler atau Hound). Entity-nya harus desain orisinal: siluet tinggi kurus tanpa wajah.

## Constraints

- Folder: `not-a-liminal/` (repo git sendiri). Deploy lewat GitHub → Vercel. **User sendiri yang menjalankan commit dan deploy.** Claude hanya memberi command-nya.
- Guidance browser: GoogleChrome/modern-web-guidance (lihat bagian Performance).
- Blender 4.5 LTS live via MCP. Library aset dan generator AI **off**, jadi semua model dibuat procedural lewat bpy.
- BGM tidak boleh pakai file berhak cipta. Suara dibuat dengan Web Audio API.

## Approaches

| | Cara | Trade-off |
|---|---|---|
| **A (dipilih)** | Satu canvas WebGL fixed. 4 ruang disusun di satu dunia. Kamera berjalan saat scroll (GSAP ScrollTrigger). Teks overlay di atas. | Imersif dan cuma 1 WebGL context (aman di HP). Layout teks harus disinkronkan dengan kamera. |
| B | Canvas terpisah per segment, lazy-init. | Layout-nya mudah, tapi banyak WebGL context sehingga crash/lag di HP & TV murah, dan kurang terasa "masuk ruangan". |
| C | Render diam Cycles + sedikit 3D. | Paling cantik dan ringan, tapi interaksi klik terbatas. Bertentangan dengan 4 jenis interaksi yang diminta. |

User memilih **A**, dengan catatan visual desktop/TV harus lebih memanjakan mata.

## Desain

### Stack (keputusan Claude)
Vite + vanilla JS + `three` + `gsap` (core + ScrollTrigger). Font di-self-host lewat `@fontsource` (tanpa Google Fonts, supaya CSP ketat). Tanpa framework UI, karena halamannya statis dan semua logika ada di 3D.

### Struktur halaman
1. **Loader**: overlay full-screen. Teks pendek berkedip seperti lampu neon (misalnya "kamu pernah ke sini sebelumnya…") dengan dengung visual halus. Tanpa bar dan tanpa persen. Selesai saat `THREE.LoadingManager.onLoad` jalan dan font siap, lalu fade-out otomatis ke landing.
2. **Landing / hero**: judul "not-a-liminal", satu kalimat pembuka, dan hint scroll. Kamera berdiri di ujung lorong Backrooms.
3. **Intro**: "Apa itu liminal space?" (ruang transisi, ruang yang kehilangan fungsinya, nostalgia, anemoia).
4. **4 segment**, masing-masing ±300vh scroll supaya lega:
   - Backrooms Level 0, termasuk asal-usulnya (postingan 2019) dan tempat entity paling sering terlihat.
   - Kolam renang kosong.
   - Lorong sekolah/hotel.
   - Mall/parkiran sepi.

   Di tiap segment: 1–2 kartu teks muncul di awal, lalu ada ruang kosong panjang tanpa teks khusus untuk menikmati visual.
5. **Penutup**: kenapa otak kita bereaksi begitu, ajakan memperhatikan liminal space di dunia nyata, dan kredit.

### Dunia 3D
- Keempat ruang disusun berurutan di sumbu −Z, berjarak jauh. Di antaranya ada koridor gelap/fog sebagai "transisi" (sesuai tema liminal).
- Kamera mengikuti `CatmullRomCurve3` yang di-scrub oleh ScrollTrigger, ditambah sway kecil supaya terasa hidup.
- Aset: 1 GLB per ruang, dibuat procedural di Blender. **Lighting di-bake (Cycles) ke tekstur** sehingga di web cukup pakai `MeshBasicMaterial`: murah tapi terlihat realistis. Diekspor dengan kompresi meshopt dan tekstur WebP. Ruang berikutnya dimuat bertahap (ruang 1 saat loader, sisanya di background).
- Tiap ruang punya 3–5 **hotspot**, yaitu objek dengan `userData.info` (contoh: lampu neon, pintu, kursi plastik, tangga kolam, eskalator mati).

### Interaksi klik
- Raycaster pada hotspot dan entity. Kursor berubah dan objek sedikit glow saat di-hover (desktop).
- Klik hotspot akan:
  1. Menggerakkan kamera mendekat (GSAP tween, scroll dikunci sementara).
  2. Membuat objek bereaksi (lampu berkedip, pintu bergeser, air beriak, eskalator bergerak sebentar).
  3. Membuka kartu info (`<dialog>`). Tombol "Kembali" / Esc menutup kartu dan kamera kembali ke jalur.
- Klik entity: dia memudar, lalu muncul lagi di titik lain yang jauh, kadang di ruang berikutnya. Tanpa suara keras dan tanpa mendekat.
- **Aksesibilitas**: setiap hotspot juga punya tombol DOM tersembunyi-tapi-fokusable di kartu segment. Pengguna keyboard, screen reader, dan remote TV (panah/Enter) mendapat interaksi yang sama.

### Kualitas visual per perangkat
Ditentukan sekali saat start dari lebar layar, `pointer: coarse`, `deviceMemory`, dan `hardwareConcurrency`:
- **High (desktop & TV)**: DPR sampai 2, post-processing (bloom halus di lampu neon, film grain, vignette, sedikit chromatic aberration), fog berlapis, tekstur 2K, motion parallax dari mouse.
- **Low (HP/tablet)**: DPR ≤ 1.5, tanpa bloom, grain lewat CSS overlay, tekstur di-downscale.
- Render dijeda saat tab tersembunyi atau canvas tidak terlihat.
- `prefers-reduced-motion`: tanpa sway/parallax/flicker. Kamera tetap mengikuti scroll, tapi tanpa easing panjang.

### Responsif (HP → TV)
Tipografi pakai `clamp()`, bisa membesar di layar ≥1920px (jarak pandang TV). Lebar baca maksimal ~65ch. Ada safe-area inset. Tap target ≥ 44px. Focus ring jelas untuk navigasi remote.

### BGM
Dibuat dengan Web Audio: drone low-pass, dengung lampu neon 50/60 Hz yang sangat pelan, dan reverb dari impulse noise. Volume rendah dengan fade-in 4 detik. Variasi halus mengikuti ruang (poolrooms lebih bergema, parkiran lebih dalam).
- **Keputusan Claude:** default **mati**. Tombol "Nyalakan suara" selalu terlihat di pojok. Browser memblokir autoplay, dan suara mendadak bertentangan dengan "tidak mengganggu". Pilihan user disimpan di `localStorage` (dibungkus try/catch).
- Dijeda otomatis saat tab disembunyikan.

### Performance (modern-web-guidance)
- Loader shell murni HTML/CSS inline supaya langsung tampil (LCP). JS three/gsap dimuat sebagai module (deferred).
- Kerja berat (parse GLB, compile shader) dipecah. Pakai `renderer.compileAsync` dan yield antar ruang supaya INP aman.
- Hanya font utama yang di-preload (woff2, `crossorigin`), dan di-subset latin.
- Tanpa CLS: overlay teks posisinya tetap, ukuran canvas fixed.
- Cache: aset ber-hash `Cache-Control: public, max-age=31536000, immutable`. HTML default Vercel. Tidak ada `no-store`.

### Security hardening (blue-team, via `vercel.json` headers)
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic, geolocation, dll. = ()), `Cross-Origin-Opener-Policy: same-origin`.
- Tanpa script pihak ketiga dan tanpa CDN. Dependensi dikunci di `package-lock.json`, dan `npm audit` dijalankan sebelum deploy.

### Repo & deploy
- `not-a-liminal/` berisi `index.html`, `src/`, `public/models/`, `blender/` (script bpy untuk regenerasi aset), dan `vercel.json`.
- Claude menyiapkan semuanya, lalu memberi command `git init / add / commit / push` dan import project di Vercel (atau `vercel --prod`). User yang menjalankan.

## Diserahkan ke builder
- Copywriting final per segment (nada santai, akurat).
- Detail model dan palet warna per ruang.
- Posisi persis hotspot dan jalur kamera.
- Ambang angka untuk tier kualitas.
