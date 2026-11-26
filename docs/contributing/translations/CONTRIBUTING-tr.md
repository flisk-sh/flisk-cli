# Flisk'ya katkıda bulunmak

[English](../../../.github/CONTRIBUTING.md) | [简体中文](CONTRIBUTING-zh_cn.md) | [繁體中文](CONTRIBUTING-zh_tw.md) | [日本語](CONTRIBUTING-ja.md) | [한국어](CONTRIBUTING-ko.md) | Türkçe

> Bu sayfa [CONTRIBUTING.md](../../../.github/CONTRIBUTING.md) dosyasının çevirisidir. Farklılık olursa İngilizce sürüm geçerlidir. Rehberlerin Türkçe çevirileri de mevcuttur.

Hoş geldiniz! Küçük düzeltmeler de büyük özellikler de faydalıdır. Önce kısa [katkı rehberi](README-tr.md) ile başlayın; bir değişiklik bulmayı, yapmayı, kontrol etmeyi ve pull request açmayı adım adım anlatır.

## Buradan başlayın

1. [Değişikliğinizi seçin ve depoyu hazırlayın](01-first-change-tr.md).
2. [Değişiklik türünüze uygun rehberi izleyin](02-feature-recipes-tr.md).
3. [Çalışmanızı kontrol edin ve bir pull request açın](03-open-a-pr-tr.md).
4. [Başkasının pull request'ini inceleyin](04-review-a-pr-tr.md); tek tıklamalı AI inceleme düğmeleri vardır.

[Frontend provider rehberi](../../frontend-framework-providers.md), Vue gibi başka bir Vite framework'ü eklemenin tam adımlarını içerir. [Backend provider rehberi](../../backend-language-providers.md) ise Python gibi bir backend dili eklemeyi anlatır.

## Hızlı kurulum

Git, [Bun](https://bun.sh) ve Node.js 22.12 veya daha yenisi gerekir. Çoğu değişiklikte Docker ve Tilt gerekmez.

```bash
git clone https://github.com/flisk-sh/flisk.git
cd flisk
bun install
bun run typecheck && bun run lint && bun run test   # yaklaşık bir dakika; bir şeyi değiştirmeden önce hepsi geçmelidir
```

Temiz bir checkout'ta bunlardan biri başarısız olursa bu sizin kurulumunuzun değil, projenin bir hatasıdır: lütfen [bir issue açın](https://github.com/flisk-sh/flisk/issues/new/choose). <!-- spellchecker:disable-line -->

## Hata bulmak

Kod yazmadan da yardım edebilirsiniz. Bir komut çalıştırın, çıktısını Flisk'nın vaat ettikleriyle (`--help`, belgeler veya başka bir komut) karşılaştırın ve bir fark varsa bildirin. İşte bu bir hatadır.

[Flisk'de hata bulma](../finding-bugs.md) rehberinde tam adımlar vardır: denemek için geçici bir proje, beklenen çıktılarıyla bir komut kontrol listesi, geçmişte hataları yakalayan kalıplar ve bakımcıların hemen işleyebileceği bir rapor biçimi. Örneğin `flisk networks` hiçbir URL göstermiyorken `flisk up --dry-run` gösteriyorsa iki komut uyuşmuyor demektir ve biri yanlıştır.

## Pull request incelemek

Açık [pull request'leri](https://github.com/flisk-sh/flisk/pulls) inceleyerek kod yazmadan da yardım edebilirsiniz. Her PR'ın sonunda **Grok**, **Claude** ve **Codex** düğmeleri vardır; tıklamak o PR'ı incelemesi istenmiş bir AI sohbeti açar. AI sizin yardımcınızdır: söylediklerini diff ile doğrulayın, sonra GitHub'da **Comment**, **Approve** veya **Request changes** olarak kendi incelemenizi gönderin. <!-- spellchecker:disable-line -->

İlk incelemenizden önce [zorunlu okumayı](04-review-a-pr-tr.md#i̇lk-incelemeden-önce-zorunlu-okuma) okuyun (yaklaşık bir saat, yalnızca bir kez). Ardından [pull request inceleme rehberi](04-review-a-pr-tr.md) düğmelerin nasıl kullanıldığını adım adım anlatır ve onay ile değişiklik isteği için yorum örnekleri gösterir.

## Üzerinde çalışılacak bir iş bulmak

- 🗺️ [Flisk yolculuğu](../../journey/README.md): bir ada seçin, görevleri tamamlayın, rütbenizi yükseltin (8 kyu → 1 dan)
- [Good first issues](https://github.com/flisk-sh/flisk/labels/good%20first%20issue)
- [Help wanted](https://github.com/flisk-sh/flisk/labels/help%20wanted)
- Adım adım kontrol listesiyle [hata bulun](../finding-bugs.md)
- [Hata bildirin veya soru sorun](https://github.com/flisk-sh/flisk/issues/new/choose)

Bir issue seçtiyseniz `I'll take this` (veya `I would like this one`, `I'd like to work on this`, `Can I take this?`) yazarak yorum bırakın. Bir bot sizi atar ve iki kişinin aynı işi yapmaması için `claimed` etiketini ekler. Pull request olmadan 14 gün geçerse hatırlatma gelir, 21 günde atama kaldırılır. Taslak PR'lar da ilerleme sayılır. Hata bildirirken mümkünse `flisk doctor` çıktısını da ekleyin.

## Yazım denetimi

`cargo install typos-cli --version 1.50.3` ile sabit sürümlü denetleyiciyi kurun, ardından depo kökünde `typos` çalıştırarak yazımı denetleyin.

## Etiketler

Etiketler ilginize ve deneyiminize uyan işi bulmanızı sağlar. Bakımcılar ayıklarken etiket ekler; issue formları ve PR labeler da bazı etiketleri otomatik ekler. Güncel [etiket listesi](https://github.com/flisk-sh/flisk/labels) her etiketin açıklamasını içerir.

| Etiket | Anlamı | Ne zaman eklenir |
| --- | --- | --- |
| `bug` | Beklendiği gibi çalışmayan bir şey. | Hata raporu formu ve doğrulanmış kusurlar. |
| `enhancement` | Yeni bir özellik veya iyileştirme. | Özellik isteği formu ve kabul edilen iyileştirmeler. |
| `documentation` | Eksik, yanlış veya belirsiz belgeler. | Belgeler formu ve belge işi. |
| `good first issue` | Depo bilgisi az gerektiren küçük, bağımsız işler. | Bakımcıların ilk katkı için uygun bulduğu işler. |
| `help wanted` | Topluluk yardımı gereken işler; genelde first issue'dan büyüktür. | Bakımcıların üstlenecek birini memnuniyetle karşıladığı işler. |
| `difficulty: easy`, `difficulty: medium`, `difficulty: hard` | Birkaç saat, bir iki gün ya da derin depo bilgisi veya tasarım gerektiren iş. | Bakımcıların tahmin ettiği zorluk; katkı etiketlerini tamamlar. |
| `question` | Açıklama isteği. | Bakımcının uygulama işi değil soru olarak ayıkladığı. |
| `duplicate` | Başka bir issue ya da PR'ın zaten kapsadığı iş. | Bakımcı özgün tartışmaya bağlantı verir. |
| `invalid`, `wontfix` | Geçersiz rapor veya projenin yapmayacağı iş. | Bakımcı neden ilerlemeyeceğini açıklar. |
| `premium` | Premium lisans istekleri ve ücretli özellikler. | premium issue formu veya bakımcı ayıklaması. |
| `tracking` | İlgili işleri bir araya getiren üst issue. | Bakımcı birden çok issue'ya yayılan işi topladığında. |
| `community`, `examples`, `growth` | Topluluk çalışması, örnek projeler ve benimsemeyi artıran iyileştirmeler. | Bakımcı tanıtım ve benimseme işlerini belirlediğinde. |
| `dx`, `design`, `guide` | Geliştirici deneyimi, görsel veya UX cilası ya da yazılı rehberler. | Bakımcı iyileştirme türünü belirlediğinde. |
| `testing`, `ci`, `packaging` | Testler, GitHub Actions, yükleyiciler ve paketler. | Bakımcı doğrulama ve teslim işlerini belirlediğinde. |
| `agents` | AI kodlama ajanları için belgeler ve dosyalar. | Bakımcı ajanlara yönelik işleri belirlediğinde. |
| `rfc` | Uygulamadan önce tasarım tartışması. | Bakımcı önerilen kapsam için uzlaşı istediğinde. |
| `windows` | Windows ve WSL2 desteği. | Bakımcı platforma özgü işleri belirlediğinde. | <!-- spellchecker:disable-line -->
| `performance`, `benchmark` | Hız veya bellek iyileştirmeleri ya da ölçüm araçları. | Bakımcı optimizasyon ve ölçüm işlerini belirlediğinde. |
| `hacktoberfest` | Hacktoberfest'e katılan işler. | Bakımcı etkinliğe uygun katkıları seçtiğinde. |
| `area:*` | Etkilenen bölüm, örn. `area: tui`, `area: doctor`, `area: cli`. | Bakımcılar issue'lara ekler; PR labeler alanı değişen yollardan belirler. |
| `tech:*` | İlgili teknolojiler, örn. TypeScript, Docker, Tilt. | Bakımcı işin içerdiği araçları belirlediğinde. |
| `rank:*`, `island:*` | Flisk yolculuğundaki işin ölçeği ve teması. | Bakımcı görevleri katkı haritasına yerleştirdiğinde. |
| `event:*` | GitHub Universe gibi belirli bir etkinlik için iş. | Bakımcı etkinliğe özgü işleri düzenlediğinde. |

## Commit'lerinizi imzalayın

Her commit'te [Developer Certificate of Origin](../../project/DCO) imzası gerekir. `git commit -s` ile eklenir ve `Signed-off-by: Your Name <you@example.com>` satırını yazar. Var olan commit'leri düzeltmek için `git rebase --signoff origin/main` çalıştırın ve dalınızı force-push edin. Bu satırı içermeyen bir commit varsa pull request kontrolleri başarısız olur.

## Takımınızı benimseyenler listesine ekleyin

Flisk'yi kendi deponuzda mı kullanıyorsunuz? [ADOPTERS.md](../../project/ADOPTERS.md) listesine iki yolla eklenebilirsiniz: [We use Flisk](https://github.com/flisk-sh/flisk/issues/new?template=we-use-flisk.yml) issue formunu açın ya da pull request ile tabloya bir satır ekleyin. [What counts](../../project/ADOPTERS.md#what-counts) neyin bağlanacağını ve neyin sayılmadığını açıklar.

## Yönetişim

Kararların nasıl alındığı ve bakımcıların nasıl eklendiği için [GOVERNANCE.md](../../project/GOVERNANCE.md), kimin birleştirebildiği için [MAINTAINERS.md](../../project/MAINTAINERS.md), Flisk kullanan takımlar için [ADOPTERS.md](../../project/ADOPTERS.md) dosyalarına bakın.

## Nazik olun

Katılarak [Davranış kurallarına](../../../.github/CODE_OF_CONDUCT.md) uymayı kabul etmiş olursunuz. Güvenlik sorunlarını açık bir issue yerine [SECURITY.md](../../../.github/SECURITY.md) yoluyla özel olarak bildirin.
