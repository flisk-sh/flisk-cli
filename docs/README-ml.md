# Flisk: നിങ്ങളുടെ മുഴുവൻ ആപ്പും ഒരൊറ്റ കമാൻഡിൽ നിങ്ങളുടെ കമ്പ്യൂട്ടറിൽ പ്രവർത്തിക്കുന്നു

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | മലയാളം | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk ലോക്കൽ ഡെവലപ്മെന്റിനുള്ള ഒരു കമാൻഡ്-ലൈൻ ടൂൾ ആണ്. നിങ്ങളുടെ ആപ്പിന്റെ ഓരോ ഭാഗവും (API, വെബ്സൈറ്റ്, വർക്കർമാർ, AI ഏജന്റുകൾ, ഡാറ്റാബേസ്) നിങ്ങളുടെ കമ്പ്യൂട്ടറിൽ ഒരൊറ്റ ലോക്കൽ വിലാസത്തിന് പിന്നിൽ ഇത് പ്രവർത്തിപ്പിക്കുകയും, ഒരു ഭാഗം സേവ് ചെയ്യുമ്പോൾ അത് റീലോഡ് ചെയ്യുകയും ചെയ്യുന്നു. ഓരോ ഭാഗവും ഒരു ചെറിയ `service.json`-ൽ നിങ്ങൾ വിവരിക്കുന്നു; അതിൽ നിന്ന് Flisk Dockerfile-കളും Compose ഫയലും Tiltfile-ഉം എഴുതുകയും അവ സമന്വയത്തിൽ നിലനിർത്തുകയും ചെയ്യുന്നു. ഇത് ഡിപ്ലോയ് ചെയ്യുന്നില്ല: പ്രൊഡക്ഷൻ നിങ്ങളുടെ സ്വന്തം ടൂളുകളുടെ കൈയിൽ തന്നെ തുടരും.

ദ്രുത ആരംഭം:

```bash
npx @flisk-sh/flisk@latest demo
```

സ്വന്തമായി സ്റ്റാക്ക് തിരഞ്ഞെടുക്കണോ? ആരോ കീകളും Enter ഉം ഉപയോഗിച്ച് ചില ചോദ്യങ്ങൾക്ക് ഉത്തരം നൽകുക:

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

## മുൻവ്യവസ്ഥകൾ (ഒരിക്കൽ ഇൻസ്റ്റാൾ ചെയ്യേണ്ടവ)

