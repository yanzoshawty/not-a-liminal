# not-a-liminal v2 — Noclip, props, glitches, entities

Tanggal: 2026-11-19 · Status: menunggu approval · Membangun di atas `2026-11-18-not-a-liminal-design.md` (semua constraint lama tetap berlaku kecuali yang diubah di sini).

## Intent

Feedback user setelah melihat versi live:

1. Kamera terlalu cepat, baik saat scroll maupun saat zoom ke objek.
2. Saat objek diklik, objeknya tertutup teks sehingga tidak bisa dinikmati.
3. Transisi antar bangunan harus ala film Backrooms: noclip menembus dinding.
4. Tiap level harus lebih ramai, 8+ objek per ruang.
5. Entity lebih banyak, mirip referensi Backrooms.
6. Ada barang-barang glitch.

Mood tetap **eerie tanpa jumpscare**.

## Keputusan user (dari tanya-jawab)

| Topik | Pilihan |
|---|---|
| Kecepatan | Dua-duanya diperlambat: travel saat scroll dan zoom saat klik |
| Fokus objek | Teks minggir, objek di tengah |
| Transisi | Noclip menembus dinding + glitch VHS |
| Entity | Satu per ruang: Backrooms = sosok tinggi glitch (terinspirasi film Kane Pixels, desain sendiri); transisi/void = Smiler (wiki CC BY-SA); lorong = siluet di pintu ujung; mall = Partygoer (wiki CC BY-SA); poolrooms kosong |
| Glitch | Keempatnya: nyangkut di dinding/lantai, melayang & berputar, berkedip ganda, tekstur rusak |
| Keramaian | Banyak, 8+ objek per ruang |
| Mood | Tetap eerie, tanpa jumpscare; entity tidak pernah mendekat |
| Cara build | A: semua objek dibuat di Blender, lalu ruangan di-bake ulang |

## Goals / non-goals / anti-goals

- **Goals:** semua butir di atas.
- **Non-goals:** suara stinger atau jumpscare, entity yang mengejar, mode jalan bebas.
- **Anti-goals:**
  - meniru persis creature dari film Kane Pixels (berhak cipta);
  - objek baru terlihat "tempelan" tanpa bayangan bake;
  - HP jadi lag;
  - teks kembali menutupi objek yang sedang difokus.

## Approaches

| | Cara | Trade-off |
|---|---|---|
| **A (dipilih)** | Props, entity, dan glitch prop dimodelkan di `blender/build_rooms.py`. Keempat ruang di-bake ulang. Efek glitch runtime dijalankan di three.js pada mesh yang di-tag. | Visual menyatu dan tetap ringan. Bake ulang memakan ±4–5 menit, dan Blender user sibuk selama itu. |
| B | Props dibuat dari primitive three.js dengan lampu realtime | Blender tidak disentuh, tapi objek tanpa bayangan bake terlihat tempelan dan lampu realtime berat di HP. |

## Desain

### 1. Kamera lebih pelan
- Section segment naik dari `300svh` ke `420svh`. Travel di dalam ruang sama panjangnya, tapi scroll-nya lebih panjang.
- Transisi antar ruang (noclip + void) memakan 30% akhir section, naik dari 20%.
- `quickTo` scroll: 1.2 s → **2.0 s** (glide lebih berat).
- Zoom fokus: masuk **2.2 s**, keluar **1.8 s**, ease `power2.inOut`.

### 2. Fokus objek tanpa tertutup teks
- Saat fokus, `html.focusing` membuat semua `.card` dan `.hotspot-list` memudar (opacity 0, `pointer-events: none`, 0.4 s).
- Dialog info menjadi **panel samping** di desktop/TV (kanan, ≤ 26rem, vertikal tengah) dan **bottom sheet** di HP (≤ 42vh).
- Objek dibingkai di ruang yang tersisa lewat `camera.setViewOffset`. Projeksinya digeser setengah lebar panel (desktop) atau setengah tinggi sheet (HP), dan pergeserannya di-blend mengikuti `focus.blend`. Hasilnya, objek berada di tengah area yang tidak tertutup.

### 3. Transisi noclip
- Dinding ujung dan awal setiap ruang dibuat **solid** (tanpa pintu). Jalur kamera menembus dinding di x = 0. Pengecualian: pintu ujung lorong tetap terbuka sebagai tempat siluet berdiri; kamera melewati pintu itu dan efek noclip tetap aktif di batas ruang.
- `noclip(z)` = intensitas 0..1, puncaknya saat kamera berada ±2.5 m dari bidang dinding batas ruang (pure function, di-test).
- **High tier:** `FilmShader` mendapat `uGlitch`: displacement garis horizontal, RGB split, band statis, dan sedikit gelap.
- **Low tier:** overlay CSS `.noclip` (scanline + static), opacity-nya mengikuti intensitas.
- **Reduced motion:** tanpa displacement atau animasi, hanya fade gelap.
- **Audio:** saat suara nyala, burst noise ter-filter yang sangat pelan mengikuti intensitas (+0.02 gain maksimal).
- Void gelap antar ruang tetap ada ("ruang di antara level"), tempat Smiler muncul.

