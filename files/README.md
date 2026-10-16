# LAPO KOMBAT

Game lapo virtual multipemain. Pemain **mendaftar** (nama asli, nama karakter, marga/boru wajib), **membuat karakter**, lalu muncul di dunia. Dunia kosong sampai ada pemain yang masuk.

## Pesan makanan dan minuman
Duduk di kursi lalu tekan **O** (atau tombol 🍽️ di bawah). Pilih menu:
- Makanan: Babi Panggang, Saksang, Daun Singkong Tumbuk, Sop Babi, Nasi Goreng Babi, Mie Goreng Babi (disajikan di piring).
- Minuman: Tuak, Air Es, Mandi, Badak, Teh Manis Hangat (disajikan dengan gelas dan botol).

Barista menyiapkan pesanan, lalu salah satu dari 3 pengantar membawanya dengan nampan ke mejamu. Di mode online, pesanan semua pemain terlihat oleh semua orang. Harga di menu hanya tampilan (bisa diubah di daftar `MENU`).

## Coba langsung (mode offline)
Klik dua kali `lapo-kombat.html` untuk membukanya di Chrome, Edge, atau Firefox. Tidak perlu server dan tidak perlu internet.

1. Isi nama asli, nama karakter, dan marga/boru, lalu buat karakter.
2. Tekan **Main Offline**.
3. Untuk melihat suasana ramai, buka **Opsi lanjutan** lalu pilih jumlah pemain contoh (bot): 8, 30, atau 100.

Di mode offline Anda bisa jalan, duduk, mengambil kopi, chat (hanya terlihat sendiri), emote, dan memutar 6 lagu bawaan. Lagu dari perangkat juga bisa. Fitur yang butuh internet: musik YouTube, serta suara/kamera dan multipemain (mode online).

## Jalankan server di komputer sendiri
```
npm install
npm start
```
Buka http://localhost:3000. Alamat halaman admin (daftar pendaftar) tercetak di terminal.

## Agar 100+ perangkat bisa main bersamaan
Game ini butuh **server** yang online (bukan hanya file HTML), karena semua pemain disambungkan lewat server. Satu server menyajikan game sekaligus menyinkronkan pemain, jadi cukup bagikan satu alamat.

1. Unggah folder ini ke layanan hosting Node.js (Render, Railway, Fly.io, atau VPS).
2. Perintah build: `npm install`, perintah start: `npm start`.
3. Pastikan layanan mendukung **WebSocket** dan memakai HTTPS (Render, Railway, dan Fly sudah otomatis).
4. Bagikan alamatnya, misalnya `https://lapo-kombat.onrender.com`.
5. Tentukan `ADMIN_KEY` sendiri di environment variable supaya alamat admin tidak berubah tiap restart.

Pengaturan (environment variable):

| Nama | Fungsi | Bawaan |
|---|---|---|
| `PORT` | port server | 3000 |
| `MAX_PLAYERS` | batas pemain per room | 400 |
| `ADMIN_KEY` | kunci halaman admin | acak tiap start |
| `DATA_DIR` | folder penyimpanan pendaftaran | `./data` |

**Penting:** pendaftaran disimpan di `DATA_DIR/registrations.json`. Di hosting gratis yang disknya dihapus saat restart, pasang disk persisten atau pendaftaran ikut hilang.

## Halaman admin
- Daftar pendaftar: `https://alamat-kamu/admin?key=ADMIN_KEY`
- Unduh CSV: `https://alamat-kamu/admin.csv?key=ADMIN_KEY`
- Cek kesehatan server: `/healthz`

Nama asli hanya terlihat oleh admin. Pemain lain hanya melihat nama karakter dan marga/boru.

## Hasil uji beban (server di satu mesin, klien simulasi)
| Klien | Berhasil masuk | CPU server | Unduhan per klien (semua terus bergerak) |
|---|---|---|---|
| 150 | 150 | sekitar 6% satu inti | 18 KB/s |
| 300 | 300 | sekitar 13% satu inti | 37 KB/s |

Pemain yang diam hampir tidak memakai bandwidth. Pada 100 pemain yang semuanya bergerak terus, siapkan keluaran sekitar 2 sampai 4 MB/s dari server.

## Aturan dan batasan
- Nama karakter harus unik. Satu perangkat satu akun (disimpan di browser). Membuka dari tab/perangkat lain dengan data yang sama akan mengeluarkan sesi lama.
- Pendaftaran tidak memakai password atau verifikasi, jadi nama asli tidak dicek keasliannya.
- Suara dan kamera memakai WebRTC antar-pemain **hanya ke pemain terdekat** (maks. 5 suara, 3 kamera dalam radius 10 m) supaya tetap lancar saat ramai. Fitur ini memakai server PeerJS publik untuk penghubung.
- Musik YouTube dan lagu dari perangkat hanya terdengar di perangkat masing-masing.
