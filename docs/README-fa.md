# Flisk: کل برنامه شما، با یک دستور روی رایانه خودتان اجرا می‌شود

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | فارسی | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk یک ابزار خط فرمان برای توسعه محلی است. هر بخش از برنامه شما (API، وب‌سایت، workerها، عامل‌های هوش مصنوعی، پایگاه داده) را روی رایانه شما پشت یک نشانی محلی اجرا می‌کند و هر بخش را به‌محض ذخیره دوباره بارگذاری می‌کند. هر بخش را در یک `service.json` کوچک توصیف می‌کنید؛ Flisk از آن Dockerfileها، فایل Compose و Tiltfile را می‌نویسد و همگام نگه می‌دارد. Flisk استقرار انجام نمی‌دهد: محیط تولید در دست ابزارهای خودتان می‌ماند.

شروع سریع:

```bash
npx @flisk-sh/flisk@latest demo
```

می‌خواهید خودتان پشته‌تان را انتخاب کنید؟ با کلیدهای جهت‌نما و Enter به چند پرسش پاسخ دهید:

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

## پیش‌نیازها (یک بار نصب می‌شوند)

| ابزار | نسخه | نصب | لازم برای |
|------|---------|---------|------------|
| **محیط اجرای برنامه شما** | هر چه برنامه‌تان استفاده می‌کند | Node.js, Python, Go, Bun, ... | همه مسیرها: کد شما را اجرا می‌کند |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | نصب با npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+، Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | فقط مسیر Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: مسیر Docker + Tilt در Ubuntu داخل WSL2 اجرا می‌شود، پس همان خط Linux را آنجا به کار ببرید؛ PowerShell بومی: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | فقط مسیر Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | نصب با Bun (`bun add -g @flisk-sh/flisk`)، یا سرویس‌های JavaScript تولیدشده |

> **دو راه برای اجرا.** پروژه‌ای که هر سرویسش یک `command` اعلام می‌کند، آن‌ها را به‌صورت پردازه‌های محلی اجرا می‌کند: فقط Flisk و محیط اجرای برنامه‌تان لازم است ([ساده‌ترین مسیر](start/simplest.md)). پایگاه داده، یک نشانی واحد برای همه سرویس‌ها، یا همان کانتینری که مستقر می‌کنید به [Docker](start/words.md#docker) و Tilt نیاز دارد. `flisk doctor` فقط همان چیزهایی را بررسی می‌کند که پروژه شما استفاده می‌کند.

راه‌اندازی مرحله‌به‌مرحله رایانه‌تان: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## نصب

CLI را با npm نصب کنید:

```bash
npm install -g @flisk-sh/flisk
```

با `flisk --version` بررسی‌اش کنید: یک شماره نسخه چاپ می‌کند. بعد رایانه‌تان را بررسی کنید:

```bash
flisk doctor
```

`flisk doctor` فقط همان چیزهایی را بررسی می‌کند که پروژه شما استفاده می‌کند و برای هر چیز جاافتاده راه‌حل چاپ می‌کند.

روش‌های دیگر نصب: [Bun](install/bun.md) | [باینری آماده که نه Node.js می‌خواهد و نه Bun](install/binary.md) | [ایمیج کانتینر](install/container.md). برای نصب از GitHub Packages به‌جای رجیستری عمومی npm: [نصب از GitHub Packages](github-packages.md). برای به‌روزرسانی بعداً `flisk upgrade` (یا نام مستعارش `flisk update`) را بزنید؛ برای ثابت نگه داشتن یک نسخه، [به‌روزرسانی و سنجاق کردن نسخه](upgrading.md) را ببینید.

> [!IMPORTANT]
> Flisk را از مخزن [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli)، بسته npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) یا [وب‌سایت رسمی](https://flisk.sh/) بگیرید.
> پیوندهای نصب را از همین منابع رسمی دنبال کنید. نام مشابه یک مخزن یا README کپی‌شده
> ثابت نمی‌کند که دانلودی رسمی است.

راهنمای کامل در [README انگلیسی](../README.md) است.
