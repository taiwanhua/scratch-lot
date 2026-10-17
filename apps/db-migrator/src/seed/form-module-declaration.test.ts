import { describe, expect, it } from "@jest/globals";

import {
  type FormModuleSpec,
  formModuleDeclaration,
} from "../../seeds/base/form-module-declaration";

const SPEC: FormModuleSpec = {
  key: "store",
  name: "門市",
  parentKey: null,
  route: "store",
  order: 1,
  icon: "description",
  description: "測試用表單模組",
};

function permissionKeysOf(spec: FormModuleSpec): string[] {
  return (formModuleDeclaration(spec).permissions ?? []).map(
    (permission) => permission.key,
  );
}

describe("表單模組宣告的頁內權限(B9a)", () => {
  it("沒宣告 → 只有固定四條", () => {
    expect(permissionKeysOf(SPEC)).toEqual([
      "store.view",
      "store.create",
      "store.edit",
      "store.delete",
    ]);
  });

  it('宣告 `permissions: [{ action: "sell", name: "銷售" }]` → 和固定四條一起產生 `<模組>.sell`', () => {
    const declaration = formModuleDeclaration({
      ...SPEC,
      permissions: [
        { action: "sell", name: "銷售" },
        { action: "print-label", name: "列印標籤", description: "列表的列印" },
      ],
    });
    expect(declaration.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "store.view" }),
        expect.objectContaining({ key: "store.delete" }),
        { key: "store.sell", moduleKey: "store", name: "銷售" },
        {
          key: "store.print-label",
          moduleKey: "store",
          name: "列印標籤",
          description: "列表的列印",
        },
      ]),
    );
    expect(declaration.permissions).toHaveLength(6);
  });

  it("動作和固定四條、wildcard 或表單動態權限的形狀衝突 → 宣告時就擋下", () => {
    for (const action of [
      "view",
      "create",
      "*",
      "show-a-b",
      "edit-a-b",
      "create-a",
    ]) {
      expect(() =>
        formModuleDeclaration({
          ...SPEC,
          permissions: [{ action, name: "衝突" }],
        }),
      ).toThrow(/衝突/);
    }
  });
});

function mainNode(spec: FormModuleSpec) {
  return formModuleDeclaration(spec).nodes.find(
    (node) => node.key === spec.key,
  );
}

describe("表單模組依表單分開新增權限(B9b)的宣告", () => {
  it("沒宣告 → 主節點不帶 perFormCreate(落庫為 false),固定四條照舊", () => {
    expect(mainNode(SPEC)?.perFormCreate).toBeUndefined();
    expect(permissionKeysOf(SPEC)).toContain("store.create");
  });

  it("宣告 `perFormCreate: true` → 只標在主節點;權限仍是固定四條(`create-<formKey>` 由發布時建立)", () => {
    const spec = { ...SPEC, perFormCreate: true };
    const declaration = formModuleDeclaration(spec);
    expect(mainNode(spec)?.perFormCreate).toBe(true);
    expect(
      declaration.nodes
        .filter((node) => node.key !== spec.key)
        .every((node) => node.perFormCreate === undefined),
    ).toBe(true);
    expect(permissionKeysOf(spec)).toEqual([
      "store.view",
      "store.create",
      "store.edit",
      "store.delete",
    ]);
  });
});
