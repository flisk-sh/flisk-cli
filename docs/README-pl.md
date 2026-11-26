# Flisk: cała twoja aplikacja uruchomiona na twoim komputerze jedną komendą

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | Polski | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk to narzędzie wiersza poleceń do lokalnego tworzenia oprogramowania. Uruchamia każdą część twojej aplikacji (API, stronę, workery, agentów AI, bazę danych) na twoim komputerze pod jednym lokalnym adresem i przeładowuje część, gdy ją zapiszesz. Każdą część opisujesz w małym pliku `service.json`; Flisk generuje na jego podstawie pliki Dockerfile, plik Compose i Tiltfile oraz dba o ich synchronizację. Nie wdraża aplikacji: produkcja zostaje przy twoich własnych narzędziach.

Szybki start:

```bash
npx @flisk-sh/flisk@latest demo
```

Chcesz wybrać własny stack? Odpowiedz na kilka pytań strzałkami i Enter:

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

## Wymagania wstępne (zainstaluj raz)

| Narzędzie | Wersja | Instalacja | Potrzebne do |
|------|---------|---------|------------|
| **Środowisko uruchomieniowe twojej aplikacji** | to, którego używa twoja aplikacja | Node.js, Python, Go, Bun, ... | Każda ścieżka: uruchamia twój kod |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Instalacja przez npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Tylko ścieżka Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: ścieżka Docker + Tilt działa w Ubuntu na WSL2, więc użyj tam linii dla Linuksa; natywny PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Tylko ścieżka Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Instalacja przez Bun (`bun add -g @flisk-sh/flisk`) lub wygenerowane usługi JavaScript |

> **Dwa sposoby uruchomienia.** W projekcie, w którym każda usługa deklaruje `command`, usługi działają jako lokalne procesy: potrzebujesz tylko Flisk i środowiska uruchomieniowego twojej aplikacji ([najprostsza ścieżka](start/simplest.md)). Baza danych, jeden adres bramy dla wszystkich usług albo ten sam kontener, który wdrażasz, wymagają [Dockera](start/words.md#docker) i Tilta. `flisk doctor` sprawdza tylko to, czego używa twój projekt.

Przygotowanie komputera krok po kroku: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Instalacja

Zainstaluj CLI przez npm:

```bash
npm install -g @flisk-sh/flisk
```

Sprawdź poleceniem `flisk --version`: wypisuje numer wersji. Potem sprawdź swój komputer:

```bash
flisk doctor
```

`flisk doctor` sprawdza tylko to, czego używa twój projekt, i podpowiada, jak naprawić to, czego brakuje.

Inne sposoby instalacji: [Bun](install/bun.md) | [gotowy plik binarny, bez Node.js i Bun](install/binary.md) | [obraz kontenera](install/container.md). Aby zainstalować przez GitHub Packages zamiast publicznego rejestru npm: [instalacja z GitHub Packages](github-packages.md). Później aktualizuj poleceniem `flisk upgrade` (lub jego aliasem `flisk update`); aby przypiąć wersję, zobacz [aktualizacja i przypinanie wersji](upgrading.md).

> [!IMPORTANT]
> Pobieraj Flisk tylko z repozytorium [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli), pakietu npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) albo [oficjalnej strony](https://flisk.sh/).
> Korzystaj z linków instalacyjnych z tych oficjalnych źródeł. Podobna nazwa repozytorium
> ani skopiowany README nie gwarantują, że pobierany plik jest oficjalny.

Pełny przewodnik znajduje się w [angielskim README](../README.md).
