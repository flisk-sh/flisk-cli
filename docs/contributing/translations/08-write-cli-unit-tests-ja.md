# 8. CLI のユニットテストを書く

> このページは [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) の翻訳です。内容が異なる場合は英語版が優先されます。

Flisk のユニットテストは、実際の Docker や Tilt のスタックを起動せずに、CLI コマンド、ジェネレーター、ユーティリティモジュールを検証します。このガイドでは、Vitest を使って高速で密閉的（hermetic）かつ決定論的なユニットテストを書く方法、外部システムをモックする方法、一時プロジェクトとゴールデンファイルを使ったテスト方法、よくある落とし穴を避ける方法を説明します。

実行中のスタックを起動するエンドツーエンドのテストについては、[e2e テストを作成する](05-write-e2e-ja.md) を参照してください。CI シャード間でユニットテストがどのように構成されているかについては、[ユニットテストをマトリックスで実行する](../07-unit-test-matrix.md) を参照してください。

---

## 1. ユニットテストの基礎

Flisk は CLI のユニットテストに [Vitest](https://vitest.dev/) を使用しています。

### テストの配置場所

- ユニットテストは、テスト対象のモジュールのすぐ隣にある `__tests__/` ディレクトリに配置します:
  - CLI コマンド: `cli/src/commands/__tests__/<command>.test.ts`
  - コードジェネレーター: `cli/src/generator/__tests__/<generator>.test.ts`
  - 共有ユーティリティ: `cli/src/utils/__tests__/<utility>.test.ts`
- **命名規則**: テストファイルはソースファイルと同じ名前に `.test.ts` を付けて命名します（Ink ベースのターミナル UI コンポーネントの場合は `.test.tsx`）。たとえば、`completion-install.test.ts` は `completion-install.ts` をテストします。

### Vitest の基本構造

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

### テーブル駆動テスト（`it.each`）

純粋な関数やバリデーターには、パラメーター化されたテーブル（`it.each`）を使うのが適しています。入力を処理するすべての関数で、次をテストしてください:
1. **正常系**: 文書化された各形式に対する有効な入力。
2. **空・エラーのケース**: 空文字列、欠落したキー、不正な形式の入力、スローされる例外。
3. **境界条件**: 端の値（例: ポートの最小値と最大値、パスの深さの上限）。

---

このガイドの残りのセクションは英語で提供されています。続きは [08-write-cli-unit-tests.md](../08-write-cli-unit-tests.md) を参照してください。
