# Morse SOS Flashlight — Fabaro
Aplikasi web PWA untuk mengirim sandi Morse menggunakan **torch** (lampu kamera) bila didukung, serta **kedipan layar** dan **bunyi bip** sebagai fallback. Cocok untuk tombol **SOS** dan pesan darurat lainnya.

## Fitur
- Input teks → otomatis encode ke Morse
- Tombol cepat **SOS**
- Pengaturan **WPM** (kecepatan)
- Opsi **Torch**, **Screen Flash**, **Beep**, dan **Loop**
- **Wake Lock** (layar tidak mati saat pemutaran)
- **Vibration** kecil per ketukan (jika tersedia)
- **PWA**: offline, installable
- Tampilkan **koordinat lokasi** (opsional)

## Kompatibilitas
- Torch di web hanya bekerja di sebagian perangkat **Android (Chrome)** dengan kamera belakang yang mendukung.
- **iOS/Safari**: gunakan **kedipan layar + beep** (torch tidak tersedia di web).
- Untuk kontrol torch yang 100% pasti, pertimbangkan aplikasi native (Android/Kotlin).

## Struktur
```
/index.html
/app.js
/manifest.webmanifest
/sw.js
/icons/icon-192.png
/icons/icon-512.png
```

## Deploy Cepat (Vercel / Static Hosting)
1. Upload semua file ini ke repo GitHub, mis. `fabaro-morse-sos`.
2. Deploy ke **Vercel** sebagai **framework: Other / Static**.
3. Pastikan path file tepat dan `start_url` tetap `/`.

## Lokal Testing
- Jalankan server statis (contoh dengan `npx serve .`) lalu buka di perangkat **Android** dengan Chrome.
- Izinkan akses **kamera** saat diminta untuk tes **Torch**.
- Tekan **KIRIM SOS** atau **FLASH MORSE**.

## Catatan WPM
Rumus unit durasi: `unit(ms) = 1200 / WPM`.
- Titik (.) = 1 unit
- Garis (-) = 3 unit
- Jeda antar simbol = 1 unit (OFF)
- Jeda antar huruf = 3 unit (OFF)
- Jeda antar kata = 7 unit (OFF)

---
© 2025 Fabaro • mukemen.ai
