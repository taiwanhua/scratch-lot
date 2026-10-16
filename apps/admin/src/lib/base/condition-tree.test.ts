import { describe, expect, it } from "@jest/globals";

import { DataScopeFieldType } from "@repo/graphql";

import {
  appendChild,
  canAddGroupAt,
  locateInTree,
  nodeAt,
  replaceNode,
} from "./condition-tree";
import {
  type DataScopeFieldLike,
  type GroupDraft,
  newCondition,
  newGroup,
} from "./data-scope-rule";

const FIELDS: DataScopeFieldLike[] = [
  {
    name: "status",
    label: "狀態",
    type: DataScopeFieldType.Enum,
    options: [{ value: "draft", label: "草稿" }],
  },
  { name: "orgId", label: "組織", type: DataScopeFieldType.Org, options: [] },
  {
    name: "createdBy",
    label: "建立者",
    type: DataScopeFieldType.User,
    options: [],
  },
  {
    name: "createdAt",
    label: "建立時間",
    type: DataScopeFieldType.Date,
    options: [],
  },
];

const fieldOf = (name: string): DataScopeFieldLike =>
  FIELDS.find((field) => field.name === name) ?? FIELDS[0];

/** 三層:根群組 → 子群組 → 孫群組(UI 的上限)。 */
const threeLevels = (): GroupDraft => {
  const root = newGroup(fieldOf("status"));
  const withGroup = appendChild(root, [], newGroup(fieldOf("orgId")));
  return appendChild(withGroup, [1], newGroup(fieldOf("createdBy")));
};

describe("條件樹的增刪改(位置 = 身分)", () => {
  it("可以往下加到第三層,節點依 childPath 取得", () => {
    const root = threeLevels();

    expect(nodeAt(root, [1, 1])).toMatchObject({ kind: "group", op: "AND" });
    expect(nodeAt(root, [1, 1, 0])).toMatchObject({
      kind: "condition",
      field: "createdBy",
    });
    expect(nodeAt(root, [9])).toBeUndefined();
  });

  it("replaceNode 帶 null 就是刪掉那一個節點,其他節點不受影響", () => {
    const root = threeLevels();
    const next = replaceNode(root, [1, 1], null);

    expect(nodeAt(next, [1])).toMatchObject({ kind: "group" });
    expect((nodeAt(next, [1]) as GroupDraft).children).toHaveLength(1);
    expect(nodeAt(root, [1, 1])).toBeDefined();
  });

  it("換欄位就換掉整條條件列(運算子與值一起重設)", () => {
    const root = newGroup(fieldOf("createdAt"));
    const next = replaceNode(root, [0], newCondition(fieldOf("status")));

    expect(nodeAt(next, [0])).toEqual({
      kind: "condition",
      field: "status",
      cond: "in",
      value: { kind: "static", values: [] },
    });
  });
});

describe("UI 上限三層與錯誤路徑", () => {
  it("根群組與第二層可以再加群組,第三層不行", () => {
    expect(canAddGroupAt([])).toBe(true);
    expect(canAddGroupAt([1])).toBe(true);
    expect(canAddGroupAt([1, 0])).toBe(false);
  });

  it("條件樹路徑 → childPath + 剩下的那一格", () => {
    expect(locateInTree(".children[1].children[0].value.values[0]")).toEqual({
      childPath: [1, 0],
      rest: "value.values[0]",
    });
    expect(locateInTree("")).toEqual({ childPath: [], rest: "" });
    expect(locateInTree(".op")).toEqual({ childPath: [], rest: "op" });
  });
});
