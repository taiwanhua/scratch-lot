import { describe, expect, it } from "vitest";

/**
 * Durable Object 必用 WebSocket Hibernation API(`ctx.acceptWebSocket`),不得用 `ws.accept()`
 * (後者讓 Durable Object 在連線期間常駐、持續計費)。掃 `src/` 的正式程式碼把關。
 */
const sources = Object.entries(
  import.meta.glob("./**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).filter(
  ([path]) =>
    !path.endsWith(".test.ts") &&
    !path.endsWith(".d.ts") &&
    !path.includes("test-support"),
);

/** 去掉註解行(`//`、`/*`、`*` 開頭),避免說明文字裡提到的 API 名稱被誤判。 */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      );
    })
    .join("\n");
}

describe("Durable Object 必用 WebSocket Hibernation API", () => {
  it("有掃到正式程式碼", () => {
    expect(sources.map(([path]) => path)).toEqual(
      expect.arrayContaining(["./index.ts", "./tenant-hub.ts"]),
    );
  });

  it("正式程式碼不出現 `.accept()`", () => {
    const offenders = sources
      .filter(([, source]) => /\.accept\s*\(\s*\)/.test(stripComments(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("接下連線用 `ctx.acceptWebSocket`,連線資訊放 attachment", () => {
    const hub = stripComments(
      sources.find(([path]) => path === "./tenant-hub.ts")?.[1] ?? "",
    );
    expect(hub).toMatch(/this\.ctx\.acceptWebSocket\(/);
    expect(hub).toMatch(/\.serializeAttachment\(/);
    expect(hub).toMatch(/override async webSocketMessage\(/);
  });
});
