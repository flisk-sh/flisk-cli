# 5. 撰寫端對端測試

> 本頁是 [05-write-e2e.md](../05-write-e2e.md) 的翻譯。如有差異，以英文版為準。

端對端（e2e）測試會對真實的堆疊執行真正的 `flisk`：Docker、Tilt、Traefik 和產生的檔案。單元測試抓不到壞掉的路由、永遠無法就緒的容器，或真實錯誤使 JSON envelope 變成堆疊追蹤的情況。e2e 測試可以。

本頁說明何時需要 e2e 測試、它放在哪裡、如何撰寫，以及如何證明它能運作。全篇以 [agent 測試套件](../../../tests/e2e/resource-types/agent/run.sh) 作為實作範例。AI 助理可以使用 `flisk-e2e-author` 技能（`.claude/skills/flisk-e2e-author/`）依循相同的步驟。

## 我需要寫一個嗎？

當你的改動符合下列情況時，新增或擴充 e2e 測試：

- 新增資源類型，或改變某類型產生的內容或它的執行方式；
- 新增會與執行中堆疊溝通的指令或 MCP 工具（`flisk agent sessions`、`flisk restart`、`agent_sessions`）；
- 修改 `flisk up`、`flisk down`、Traefik 路由，或引擎產生的 Compose 與 Tilt 檔案；
- 新增後端語言、後端或前端框架，或其他使用者以旗標選擇的 provider。

對於完全不啟動堆疊的改動**不需要** e2e 測試，例如旗標解析、使用模擬輸入的 `--json` 格式設定，或產生器的文字輸出。這些屬於 `cli/src/**/__tests__/` 下的單元測試。不啟動堆疊、而是對暫存專案執行 CLI 的測試（`*-e2e.test.ts` 檔案）屬於 `cli-integration` 群組，保留在 vitest。

## 選擇群組

每個對即時堆疊執行的測試套件都位於 `tests/e2e/<group>/<suite>/`，依它要證明的內容歸入恰好一個群組：

| 群組 | 證明的內容 | 範例 |
|---|---|---|
| `resource-types` | 單一資源類型在真實堆疊上正常運作 | `resource-types/agent` |
| `journeys` | 跨多個指令的使用者流程 | quickstart, smoke runner, dev loop, cold start |
| `examples` | 真實範例應用程式能啟動並服務其路由 | 預設範例、saas-starter |
| `platforms` | 主機環境 | `platforms/windows`、`platforms/windows-binary`、`platforms/wsl2`、`platforms/windows-hardware` |
| `scale` | 大型 fixture 或基準測試 | 100 個服務的 ERP fixture |

要新增讀取執行中 agent 的 MCP 工具嗎？它屬於 `agent` 測試套件（MCP 資源則是 `mcp` 測試套件）。請比照 C1 到 C3 案例的寫法。

目前只有 `resource-types/agent` 完成搬移。其他 e2e 測試仍在 `.github/workflows-disabled/*-e2e.yml`、`scripts/e2e/`、`scripts/verify-*.sh` 和 `tests/e2e/*.test.sh`。如 [`openspec/changes/organize-e2e-suites`](../../../openspec/changes/organize-e2e-suites/tasks.md) 所述，它們每個 pull request 搬移一個測試套件。如果你的改動涉及其中之一，就在它目前的位置擴充，或先搬移它。

---

本指南的其餘部分以英文提供，請參閱 [05-write-e2e.md](../05-write-e2e.md)。
