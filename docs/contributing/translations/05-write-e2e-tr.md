# 5. Uçtan uca test yazın

> Bu sayfa [05-write-e2e.md](../05-write-e2e.md) dosyasının çevirisidir. Farklılık olursa İngilizce sürüm geçerlidir.

Uçtan uca (e2e) test, gerçek `flisk`'ı gerçek bir stack üzerinde çalıştırır: Docker, Tilt, Traefik ve üretilen dosyalar. Birim testler bozuk bir rotayı, hiç hazır hale gelmeyen bir konteyneri veya gerçek bir hatanın stack trace'e dönüştürdüğü bir JSON zarfını yakalayamaz. Bir e2e testi yakalayabilir.

Bu sayfa ne zaman bir tane gerektiğini, nereye konacağını, nasıl yazılacağını ve çalıştığının nasıl kanıtlanacağını açıklar. [Agent suite](../../../tests/e2e/resource-types/agent/run.sh) baştan sona işlenen örnektir. AI asistanları `flisk-e2e-author` yeteneğiyle (`.claude/skills/flisk-e2e-author/`) aynı adımları izleyebilir.

## Bir tane gerekli mi?

Değişikliğiniz şu durumlarda bir e2e testi ekleyin veya genişletin:

- bir resource type ekliyorsa veya bir type'ın scaffold ettiği şeyi ya da çalışma şeklini değiştiriyorsa;
- çalışan bir stack ile konuşan bir komut veya MCP aracı ekliyorsa (`flisk agent sessions`, `flisk restart`, `agent_sessions`);
- `flisk up`, `flisk down`, Traefik yönlendirmesi veya engine'in ürettiği Compose ve Tilt dosyalarını değiştiriyorsa;
- bir backend dili, bir backend veya frontend framework'ü ya da kullanıcıların bir flag ile seçtiği başka bir provider ekliyorsa.

Stack'i hiç başlatmayan bir değişiklik için e2e testine **ihtiyacınız yoktur**; örneğin flag ayrıştırma, mock girdiyle `--json` biçimlendirme veya bir generator'ün metin çıktısı. Bunlar `cli/src/**/__tests__/` altındaki birim testlere aittir. Stack'i başlatmadan geçici bir projeye karşı CLI'ı çalıştıran testler (`*-e2e.test.ts` dosyaları) `cli-integration` grubudur ve vitest'te kalır.

## Grubu seçin

Canlı stack kullanan her suite `tests/e2e/<group>/<suite>/` altında bulunur ve kanıtladığı şeye göre tam olarak bir gruba seçilir:

| Grup | Kanıtladığı | Örnek | <!-- spellchecker:disable-line -->
|---|---|---|
| `resource-types` | bir resource type'ın gerçek bir stack üzerinde çalışması | `resource-types/agent` |
| `journeys` | çok komutlu bir kullanıcı akışı | quickstart, smoke runner, dev loop, cold start |
| `examples` | gerçek bir örnek uygulamanın başlayıp rotalarını sunması | varsayılan örnek, saas-starter |
| `platforms` | bir host ortamı | `platforms/windows`, `platforms/windows-binary`, `platforms/wsl2`, `platforms/windows-hardware` |
| `scale` | büyük bir fixture veya benchmark | 100 servisli ERP fixture'ı |

Çalışan bir agent'ı okuyan bir MCP aracı mı ekliyorsunuz? `agent` suite'ine aittir (MCP resource'ları için `mcp` suite'i). C1 ile C3 arasındaki vakaların şeklini kopyalayın. <!-- spellchecker:disable-line -->

Şimdiye kadar yalnızca `resource-types/agent` taşındı. Diğer e2e testleri hâlâ `.github/workflows/*-e2e.yml`, `scripts/e2e/`, `scripts/verify-*.sh` ve `tests/e2e/*.test.sh` altında bulunuyor. Pull request başına bir suite taşınır; bunu [`openspec/changes/organize-e2e-suites`](../../../openspec/changes/organize-e2e-suites/tasks.md) anlatır. Değişikliğiniz bunlardan birine dokunuyorsa, olduğu yerde genişletin veya önce taşıyın.

---

Rehberin geri kalanı [05-write-e2e.md](../05-write-e2e.md) dosyasında İngilizce olarak sunulmaktadır.
