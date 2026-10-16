import { describe, expect, it } from "@jest/globals";

import {
  type PermissionOptionModule,
  filterPermissionOptions,
  permissionLabels,
  permissionModuleKeys,
  toPermissionTreeNodes,
} from "./permission-options";

const MODULES: PermissionOptionModule[] = [
  {
    key: "demo",
    name: "示範群組",
    permissions: [],
    children: [
      {
        key: "demo.sample",
        name: "示範模組",
        permissions: [
          { key: "demo.sample.view", name: "檢視", action: "view" },
          { key: "demo.sample.*", name: "全部", action: "*" },
          { key: "demo.sample.edit", name: "編輯", action: "edit" },
        ],
      },
    ],
  },
  {
    key: "system",
    name: "系統管理",
    permissions: [{ key: "system.audit", name: "稽核", action: "audit" }],
  },
];

describe("權限選項樹", () => {
  it("欄位標籤是「模組 · 權限」,`*` 顯示呼叫端給的「全部」", () => {
    const labels = permissionLabels(MODULES, "全部(*)");

    expect(labels.get("demo.sample.edit")).toBe("示範模組 · 編輯");
    expect(labels.get("demo.sample.*")).toBe("示範模組 · 全部(*)");
  });

  it("模組列在前、自己這層的權限「全部」排最前,模組列的 id 是模組 key", () => {
    const demo = toPermissionTreeNodes(MODULES, "全部", () => null).at(0);
    const sample = demo?.children?.[0];

    expect(demo?.id).toBe("demo");
    expect(sample?.children?.map((node) => node.id)).toEqual([
      "demo.sample.*",
      "demo.sample.view",
      "demo.sample.edit",
    ]);
    expect(permissionModuleKeys(MODULES)).toEqual([
      "demo",
      "demo.sample",
      "system",
    ]);
  });

  it("搜尋:權限名稱命中只留那幾筆與祖先;模組名稱命中整個模組留下;key 也搜得到", () => {
    const byPermission = filterPermissionOptions(MODULES, "編輯", "全部");
    expect(byPermission).toHaveLength(1);
    expect(byPermission[0]?.children?.[0]?.permissions).toEqual([
      { key: "demo.sample.edit", name: "編輯", action: "edit" },
    ]);

    const byModule = filterPermissionOptions(MODULES, "系統", "全部");
    expect(byModule.map((node) => node.key)).toEqual(["system"]);

    const byKey = filterPermissionOptions(MODULES, "system.audit", "全部");
    expect(byKey.map((node) => node.key)).toEqual(["system"]);

    expect(filterPermissionOptions(MODULES, "沒有", "全部")).toEqual([]);
  });
});
