# 8. 撰寫 CLI 單元測試

> 本頁是 [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) 的翻譯。如有差異，以英文版為準。

Flisk 的單元測試在不啟動實際 Docker 或 Tilt 堆疊的情況下，驗證 CLI 指令、產生器與工具模組。本指南說明如何使用 Vitest 撰寫快速、密封（hermetic）且具確定性的單元測試、如何模擬（mock）外部系統、如何使用暫時專案與 golden files 進行測試，以及如何避免常見的陷阱。

針對會啟動執行中堆疊的端到端測試，請參閱[撰寫 e2e 測試](../05-write-e2e.md)。關於單元測試在 CI 分片中的組織方式，請參閱[在矩陣中執行單元測試](../07-unit-test-matrix.md)。

---

## 1. 單元測試基礎

Flisk 使用 [Vitest](https://vitest.dev/) 進行 CLI 單元測試。

### 測試檔案的位置

- 將單元測試放在受測模組旁邊的 `__tests__/` 目錄中：
  - CLI 指令：`cli/src/commands/__tests__/<command>.test.ts`
  - 程式碼產生器：`cli/src/generator/__tests__/<generator>.test.ts`
  - 共用工具：`cli/src/utils/__tests__/<utility>.test.ts`
- **命名慣例**：以來源檔案的名稱加上 `.test.ts` 後綴命名測試檔案（以 Ink 為基礎的終端機 UI 元件使用 `.test.tsx`）。例如，`completion-install.test.ts` 測試 `completion-install.ts`。

### Vitest 核心結構

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

### 表格驅動測試（`it.each`）

純函式與驗證器優先使用參數化表格（`it.each`）。每個處理輸入的函式都應測試：
1. **正常路徑（happy path）**：每種文件化格式的有效輸入。
2. **空值與錯誤情況**：空字串、缺少的鍵、格式錯誤的輸入，以及拋出的例外。
3. **邊界條件**：邊界值（例如最小與最大埠、路徑深度限制）。

---

本指南的其餘部分以英文收錄於 [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md)。
