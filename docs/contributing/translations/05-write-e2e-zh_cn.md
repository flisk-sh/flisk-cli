# 5. 编写端到端测试

> 本页是 [05-write-e2e.md](../05-write-e2e.md) 的翻译。如有差异，以英文版为准。

端到端（e2e）测试针对真实的技术栈运行真实的 `flisk`：Docker、Tilt、Traefik 以及生成的文件。单元测试无法发现损坏的路由、永远无法就绪的容器，或真实错误把 JSON envelope 变成堆栈跟踪的问题。e2e 测试可以。

本页说明何时需要 e2e 测试、它放在哪里、如何编写，以及如何证明它有效。全文以 [agent 套件](../../../tests/e2e/resource-types/agent/run.sh) 作为贯穿示例。AI 助手可以使用 `flisk-e2e-author` 技能（`.claude/skills/flisk-e2e-author/`）按相同步骤操作。

## 我需要写一个吗？

当你的改动符合以下任一情况时，请添加或扩展 e2e 测试：

- 新增资源类型，或改变某个类型脚手架生成的内容或其运行方式；
- 新增与运行中的技术栈交互的命令或 MCP 工具（`flisk agent sessions`、`flisk restart`、`agent_sessions`）；
- 修改 `flisk up`、`flisk down`、Traefik 路由，或引擎生成的 Compose 和 Tilt 文件；
- 新增后端语言、后端或前端框架，或用户通过标志选择的其他 provider。

对于从不启动技术栈的改动，例如标志解析、使用模拟输入的 `--json` 格式化，或生成器的文本输出，**不**需要 e2e 测试。这些属于 `cli/src/**/__tests__/` 下的单元测试。在不启动技术栈的情况下对临时项目调用 CLI 的测试（`*-e2e.test.ts` 文件）属于 `cli-integration` 组，保留在 vitest 中。

## 选择分组

每个使用真实技术栈的套件都放在 `tests/e2e/<group>/<suite>/`，且只属于一个分组，分组由它要证明的内容决定：

| 分组 | 证明的内容 | 示例 |
|---|---|---|
| `resource-types` | 一种资源类型在真实技术栈上可用 | `resource-types/agent` |
| `journeys` | 跨多个命令的用户流程 | quickstart、smoke runner、dev loop、cold start |
| `examples` | 一个真实示例应用能启动并提供其路由 | 默认示例、saas-starter |
| `platforms` | 一种宿主环境 | `platforms/windows`、`platforms/windows-binary`、`platforms/wsl2`、`platforms/windows-hardware` |
| `scale` | 大型夹具或基准测试 | 100 个服务的 ERP 夹具 |

要新增一个读取运行中 agent 的 MCP 工具？它属于 `agent` 套件（MCP 资源则属于 `mcp` 套件）。参照用例 C1 到 C3 的结构。

目前只有 `resource-types/agent` 完成了迁移。其他 e2e 测试仍位于 `.github/workflows-disabled/*-e2e.yml`、`scripts/e2e/`、`scripts/verify-*.sh` 和 `tests/e2e/*.test.sh`。它们按 [`openspec/changes/organize-e2e-suites`](../../../openspec/changes/organize-e2e-suites/tasks.md) 中的说明，每个 pull request 迁移一个套件。如果你的改动涉及其中某个位置，就在它当前的位置扩展，或者先完成迁移。

---

本指南的其余部分以英文提供，请参阅 [05-write-e2e.md](../05-write-e2e.md)。
