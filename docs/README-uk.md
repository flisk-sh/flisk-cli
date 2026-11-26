# Flisk: увесь ваш застосунок запущений на вашому комп'ютері однією командою

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | Українська | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk — це інструмент командного рядка для локальної розробки. Він запускає кожну частину вашого застосунку (API, вебсайт, воркери, ШІ-агенти, базу даних) на вашому комп'ютері за однією локальною адресою й перезавантажує частину, щойно ви її збережете. Кожну частину ви описуєте в невеликому `service.json`; Flisk створює з нього Dockerfile, файл Compose і Tiltfile та підтримує їх синхронними. Він не розгортає застосунок: продакшн лишається за вашими власними інструментами.

Швидкий старт:

```bash
npx @flisk-sh/flisk@latest demo
```

Хочете самі обрати стек? Дайте відповідь на кілька запитань стрілками та Enter:

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

## Передумови (встановити один раз)

| Інструмент | Версія | Встановлення | Потрібно для |
|------|---------|---------|------------|
| **Рантайм вашого застосунку** | той, що використовує ваш застосунок | Node.js, Python, Go, Bun, ... | Кожен шлях: він запускає ваш код |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Встановлення через npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Лише для шляху Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: шлях Docker + Tilt працює в Ubuntu на WSL2, тож використовуйте там рядок для Linux; нативний PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Лише для шляху Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Встановлення через Bun (`bun add -g @flisk-sh/flisk`) або згенеровані JavaScript-сервіси |

> **Два способи запуску.** У проєкті, де кожен сервіс оголошує `command`, вони працюють як локальні процеси: потрібні лише Flisk і рантайм вашого застосунку ([найпростіший шлях](start/simplest.md)). База даних, одна адреса шлюзу для всіх сервісів або той самий контейнер, який ви розгортаєте, потребують [Docker](start/words.md#docker) і Tilt. `flisk doctor` перевіряє лише те, що використовує ваш проєкт.

Покрокова підготовка комп'ютера: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Встановлення

Встановіть CLI через npm:

```bash
npm install -g @flisk-sh/flisk
```

Перевірте командою `flisk --version`: вона виводить номер версії. Потім перевірте свій комп'ютер:

```bash
flisk doctor
```

`flisk doctor` перевіряє лише те, що використовує ваш проєкт, і підказує, як виправити все, чого бракує.

Інші способи встановлення: [Bun](install/bun.md) | [готовий бінарник, без Node.js і Bun](install/binary.md) | [образ контейнера](install/container.md). Щоб встановити через GitHub Packages замість публічного реєстру npm: [встановлення з GitHub Packages](github-packages.md). Пізніше оновлюйте командою `flisk upgrade` (або її аліасом `flisk update`); щоб зафіксувати версію, див. [оновлення та фіксація версії](upgrading.md).

> [!IMPORTANT]
> Завантажуйте Flisk лише з репозиторію [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli), пакета npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) або [офіційного сайту](https://flisk.sh/).
> Дотримуйтесь посилань на встановлення з цих офіційних джерел. Схожа назва репозиторію
> або скопійований README не гарантують, що завантаження офіційне.

Повна інструкція в [англійському README](../README.md).
