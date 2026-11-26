# Flisk: toată aplicația ta, rulând pe calculatorul tău cu o singură comandă

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | Română

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk este o unealtă din linia de comandă pentru dezvoltarea locală. Rulează fiecare parte a aplicației tale (API, site web, workeri, agenți AI, bază de date) pe calculatorul tău, în spatele unei singure adrese locale, și reîncarcă o parte când o salvezi. Descrii fiecare parte într-un `service.json` mic; Flisk scrie din el Dockerfile-urile, fișierul Compose și Tiltfile-ul și le ține sincronizate. Nu face deploy: producția rămâne la uneltele tale.

Pornire rapidă:

```bash
npx @flisk-sh/flisk@latest demo
```

Vrei să îți alegi singur stack-ul? Răspunde la câteva întrebări cu săgețile și Enter:

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

## Cerințe preliminare (se instalează o singură dată)

| Unealtă | Versiune | Instalare | Necesară pentru |
|------|---------|---------|------------|
| **Runtime-ul aplicației tale** | orice folosește aplicația ta | Node.js, Python, Go, Bun, ... | Orice cale: îți rulează codul |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Instalare cu npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Doar pentru calea Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: calea Docker + Tilt rulează în Ubuntu pe WSL2, așa că folosește acolo linia pentru Linux; instalare nativă în PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Doar pentru calea Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Instalare cu Bun (`bun add -g @flisk-sh/flisk`) sau servicii JavaScript generate |

> **Două moduri de rulare.** Un proiect în care fiecare serviciu declară un `command` le rulează ca procese locale: ai nevoie doar de Flisk și de runtime-ul aplicației tale ([cea mai simplă cale](start/simplest.md)). O bază de date, o singură adresă pentru fiecare serviciu sau același container pe care îl publici au nevoie de [Docker](start/words.md#docker) și Tilt. `flisk doctor` verifică doar ce folosește proiectul tău.

Pregătirea calculatorului pas cu pas: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Instalare

Instalează CLI-ul cu npm:

```bash
npm install -g @flisk-sh/flisk
```

Verifică cu `flisk --version`: afișează un număr de versiune. Apoi verifică calculatorul:

```bash
flisk doctor
```

`flisk doctor` verifică doar ce folosește proiectul tău și, pentru orice lipsește, arată cum se remediază.

Alte moduri de instalare: [Bun](install/bun.md) | [binar precompilat, fără Node.js sau Bun](install/binary.md) | [imagine container](install/container.md). Pentru instalare prin GitHub Packages în locul registrului npm public: [instalare din GitHub Packages](github-packages.md). Pentru actualizare ulterioară folosește `flisk upgrade` (sau aliasul său `flisk update`); pentru a fixa o versiune vezi [actualizare și fixarea versiunii](upgrading.md).

> [!IMPORTANT]
> Ia Flisk din depozitul [flisk-sh/flisk](https://github.com/flisk-sh/flisk), din pachetul npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) sau de pe [site-ul oficial](https://flisk.sh/).
> Urmează linkurile de instalare din aceste surse oficiale. Un nume de depozit asemănător
> sau un README copiat nu dovedește că o descărcare este oficială.

Ghidul complet este în [README-ul în engleză](../README.md).
