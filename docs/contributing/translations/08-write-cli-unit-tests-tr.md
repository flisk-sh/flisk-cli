# 8. CLI için birim testleri yazın

> Bu sayfa [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) dosyasının çevirisidir. Farklılık olursa İngilizce sürüm geçerlidir.

Flisk'deki birim testleri, canlı bir Docker veya Tilt stack'i başlatmadan CLI komutlarını, üreteçleri ve yardımcı modülleri doğrular. Bu rehber, Vitest kullanarak hızlı, yalıtılmış ve deterministik birim testleri nasıl yazacağınızı, dış sistemleri nasıl taklit edeceğinizi (mock), geçici projeler ve golden dosyalarla nasıl test edeceğinizi ve yaygın hatalardan nasıl kaçınacağınızı açıklar.

Çalışan bir stack'i başlatan uçtan uca testler için [e2e testi yazma](../05-write-e2e.md) sayfasına bakın. Birim testlerinin CI parçaları (shard) arasında nasıl düzenlendiği için [matriste birim testleri çalıştırma](../07-unit-test-matrix.md) sayfasına bakın.

---

## 1. Birim testi temelleri

Flisk, CLI birim testleri için [Vitest](https://vitest.dev/) kullanır.

### Testler nerede durur

- Birim testlerini, test edilen modülün hemen yanındaki bir `__tests__/` dizinine yerleştirin:
  - CLI komutları: `cli/src/commands/__tests__/<command>.test.ts`
  - Kod üreteçleri: `cli/src/generator/__tests__/<generator>.test.ts`
  - Paylaşılan yardımcılar: `cli/src/utils/__tests__/<utility>.test.ts`
- **Adlandırma kuralı**: Test dosyasını, kaynak dosyanın adının sonuna `.test.ts` (Ink tabanlı terminal UI bileşenleri için `.test.tsx`) ekleyerek adlandırın. Örneğin `completion-install.test.ts`, `completion-install.ts` dosyasını test eder.

### Temel Vitest yapısı

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPathSafe } from "../validation.js";

describe("isPathSafe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["ordinary relative path", "src/index.ts", true],
    ["parent traversal (not checked here)", "../secret", true],
    ["null byte", "a\0b", false],
    ["reserved character", "a|b", false],
  ])("%s -> %s", (_label, input, expected) => {
    expect(isPathSafe(input)).toBe(expected);
  });
});
```

### Tablo tabanlı testler (`it.each`)

Saf fonksiyonlar ve doğrulayıcılar için parametreli tabloları (`it.each`) tercih edin. Girdi işleyen her fonksiyon şunları test etmelidir:
1. **Normal yol**: belgelenen her biçim için geçerli girdiler.
2. **Boş ve hata durumları**: boş string'ler, eksik anahtarlar, hatalı biçimlendirilmiş girdiler ve fırlatılan istisnalar.
3. **Sınır koşulları**: uç değerler (örneğin minimum ve maksimum portlar, yol derinliği sınırları).

---

Rehberin geri kalanı [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) dosyasında İngilizce olarak yer alır.
