import { describe, expect, it } from "@jest/globals";

import { type OrgNodeLike, toTreeNodes } from "./org-tree";

const tree: OrgNodeLike[] = [
  {
    id: "org-co",
    name: "示範公司",
    parentId: null,
    enabled: true,
    outOfScope: false,
    children: [
      {
        id: "org-a",
        name: "A 店",
        parentId: "org-co",
        enabled: true,
        outOfScope: false,
        children: [],
      },
      {
        id: "org-x",
        name: "X 店",
        parentId: "org-co",
        enabled: true,
        outOfScope: true,
        children: [],
      },
    ],
  },
];

describe("toTreeNodes", () => {
  it("範圍外與 disabledIds 裡的節點都停用,其餘照常可選", () => {
    const [root] = toTreeNodes(tree, undefined, new Set(["org-a"]));

    expect(root.disabled).toBe(false);
    expect(root.children?.map((child) => [child.id, child.disabled])).toEqual([
      ["org-a", true],
      ["org-x", true],
    ]);
  });

  it("不給 disabledIds 時只有範圍外停用(既有呼叫端行為不變)", () => {
    const [root] = toTreeNodes(tree);

    expect(root.children?.map((child) => child.disabled)).toEqual([
      false,
      true,
    ]);
  });
});
