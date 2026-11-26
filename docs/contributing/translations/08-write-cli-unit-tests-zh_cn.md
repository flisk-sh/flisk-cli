# 8. 为 CLI 编写单元测试

> 本页是 [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) 的翻译。如有差异，以英文版为准。

Flisk 的单元测试在不启动真实 Docker 或 Tilt 堆栈的情况下验证 CLI 命令、生成器和工具模块。本指南介绍如何使用 Vitest 编写快速、封闭且确定性的单元测试，如何模拟外部系统，如何使用临时项目和 golden 文件进行测试，以及如何避免常见陷阱。

需要启动运行中堆栈的端到端测试，请参阅 [编写 e2e 测试](../05-write-e2e.md)。关于单元测试在 CI 分片中的组织方式，请参阅 [在矩阵中运行单元测试](../07-unit-test-matrix.md)。

---

## 1. 单元测试基础

Flisk 使用 [Vitest](https://vitest.dev/) 进行 CLI 单元测试。

### 测试文件的位置

- 将单元测试放在与被测模块相邻的 `__tests__/` 目录中：
  - CLI 命令：`cli/src/commands/__tests__/<command>.test.ts`
  - 代码生成器：`cli/src/generator/__tests__/<generator>.test.ts`
  - 共享工具：`cli/src/utils/__tests__/<utility>.test.ts`
- **命名约定**：测试文件以源文件命名，加上 `.test.ts` 后缀（基于 Ink 的终端 UI 组件使用 `.test.tsx`）。例如，`completion-install.test.ts` 测试 `completion-install.ts`。

### Vitest 核心结构

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

### 表驱动测试（`it.each`）

对纯函数和验证器优先使用参数化表格（`it.each`）。每个处理输入的函数都应测试：
1. **正常路径（Happy path）**：每种文档化格式的有效输入。
2. **空值与错误用例**：空字符串、缺失的键、格式错误的输入和抛出的异常。
3. **边界条件**：边界值（例如最小和最大端口、路径深度限制）。

---

本指南的其余部分以英文提供，请参阅 [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md)。
