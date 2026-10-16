import { describe, expect, it } from "@jest/globals";

import { dropTargetOf } from "./flow-drop";
import type { FlowLayout } from "./flow-layout";

/** 初審在上;財務、法務並排在中間;匯合在下。 */
const layout: FlowLayout = {
  nodes: [
    { key: "review", kind: "review", x: 100, y: 0, width: 200, height: 100 },
    { key: "finance", kind: "review", x: 0, y: 200, width: 200, height: 100 },
    { key: "legal", kind: "review", x: 300, y: 200, width: 200, height: 100 },
    { key: "merge", kind: "join", x: 172, y: 400, width: 56, height: 56 },
  ],
  edges: [],
};

describe("拖節點放開時要放哪", () => {
  it("放在某關中心的上方 → 插在它之前;下方 → 之後", () => {
    expect(dropTargetOf(layout, "review", { x: 390, y: 230 })).toEqual({
      kind: "before",
      stepKey: "legal",
    });
    expect(dropTargetOf(layout, "review", { x: 110, y: 290 })).toEqual({
      kind: "after",
      stepKey: "finance",
    });
  });

  it("最近的是匯合節點 → 接在匯合之後;不會以自己為參照", () => {
    expect(dropTargetOf(layout, "finance", { x: 200, y: 440 })).toEqual({
      kind: "afterJoin",
      joinKey: "merge",
    });
    expect(dropTargetOf(layout, "finance", { x: 150, y: 100 })).toEqual({
      kind: "after",
      stepKey: "review",
    });
  });

  it("沒有別的節點 → 原地不動", () => {
    expect(
      dropTargetOf({ nodes: layout.nodes.slice(0, 1), edges: [] }, "review", {
        x: 0,
        y: 0,
      }),
    ).toBeNull();
  });
});
