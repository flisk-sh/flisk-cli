# Flisk: แอปทั้งหมดของคุณ รันบนคอมพิวเตอร์ของคุณด้วยคำสั่งเดียว

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | ไทย | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | [Ελληνικά](README-el.md) | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Flisk เป็นเครื่องมือบรรทัดคำสั่งสำหรับการพัฒนาในเครื่อง ช่วยรันทุกส่วนของแอปของคุณ (API, เว็บไซต์, worker, AI agent, ฐานข้อมูล) บนคอมพิวเตอร์ของคุณภายใต้ที่อยู่ในเครื่องเพียงหนึ่งเดียว และรีโหลดส่วนนั้นเมื่อคุณบันทึก คุณอธิบายแต่ละส่วนใน `service.json` ไฟล์เล็ก ๆ จากนั้น Flisk จะเขียน Dockerfile, ไฟล์ Compose และ Tiltfile ให้ และดูแลให้ตรงกันอยู่เสมอ Flisk ไม่ deploy ให้ — production ยังเป็นหน้าที่ของเครื่องมือของคุณเอง

เริ่มต้นอย่างรวดเร็ว:

```bash
npx @flisk-sh/flisk@latest demo
```

อยากเลือกสแตกเองไหม? ตอบคำถามไม่กี่ข้อด้วยปุ่มลูกศรและ Enter:

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

## ข้อกำหนดเบื้องต้น (ติดตั้งครั้งเดียว)

| เครื่องมือ | เวอร์ชัน | การติดตั้ง | จำเป็นสำหรับ |
|------|---------|---------|------------|
| **รันไทม์ของแอปคุณ** | ตามที่แอปของคุณใช้ | Node.js, Python, Go, Bun, ... | ทุกวิธี: ใช้รันโค้ดของคุณ |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | ติดตั้งผ่าน npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | เฉพาะวิธี Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: วิธี Docker + Tilt รันอยู่ใน Ubuntu บน WSL2 จึงใช้บรรทัดของ Linux ในนั้น; ติดตั้งแบบเนทีฟใน PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | เฉพาะวิธี Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | ติดตั้งผ่าน Bun (`bun add -g @flisk-sh/flisk`) หรือบริการ JavaScript ที่ Flisk สร้างให้ |

> **รันได้สองวิธี** โปรเจกต์ที่ทุกบริการประกาศ `command` จะรันบริการเหล่านั้นเป็นโพรเซสในเครื่อง: คุณต้องการแค่ Flisk กับรันไทม์ของแอปคุณ ([วิธีที่ง่ายที่สุด](start/simplest.md)) ถ้าต้องการฐานข้อมูล ที่อยู่เดียวสำหรับทุกบริการ หรือคอนเทนเนอร์ตัวเดียวกับที่ใช้ deploy จะต้องมี [Docker](start/words.md#docker) และ Tilt `flisk doctor` ตรวจเฉพาะสิ่งที่โปรเจกต์ของคุณใช้

เตรียมเครื่องของคุณทีละขั้นตอน: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md)

## การติดตั้ง

ติดตั้ง CLI ด้วย npm:

```bash
npm install -g @flisk-sh/flisk
```

ตรวจสอบด้วย `flisk --version`: จะพิมพ์หมายเลขเวอร์ชันออกมา จากนั้นตรวจสอบเครื่องของคุณ:

```bash
flisk doctor
```

`flisk doctor` ตรวจเฉพาะสิ่งที่โปรเจกต์ของคุณใช้ และบอกวิธีแก้สำหรับทุกสิ่งที่ขาดไป

วิธีติดตั้งอื่น ๆ: [Bun](install/bun.md) | [ไบนารีสำเร็จรูป ไม่ต้องใช้ Node.js หรือ Bun](install/binary.md) | [อิมเมจคอนเทนเนอร์](install/container.md) ถ้าจะติดตั้งผ่าน GitHub Packages แทนรีจิสทรี npm สาธารณะ: [ติดตั้งจาก GitHub Packages](github-packages.md) เมื่อจะอัปเดตภายหลังใช้ `flisk upgrade` (หรือเอเลียส `flisk update`); ถ้าต้องการปักหมุดเวอร์ชัน ดู [การอัปเกรดและการปักหมุดเวอร์ชัน](upgrading.md)

> [!IMPORTANT]
> ดาวน์โหลด Flisk เฉพาะจากรีโพซิทอรี [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli) จากแพ็กเกจ npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) หรือจาก [เว็บไซต์ทางการ](https://flisk.sh/)
> ใช้ลิงก์ติดตั้งจากแหล่งทางการเหล่านี้เท่านั้น รีโพซิทอรีที่ชื่อคล้ายกัน
> หรือ README ที่ถูกคัดลอกไม่ได้การันตีว่าดาวน์โหลดนั้นเป็นของทางการ

คู่มือฉบับเต็มอยู่ใน [README ภาษาอังกฤษ](../README.md)
