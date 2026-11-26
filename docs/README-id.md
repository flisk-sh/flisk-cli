# Flisk: seluruh aplikasi Anda berjalan di komputer Anda dengan satu perintah

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | Bahasa Indonesia | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk adalah alat baris perintah untuk pengembangan lokal. Flisk menjalankan setiap bagian aplikasi Anda (API, situs web, worker, agen AI, database) di komputer Anda di balik satu alamat lokal, dan memuat ulang sebuah bagian saat Anda menyimpannya. Anda mendeskripsikan tiap bagian dalam `service.json` kecil; dari file itu Flisk menulis Dockerfile, file Compose, dan Tiltfile, lalu menjaganya tetap sinkron. Flisk tidak melakukan deploy: produksi tetap ditangani alat Anda sendiri.

Mulai cepat:

```bash
npx @flisk-sh/flisk@latest demo
```

Ingin memilih stack sendiri? Jawab beberapa pertanyaan dengan tombol panah dan Enter:

```bash
npx @flisk-sh/flisk create
```

```bash
mkdir my-shop && cd my-shop
flisk project --yes
flisk resource orders-api --type backend --stack shop --yes
flisk resource shop-web --type frontend --stack shop --yes
flisk up shop
```

## Prasyarat (instal sekali)

| Alat | Versi | Instalasi | Diperlukan untuk |
|------|---------|---------|------------|
| **Runtime aplikasi Anda** | apa pun yang digunakan aplikasi Anda | Node.js, Python, Go, Bun, ... | Setiap jalur: menjalankan kode Anda |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Instalasi dengan npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Hanya untuk jalur Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: jalur Docker + Tilt berjalan di Ubuntu pada WSL2, jadi gunakan baris Linux di sana; instalasi PowerShell native: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Hanya untuk jalur Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Instalasi dengan Bun (`bun add -g @flisk-sh/flisk`) atau layanan JavaScript yang dihasilkan |

> **Dua cara menjalankan.** Proyek yang setiap layanannya mendeklarasikan `command` menjalankannya sebagai proses lokal: Anda hanya perlu Flisk dan runtime aplikasi Anda ([jalur paling sederhana](start/simplest.md)). Database, satu alamat untuk setiap layanan, atau container yang sama dengan yang Anda deploy memerlukan [Docker](start/words.md#docker) dan Tilt. `flisk doctor` hanya memeriksa apa yang digunakan proyek Anda.

Langkah menyiapkan komputer Anda: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Instalasi

Instal CLI dengan npm:

```bash
npm install -g @flisk-sh/flisk
```

Periksa dengan `flisk --version`: perintah ini mencetak nomor versi. Lalu periksa komputer Anda:

```bash
flisk doctor
```

`flisk doctor` hanya memeriksa apa yang digunakan proyek Anda dan menunjukkan cara memperbaiki apa pun yang kurang.

Cara instalasi lain: [Bun](install/bun.md) | [binari siap pakai, tanpa Node.js atau Bun](install/binary.md) | [image container](install/container.md). Untuk menginstal lewat GitHub Packages alih-alih registry npm publik: [instalasi dari GitHub Packages](github-packages.md). Untuk memperbarui nanti gunakan `flisk upgrade` (atau aliasnya `flisk update`); untuk menyematkan versi lihat [upgrade dan penyematan versi](upgrading.md).

> [!IMPORTANT]
> Dapatkan Flisk dari repositori [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli), dari paket npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk), atau dari [situs resmi](https://flisk.sh/).
> Ikuti tautan instalasi dari sumber resmi ini. Nama repositori yang mirip atau README hasil salinan
> tidak membuktikan bahwa suatu unduhan resmi.

Panduan lengkap ada di [README bahasa Inggris](../README.md).
