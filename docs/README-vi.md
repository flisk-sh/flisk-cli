# Flisk: toàn bộ ứng dụng của bạn chạy trên máy tính của bạn chỉ với một lệnh

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | Tiếng Việt | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk là công cụ dòng lệnh cho phát triển cục bộ. Nó chạy mọi phần của ứng dụng (API, website, worker, AI agent, cơ sở dữ liệu) trên máy tính của bạn sau một địa chỉ cục bộ duy nhất, và tải lại một phần khi bạn lưu nó. Bạn mô tả từng phần trong một `service.json` nhỏ; Flisk viết Dockerfile, file Compose và Tiltfile từ đó, rồi giữ chúng đồng bộ. Flisk không triển khai: môi trường production vẫn do các công cụ của riêng bạn đảm nhận.

Bắt đầu nhanh:

```bash
npx @flisk-sh/flisk@latest demo
```

Muốn tự chọn stack? Trả lời vài câu hỏi bằng phím mũi tên và Enter:

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

## Điều kiện tiên quyết (cài đặt một lần)

| Công cụ | Phiên bản | Cài đặt | Cần cho |
|------|---------|---------|------------|
| **Runtime của ứng dụng bạn** | bất kỳ runtime nào ứng dụng bạn dùng | Node.js, Python, Go, Bun, ... | Mọi cách chạy: nó chạy mã của bạn |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Cài đặt bằng npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Chỉ cách chạy Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: cách chạy Docker + Tilt chạy trong Ubuntu trên WSL2, nên dùng dòng lệnh Linux ở đó; cài đặt native trong PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Chỉ cách chạy Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Cài đặt bằng Bun (`bun add -g @flisk-sh/flisk`), hoặc các dịch vụ JavaScript được tạo |

> **Hai cách chạy.** Một dự án mà mỗi dịch vụ khai báo một `command` sẽ chạy các dịch vụ đó như những tiến trình cục bộ: bạn chỉ cần Flisk và runtime của ứng dụng ([cách đơn giản nhất](start/simplest.md)). Cơ sở dữ liệu, một địa chỉ chung cho mọi dịch vụ, hoặc cùng container mà bạn triển khai thì cần [Docker](start/words.md#docker) và Tilt. `flisk doctor` chỉ kiểm tra những gì dự án của bạn dùng.

Chuẩn bị máy tính của bạn theo từng bước: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Cài đặt

Cài đặt CLI bằng npm:

```bash
npm install -g @flisk-sh/flisk
```

Kiểm tra bằng `flisk --version`: nó in ra một số phiên bản. Sau đó kiểm tra máy của bạn:

```bash
flisk doctor
```

`flisk doctor` chỉ kiểm tra những gì dự án của bạn dùng, và chỉ ra cách khắc phục cho từng thứ còn thiếu.

Các cách cài đặt khác: [Bun](install/bun.md) | [binary dựng sẵn, không cần Node.js hay Bun](install/binary.md) | [container image](install/container.md). Để cài đặt qua GitHub Packages thay vì npm registry công cộng: [cài đặt từ GitHub Packages](github-packages.md). Để cập nhật sau này dùng `flisk upgrade` (hoặc bí danh `flisk update`); để ghim một phiên bản, xem [nâng cấp và ghim phiên bản](upgrading.md).

> [!IMPORTANT]
> Chỉ tải Flisk từ repository [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli), từ gói npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk), hoặc từ [trang web chính thức](https://flisk.sh/).
> Hãy dùng các liên kết cài đặt từ những nguồn chính thức này. Một repository có tên tương tự
> hoặc một README bị sao chép không chứng minh bản tải xuống là chính thức.

Hướng dẫn đầy đủ có trong [README tiếng Anh](../README.md).