### 4. Props (8+ per ruang, dimodelkan di Blender, di-bake bersama ruang)
- **Backrooms:** 2 kursi kantor, water cooler, 3 kardus, ember, lemari arsip, gulungan kabel, papan "lantai basah".
- **Poolrooms:** 2 pelampung, 2 kursi lipat, handuk, kursi lifeguard, papan pelampung, papan "DILARANG MENYELAM" (teks dari text-object Blender yang dikonversi ke mesh).
- **Lorong:** 2 tempat sampah, papan pengumuman, 2 tabung pemadam, jam dinding berhenti, keran minum, bangku, ember pel.
- **Mall:** 2 troli, 2 manekin, gerobak kios tertutup, 2 tanaman palsu, papan direktori, tempat sampah, papan "lantai basah".
- Props yang materialnya sama digabung per ruang supaya draw call tetap rendah. Total per GLB ≤ 3 MB.

### 5. Barang glitch
Di-tag lewat custom property `glitch` di Blender, lalu dijalankan di three.js.

| tag | Dibuat di | Perilaku |
|---|---|---|
| `clip` | Blender | Objek setengah tertanam di dinding atau lantai (statis, di-bake) |
| `float` | three | Bob ±0.08 m + rotasi sangat pelan (reduced motion: diam di posisi bake) |
| `double` | three | Tiap 4–9 s objek bergetar 0.3 s dan muncul ghost clone transparan yang bergeser. Hanya di high tier; mati di reduced motion |
| `missing` | three | Map diganti tekstur checker magenta-hitam (DataTexture), lightmap tetap dipakai |

Tiap ruang punya 1–2 barang untuk setiap tag.

### 6. Entity (satu per ruang, semua mengikuti aturan "tidak pernah mendekat")
Satu modul entity yang umum. Setiap entity punya: model, ruang, titik (spots atau anchor tetap), jarak fade (default 20 m), jarak minimum 12 m (di bawah itu langsung disembunyikan), dan info card sendiri.

| Entity | Ruang | Model | Perilaku |
|---|---|---|---|
| Sosok tinggi | Backrooms | Mesh Blender: ±2.6 m, sangat kurus, tungkai panjang tak proporsional, sedikit membungkuk, kepala kecil. Desain sendiri yang *terinspirasi*, bukan replika | Sama seperti entity sekarang (spots, fade, respawn tidak lebih dekat). Ditambah jitter glitch: posisi meloncat kecil beberapa frame sekali (mati di reduced motion) |
| Smiler | Void antar ruang | Bukan mesh: dua mata + senyum lebar emissive (plane, `fog:false`) | Muncul di tengah void di depan kamera, berkedip pelan, memudar saat kamera ≤ 20 m |
| Siluet | Lorong | Mesh Blender: siluet manusia biasa di pintu ujung yang terbuka gelap | Anchor tetap. Memudar saat kamera ≤ 20 m. Kalau diklik, hilang lalu kembali setelah kamera keluar ruang |
| Partygoer | Mall | Mesh Blender: tubuh kuning gaya kostum, kepala bulat, wajah tersenyum lebar (tekstur) | Anchor tetap di atas eskalator. Kepala menoleh mengikuti kamera. Klik untuk menghilang |

- Perilaku "kadang di ambang ruang berikutnya" dari v1 **dihapus**. Dinding yang solid membuat garis pandang itu tidak ada lagi, dan perannya diambil alih Smiler di void.
- Tombol "Sosok" menyembunyikan **semua** entity.
- Tombol hotspot DOM untuk setiap entity (supaya bisa diakses keyboard/remote): Backrooms "Sosok di kejauhan", Poolrooms "Mata di kegelapan" (Smiler di void sebelum pool), Lorong "Siluet di ujung lorong", Mall "Sosok berwarna kuning".
- **Kredit di outro:** "Smiler dan Partygoer berasal dari Backrooms Wiki (CC BY-SA 3.0). Sosok tinggi terinspirasi dari serial The Backrooms karya Kane Parsons (Kane Pixels); desainnya dibuat sendiri."

### 7. Copy
Info card baru untuk setiap entity dan untuk 4 barang glitch, satu per tag (misalnya "Kursi yang nyangkut"). Barang glitch bisa diklik sebagai hotspot. Bahasanya santai, istilah Inggris tidak diterjemahkan.

## Constraints (lanjutan)
- Commit dan deploy tetap dijalankan user (memori `review-before-deploy`). Deploy kemarin adalah pengecualian atas permintaan eksplisit.
- CSP tidak berubah. Tekstur checker dan wajah dibuat dengan DataTexture/canvas, yang aman di bawah `img-src blob: data:`.
- Budget: GLB per ruang ≤ 3 MB, lightmap 2K per ruang, total `dist` ≤ 8 MB.
- Test vitest tetap dijalankan dari path `C:\` huruf besar.

## Diserahkan ke builder
- Posisi persis props dan glitch.
- Bentuk detail model.
- Kurva intensitas noclip.
- Detail shader glitch.
- Kata-kata final info card.
