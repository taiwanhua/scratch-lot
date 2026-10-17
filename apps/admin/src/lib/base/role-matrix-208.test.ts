import { describe, expect, it } from "@jest/globals";

import type { MatrixModuleTree } from "@repo/domain/permission";

import {
  isSameGrant,
  matrixSelectionOf,
  nextGrantFromSelection,
  ungrantedMatrixRowIds,
} from "./role-matrix-208";

/** 與 `test/msw/role-fixtures.ts` 同形的小樹(群組 → 次群組 → 模組 + 另一個模組)。 */
const tree: MatrixModuleTree = [
  {
    key: "demo",
    permissions: [{ key: "demo.*" }],
    children: [
      {
        key: "demo.sub",
        permissions: [{ key: "demo.sub.*" }],
        children: [
          {
            key: "demo.sub.one",
            permissions: [
              { key: "demo.sub.one.*" },
              { key: "demo.sub.one.view" },
              { key: "demo.sub.one.edit" },
            ],
          },
        ],
      },
      { key: "demo.two", permissions: [{ key: "demo.two.*" }] },
    ],
  },
];

const granted = {
  moduleKeys: ["demo", "demo.sub", "demo.sub.one"],
  permissionKeys: ["demo.sub.one.view"],
};

const idsOf = (grant: Parameters<typeof matrixSelectionOf>[1]) =>
  matrixSelectionOf(tree, grant).checkedIds;

describe("role-matrix-208", () => {
  it("有子孫模組被勾的上層不可取消,自己這層沒全勾的模組是三態", () => {
    const selection = matrixSelectionOf(tree, granted);

    expect(selection.disabledCheckIds).toEqual(["demo", "demo.sub"]);
    expect(selection.indeterminateIds).toContain("demo.sub.one");
    expect(selection.checkedIds).toContain("demo.sub.one.view");
  });

  it("勾同層最後一筆會收斂成 `*`,取消任一筆則解除 `*`", () => {
    const all = nextGrantFromSelection(tree, idsOf(granted), [
      ...idsOf(granted),
      "demo.sub.one.edit",
    ]);
    expect(all.permissionKeys).toEqual(["demo.sub.one.*"]);

    const afterUncheck = nextGrantFromSelection(
      tree,
      idsOf(all),
      idsOf(all).filter((id) => id !== "demo.sub.one.view"),
    );
    expect(afterUncheck.permissionKeys).toEqual(["demo.sub.one.edit"]);
  });

  it("取消「全部(*)」會清掉該模組這一層", () => {
    const withWildcard = nextGrantFromSelection(tree, idsOf(granted), [
      ...idsOf(granted),
      "demo.sub.one.*",
    ]);
    const cleared = nextGrantFromSelection(
      tree,
      idsOf(withWildcard),
      idsOf(withWildcard).filter((id) => id !== "demo.sub.one.*"),
    );

    expect(cleared.permissionKeys).toEqual([]);
    expect(cleared.moduleKeys).toEqual(["demo", "demo.sub", "demo.sub.one"]);
  });

  it("取消模組會連同它的子樹與權限一起清掉", () => {
    const cleared = nextGrantFromSelection(
      tree,
      idsOf(granted),
      idsOf(granted).filter((id) => id !== "demo.sub.one"),
    );

    expect(cleared.moduleKeys).toEqual(["demo", "demo.sub"]);
    expect(cleared.permissionKeys).toEqual([]);
  });

  it("勾一筆權限會自動補上擁有模組與祖先(normalizeGrant 的規則)", () => {
    const next = nextGrantFromSelection(tree, [], ["demo.sub.one.view"]);

    expect(next.moduleKeys).toEqual(["demo", "demo.sub", "demo.sub.one"]);
  });

  it("租戶副本:目前沒有的列一律列進不可勾", () => {
    const locked = ungrantedMatrixRowIds(tree, granted);

    expect(locked).toContain("demo.sub.one.edit");
    expect(locked).toContain("demo.two");
    expect(locked).not.toContain("demo.sub.one.view");
  });

  it("正規化後相同的兩份授予算沒有變更", () => {
    expect(
      isSameGrant(tree, granted, {
        moduleKeys: ["demo.sub.one", "demo", "demo.sub"],
        permissionKeys: ["demo.sub.one.view"],
      }),
    ).toBe(true);
  });
});