| ടൂൾ | പതിപ്പ് | ഇൻസ്റ്റാൾ ചെയ്യുന്ന വിധം | എന്തിന് വേണ്ടി |
|------|---------|---------|------------|
| **നിങ്ങളുടെ ആപ്പിന്റെ റൺടൈം** | നിങ്ങളുടെ ആപ്പ് ഉപയോഗിക്കുന്നത് | Node.js, Python, Go, Bun, ... | എല്ലാ വഴിക്കും: നിങ്ങളുടെ കോഡ് പ്രവർത്തിപ്പിക്കുന്നു |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | npm ഇൻസ്റ്റാൾ (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Docker + Tilt വഴിക്ക് മാത്രം |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: Docker + Tilt വഴി WSL2 Ubuntu-വിൽ പ്രവർത്തിക്കുന്നു, അതിനാൽ അവിടെ Linux വരി ഉപയോഗിക്കുക; നേറ്റീവ് PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Docker + Tilt വഴിക്ക് മാത്രം |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Bun ഇൻസ്റ്റാൾ (`bun add -g @flisk-sh/flisk`), അല്ലെങ്കിൽ ജനറേറ്റ് ചെയ്ത JavaScript സർവീസുകൾ |

> **പ്രവർത്തിപ്പിക്കാൻ രണ്ട് വഴികൾ.** ഓരോ സർവീസും ഒരു `command` പ്രഖ്യാപിക്കുന്ന പ്രോജക്ട് അവയെ ലോക്കൽ പ്രോസസുകളായി പ്രവർത്തിപ്പിക്കുന്നു: നിങ്ങൾക്ക് വേണ്ടത് Flisk-ഉം നിങ്ങളുടെ ആപ്പിന്റെ റൺടൈമും മാത്രം ([ഏറ്റവും ലളിതമായ വഴി](start/simplest.md)). ഒരു ഡാറ്റാബേസ്, എല്ലാ സർവീസിനും ഒരേ ഗേറ്റ്‌വേ URL, അല്ലെങ്കിൽ നിങ്ങൾ ഡിപ്ലോയ് ചെയ്യുന്ന അതേ കണ്ടെയ്നർ എന്നിവയ്ക്ക് [Docker](start/words.md#docker)-ഉം Tilt-ഉം ആവശ്യമാണ്. `flisk doctor` നിങ്ങളുടെ പ്രോജക്ട് ഉപയോഗിക്കുന്നത് മാത്രം പരിശോധിക്കുന്നു.

നിങ്ങളുടെ കമ്പ്യൂട്ടർ ഘട്ടംഘട്ടമായി തയ്യാറാക്കാൻ: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## ഇൻസ്റ്റാളേഷൻ

npm ഉപയോഗിച്ച് CLI ഇൻസ്റ്റാൾ ചെയ്യുക:

```bash
npm install -g @flisk-sh/flisk
```

`flisk --version` കൊണ്ട് പരിശോധിക്കുക: ഒരു പതിപ്പ് നമ്പർ അച്ചടിക്കും. ശേഷം നിങ്ങളുടെ കമ്പ്യൂട്ടർ പരിശോധിക്കുക:

```bash
flisk doctor
```

`flisk doctor` നിങ്ങളുടെ പ്രോജക്ട് ഉപയോഗിക്കുന്നത് മാത്രം പരിശോധിക്കുകയും, എന്തെങ്കിലും കാണാതായാൽ അത് ശരിയാക്കുന്ന വിധം അച്ചടിക്കുകയും ചെയ്യുന്നു.

മറ്റ് ഇൻസ്റ്റാൾ വഴികൾ: [Bun](install/bun.md) | [Node.js-ഓ Bun-ഓ ഇല്ലാത്ത പ്രീബിൽട്ട് ബൈനറി](install/binary.md) | [കണ്ടെയ്നർ ഇമേജ്](install/container.md). പബ്ലിക് npm റെജിസ്ട്രിക്ക് പകരം GitHub Packages വഴി ഇൻസ്റ്റാൾ ചെയ്യാൻ: [GitHub Packages ഇൻസ്റ്റാളേഷൻ](github-packages.md). പിന്നീട് അപ്ഡേറ്റ് ചെയ്യാൻ `flisk upgrade` (അതിന്റെ അപരനാമം `flisk update`) ഉപയോഗിക്കുക; ഒരു പതിപ്പ് ഉറപ്പിക്കാൻ [അപ്ഗ്രേഡും പതിപ്പ് പിന്നിംഗും](upgrading.md) കാണുക.

> [!IMPORTANT]
> Flisk [flisk-sh/flisk](https://github.com/flisk-sh/flisk) റിപ്പോസിറ്ററിയിൽ നിന്നോ, [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) npm പാക്കേജിൽ നിന്നോ, [ഔദ്യോഗിക വെബ്സൈറ്റിൽ](https://flisk.sh/) നിന്നോ മാത്രം നേടുക. ഈ ഔദ്യോഗിക ഉറവിടങ്ങളിലെ ഇൻസ്റ്റാൾ ലിങ്കുകൾ പിന്തുടരുക. സമാനമായ പേരുള്ള റിപ്പോസിറ്ററിയോ പകർത്തിയ README-ഓ ഒരു ഡൗൺലോഡ് ഔദ്യോഗികമാണെന്ന് തെളിയിക്കുന്നില്ല.

പൂർണ്ണ ഗൈഡ് [ഇംഗ്ലീഷ് README](../README.md)-ൽ ഉണ്ട്.
