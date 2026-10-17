import { describe, expect, it } from "@jest/globals";

import type { AssigneeSource, WorkflowDefinition } from "@repo/domain/workflow";

import { workflowVersionDiff } from "./version-diff";

const definitionWith = (cc?: AssigneeSource | null): WorkflowDefinition => ({
  steps: [
    {
      key: "boss",
      name: "主管",
      assignee: { kind: "manager", level: 1 },
      mode: "any",
    },
  ],
  edges: null,
  ...(cc !== undefined && { cc }),
});

const MANAGER_1: AssigneeSource = { kind: "manager", level: 1 };

describe("workflowVersionDiff:整個流程的知會對象", () => {
  it("上一版沒設、這一版設了 → 新增", () => {
    expect(
      workflowVersionDiff(definitionWith(), definitionWith(MANAGER_1))
        .flowCcChange,
    ).toBe("added");
  });

  it("上一版有、這一版清掉 → 移除", () => {
    expect(
      workflowVersionDiff(definitionWith(MANAGER_1), definitionWith(null))
        .flowCcChange,
    ).toBe("removed");
  });

  it("來源不同 → 修改", () => {
    expect(
      workflowVersionDiff(
        definitionWith(MANAGER_1),
        definitionWith({ kind: "manager", level: 2 }),
      ).flowCcChange,
    ).toBe("changed");
  });

  it("沒設與 null 相同、鍵順序不同 → 沒變;關卡差異不受影響", () => {
    expect(
      workflowVersionDiff(definitionWith(), definitionWith(null)).flowCcChange,
    ).toBeNull();
    const diff = workflowVersionDiff(
      definitionWith({ level: 1, kind: "manager" }),
      definitionWith(MANAGER_1),
    );
    expect(diff.flowCcChange).toBeNull();
    expect(diff.changed).toEqual([]);
  });
});

describe("workflowVersionDiff:關卡內容以正規形比對", () => {
  it("鍵順序不同、cc: null 與缺鍵的關卡不算變更;真的改了才算", () => {
    const before = definitionWith();
    const reordered: WorkflowDefinition = {
      steps: [
        {
          mode: "any",
          assignee: { level: 1, kind: "manager" },
          name: "主管",
          key: "boss",
          cc: null,
        },
      ],
      edges: null,
    };
    expect(workflowVersionDiff(before, reordered).changed).toEqual([]);
    const renamed: WorkflowDefinition = {
      ...before,
      steps: [{ ...before.steps[0], name: "主管審核" }],
    };
    expect(workflowVersionDiff(before, renamed).changed).toEqual(["主管審核"]);
  });
});
