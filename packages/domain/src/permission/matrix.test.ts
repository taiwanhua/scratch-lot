import { describe, expect, it } from "@jest/globals";

import {
  type MatrixModuleTree,
  type PermissionGrant,
  expandGrant,
  isSubsetOf,
  isWholeGroupGranted,
  normalizeGrant,
  toggleWholeGroup,
} from ".";

/**
 * 夾具:縮小版的種子模組樹(形狀對照 seeds/base/modules/*.ts)。
 * 群組與純權限容器也是模組(各自有 `*`,ADR-0004「每個模組固定有一筆 `模組key.*`」)。
 */
const tree: MatrixModuleTree = [
  {
    key: "system",
    permissions: [{ key: "system.*" }],
    children: [
      {
        key: "system.org-manager",
        permissions: [
          { key: "system.org-manager.*" },
          { key: "system.org-manager.view" },
          { key: "system.org-manager.create-child" },
          { key: "system.org-manager.edit" },
        ],
        children: [
          {
            key: "system.org-manager.tenant-ops",
            permissions: [
              { key: "system.org-manager.tenant-ops.provision" },
              { key: "system.org-manager.tenant-ops.transfer-owner" },
            ],
          },
        ],
      },
      {
        key: "system.user-manager",
        permissions: [
          { key: "system.user-manager.view" },
          { key: "system.user-manager.create" },
        ],
      },
    ],
  },
  {
    key: "demo",
    permissions: [{ key: "demo.*" }],
    children: [
      {
        key: "demo.sub",
        permissions: [{ key: "demo.sub.*" }],
        children: [
          {
            key: "demo.sub.sample-one",
            permissions: [
              { key: "demo.sub.sample-one.view" },
              { key: "demo.sub.sample-one.edit" },
            ],
            children: [
              {
                key: "demo.sub.sample-one.edit-page",
                permissions: [
                  { key: "demo.sub.sample-one.edit-page.show-history" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

const grantOf = (
  moduleKeys: readonly string[],
  permissionKeys: readonly string[],
): PermissionGrant => ({ moduleKeys, permissionKeys });

describe("normalizeGrant:「勾下層模組必連動勾上層」(role-manager.md 權限矩陣規則)", () => {
  it("勾最深的模組 → 祖先模組全部補上(樹必然完整,ADR-0011 第 3 步)", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(["demo.sub.sample-one.edit-page"], []),
    );

    expect(normalized.moduleKeys).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
      "demo.sub.sample-one.edit-page",
    ]);
  });

  it("只勾一筆權限(沒勾模組)→ 補上它的擁有模組與該模組的祖先", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf([], ["demo.sub.sample-one.edit-page.show-history"]),
    );

    expect(normalized.moduleKeys).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
      "demo.sub.sample-one.edit-page",
    ]);
    expect(normalized.permissionKeys).toEqual([
      "demo.sub.sample-one.edit-page.*",
    ]);
  });
});

describe("normalizeGrant:「有子孫被勾的上層為勾選且不可取消」(role-manager.md 權限矩陣規則)", () => {
  it("硬把上層模組從送出的清單拿掉,只要子孫還在就被補回來", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(["demo.sub.sample-one"], []),
    );

    expect(normalized.moduleKeys).toContain("demo");
    expect(normalized.moduleKeys).toContain("demo.sub");
  });

  it("子孫一起拿掉時,上層才真的能取消", () => {
    const normalized = normalizeGrant(tree, grantOf(["system"], []));

    expect(normalized.moduleKeys).toEqual(["system"]);
  });
});

describe("normalizeGrant:「每個模組都有一列『全部(`*`)』與同層權限互斥連動」(role-manager.md)+ ADR-0004「儲存」", () => {
  it("同層權限全勾 → 只存該模組的 `*` 一筆", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(
        ["system.user-manager"],
        ["system.user-manager.view", "system.user-manager.create"],
      ),
    );

    expect(normalized.permissionKeys).toEqual(["system.user-manager.*"]);
  });

  it("取消同層其中一筆 → 刪 `*`、存剩餘個別筆", () => {
    const stored = normalizeGrant(
      tree,
      grantOf(
        ["system.org-manager"],
        [
          "system.org-manager.view",
          "system.org-manager.create-child",
          "system.org-manager.edit",
        ],
      ),
    );
    expect(stored.permissionKeys).toEqual(["system.org-manager.*"]);

    // UI 把儲存的 `*` 展開成三筆後,使用者取消「編輯」一筆再送出
    const expanded = expandGrant(tree, stored);
    const afterUncheck = normalizeGrant(
      tree,
      grantOf(
        expanded.moduleKeys,
        expanded.permissionKeys.filter(
          (key) =>
            key !== "system.org-manager.edit" && key !== "system.org-manager.*",
        ),
      ),
    );

    expect(afterUncheck.permissionKeys).toEqual([
      "system.org-manager.view",
      "system.org-manager.create-child",
    ]);
  });

  it("勾 `*` 即代表同層全勾(含未來新增),重新正規化仍維持單筆 `*`", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(["system.user-manager"], ["system.user-manager.*"]),
    );

    expect(normalized.permissionKeys).toEqual(["system.user-manager.*"]);
    expect(normalizeGrant(tree, normalized)).toEqual(normalized);
  });

  it("`*` 的收斂只影響那個模組,其他模組不受影響(ADR-0004「其他模組不受影響」)", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(
        [],
        [
          "system.user-manager.view",
          "system.user-manager.create",
          "system.org-manager.view",
        ],
      ),
    );

    expect(normalized.permissionKeys).toEqual([
      "system.org-manager.view",
      "system.user-manager.*",
    ]);
  });

  it("沒有個別權限的模組(群組、只有 `*` 的節點)不會被「全勾」推導出 `*`,沒勾就是沒有", () => {
    const normalized = normalizeGrant(tree, grantOf(["system"], []));

    expect(normalized.permissionKeys).toEqual([]);
  });
});

describe("normalizeGrant / expandGrant:「`*` 只代表該模組自己這層」(ADR-0004 同層語意)", () => {
  it("父模組的 `*` 不展開成子模組的權限", () => {
    const expanded = expandGrant(
      tree,
      grantOf(["demo.sub.sample-one"], ["demo.sub.sample-one.*"]),
    );

    expect(expanded.permissionKeys).toEqual([
      "demo.sub.sample-one.*",
      "demo.sub.sample-one.view",
      "demo.sub.sample-one.edit",
    ]);
  });

  it("子模組同層全勾只收斂子模組自己的 `*`,不影響父模組", () => {
    const normalized = normalizeGrant(
      tree,
      grantOf(
        [],
        [
          "demo.sub.sample-one.view",
          "demo.sub.sample-one.edit-page.show-history",
        ],
      ),
    );

    expect(normalized.permissionKeys).toEqual([
      "demo.sub.sample-one.view",
      "demo.sub.sample-one.edit-page.*",
    ]);
  });
});

describe("expandGrant:把 `*` 展開成同層全部給 UI 顯示(ADR-0011 `me.modules.permissions` 同形狀)", () => {
  it("展開後 `*` 本身保留(矩陣的「全部」列要顯示勾選),再正規化回得去原形(round-trip)", () => {
    const stored = grantOf(
      ["system", "system.user-manager"],
      ["system.user-manager.*"],
    );
    const expanded = expandGrant(tree, stored);

    expect(expanded.permissionKeys).toEqual([
      "system.user-manager.*",
      "system.user-manager.view",
      "system.user-manager.create",
    ]);
    expect(normalizeGrant(tree, expanded)).toEqual(
      normalizeGrant(tree, stored),
    );
  });

  it("沒有 `*` 的個別筆原樣保留,樹外的 key 不顯示", () => {
    const expanded = expandGrant(
      tree,
      grantOf(
        ["system.user-manager", "nowhere"],
        ["system.user-manager.view", "nowhere.view"],
      ),
    );

    expect(expanded).toEqual({
      moduleKeys: ["system.user-manager"],
      permissionKeys: ["system.user-manager.view"],
    });
  });
});

describe("toggleWholeGroup:「全選整組 / 清空整組 = 對子樹每個模組寫入或清除 `*`」(role-manager.md;ADR-0004「整組全給」)", () => {
  it("全選整組 → 子樹每個模組各一筆 `*`(含群組本身與純權限容器)", () => {
    const result = toggleWholeGroup(tree, grantOf([], []), "system", true);

    expect(result.moduleKeys).toEqual([
      "system",
      "system.org-manager",
      "system.org-manager.tenant-ops",
      "system.user-manager",
    ]);
    expect(result.permissionKeys).toEqual([
      "system.*",
      "system.org-manager.*",
      "system.org-manager.tenant-ops.*",
      "system.user-manager.*",
    ]);
  });

  it("清空整組 → 子樹的模組與權限一起清掉,子樹以外不受影響", () => {
    // 兩組都全給後再清掉 system 這組
    const systemOn = toggleWholeGroup(tree, grantOf([], []), "system", true);
    const both = toggleWholeGroup(tree, systemOn, "demo", true);
    const cleared = toggleWholeGroup(tree, both, "system", false);

    expect(cleared.moduleKeys).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
      "demo.sub.sample-one.edit-page",
    ]);
    expect(cleared.permissionKeys).toEqual([
      "demo.*",
      "demo.sub.*",
      "demo.sub.sample-one.*",
      "demo.sub.sample-one.edit-page.*",
    ]);
  });

  it("整組全給後再全給一次是冪等的", () => {
    const once = toggleWholeGroup(tree, grantOf([], []), "demo", true);
    const twice = toggleWholeGroup(tree, once, "demo", true);

    expect(twice).toEqual(once);
  });
});

/**
 * 顯示樹(`roleMatrix.modules`)會把操作者搆不到的 `*` 列剪掉,群組節點因此可能
 * **一列權限都沒有**。整組開關若照樣寫一筆 `<群組>.*`,使用者在矩陣上看不到那一列、
 * 也就取消不掉,送出只會換來 `ROLE_OUT_OF_REACH`。
 */
describe("整層沒有權限的模組不推導 `*`(顯示樹剪掉 `*` 列的群組)", () => {
  /** `demo` / `demo.sub` 這兩個群組的 `*` 列被剪掉(操作者只搆得到底下的葉模組)。 */
  const prunedTree: MatrixModuleTree = [
    {
      key: "demo",
      children: [
        {
          key: "demo.sub",
          children: [
            {
              key: "demo.sub.sample-one",
              permissions: [
                { key: "demo.sub.sample-one.*" },
                { key: "demo.sub.sample-one.view" },
                { key: "demo.sub.sample-one.edit" },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("全選整組:只給搆得到的那幾層 `*`,不生群組自己的 `<群組>.*`", () => {
    const result = toggleWholeGroup(prunedTree, grantOf([], []), "demo", true);

    expect(result.moduleKeys).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
    ]);
    expect(result.permissionKeys).toEqual(["demo.sub.sample-one.*"]);
  });

  it("整組開關的勾選狀態仍衍生得出來(不要求不存在的 `<群組>.*`)", () => {
    const granted = toggleWholeGroup(prunedTree, grantOf([], []), "demo", true);

    expect(isWholeGroupGranted(prunedTree, granted, "demo")).toBe(true);
  });

  it("硬送 `<群組>.*` 也會被當成樹外的 key 丟掉(規則 1)", () => {
    const result = normalizeGrant(
      prunedTree,
      grantOf(["demo"], ["demo.*", "demo.sub.*"]),
    );

    expect(result.permissionKeys).toEqual([]);
    expect(result.moduleKeys).toEqual(["demo"]);
  });

  /**
   * `expandGrant` 跟上 M-10 —— 角色實際持有 `demo.*`(操作者搆不到的那一筆),
   * 餵顯示樹展開時不得冒出一筆矩陣上沒有對應列的 `demo.*`;搆得到的那幾層照常展開。
   */
  it("expandGrant:整層被剪掉的模組持有的 `*` 不展開,搆得到的那層照常展開", () => {
    const result = expandGrant(
      prunedTree,
      grantOf(
        ["demo", "demo.sub", "demo.sub.sample-one"],
        ["demo.*", "demo.sub.*", "demo.sub.sample-one.*"],
      ),
    );

    expect(result.moduleKeys).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
    ]);
    expect(result.permissionKeys).toEqual([
      "demo.sub.sample-one.*",
      "demo.sub.sample-one.view",
      "demo.sub.sample-one.edit",
    ]);
  });
});

describe("isWholeGroupGranted:「群組列的勾選狀態是衍生的(子樹全部有 `*` 才顯示勾),不另存」(ADR-0004)", () => {
  it("子樹每個模組都有 `*` → 衍生為勾選", () => {
    const granted = toggleWholeGroup(tree, grantOf([], []), "system", true);

    expect(isWholeGroupGranted(tree, granted, "system")).toBe(true);
  });

  it("子樹裡少一個模組的 `*` → 不顯示勾(沒有另外存一筆群組記錄)", () => {
    const granted = toggleWholeGroup(tree, grantOf([], []), "system", true);
    const missingOne = grantOf(
      granted.moduleKeys,
      granted.permissionKeys.filter(
        (key) => key !== "system.org-manager.tenant-ops.*",
      ),
    );

    expect(isWholeGroupGranted(tree, missingOne, "system")).toBe(false);
  });

  it("同層全勾的模組會收斂成 `*`,所以「逐筆勾滿整組」也等於整組全給", () => {
    const manual = grantOf(
      [
        "system",
        "system.org-manager",
        "system.org-manager.tenant-ops",
        "system.user-manager",
      ],
      [
        // 群組與容器沒有個別權限可勾滿,仍要 `*` 本身
        "system.*",
        "system.org-manager.view",
        "system.org-manager.create-child",
        "system.org-manager.edit",
        "system.org-manager.tenant-ops.provision",
        "system.org-manager.tenant-ops.transfer-owner",
        "system.user-manager.view",
        "system.user-manager.create",
      ],
    );

    expect(isWholeGroupGranted(tree, manual, "system")).toBe(true);
    expect(normalizeGrant(tree, manual)).toEqual(
      toggleWholeGroup(tree, grantOf([], []), "system", true),
    );
  });
});

describe("isSubsetOf:「操作者只能授出自身有效權限集的子集」(ADR-0004 防越權;模組勾選同理)", () => {
  const holder = grantOf(
    ["system", "system.user-manager", "system.org-manager"],
    ["system.user-manager.*", "system.org-manager.view"],
  );

  it("精確持有的權限可以授出", () => {
    expect(
      isSubsetOf(
        grantOf(["system", "system.org-manager"], ["system.org-manager.view"]),
        holder,
      ),
    ).toBe(true);
  });

  it("「持有 X.* 可授出 X 這層的任何權限」— 個別筆與 `*` 本身都算子集", () => {
    expect(
      isSubsetOf(
        grantOf(
          ["system", "system.user-manager"],
          ["system.user-manager.view"],
        ),
        holder,
      ),
    ).toBe(true);
    expect(
      isSubsetOf(
        grantOf(["system", "system.user-manager"], ["system.user-manager.*"]),
        holder,
      ),
    ).toBe(true);
  });

  it("holder 只持有個別筆時,授出該模組的 `*` 是越權(`*` 含未來新增)", () => {
    expect(
      isSubsetOf(
        grantOf(["system", "system.org-manager"], ["system.org-manager.*"]),
        holder,
      ),
    ).toBe(false);
  });

  it("「子模組的 `*` 要自己持有才能授出」— 父模組的 `*` 不涵蓋子模組", () => {
    const parentWildcardHolder = grantOf(
      [
        "demo",
        "demo.sub",
        "demo.sub.sample-one",
        "demo.sub.sample-one.edit-page",
      ],
      ["demo.sub.sample-one.*"],
    );

    expect(
      isSubsetOf(
        grantOf(
          [
            "demo",
            "demo.sub",
            "demo.sub.sample-one",
            "demo.sub.sample-one.edit-page",
          ],
          ["demo.sub.sample-one.edit-page.show-history"],
        ),
        parentWildcardHolder,
      ),
    ).toBe(false);
  });

  it("「模組勾選同理 — 只能勾自己也有路由的模組」", () => {
    expect(isSubsetOf(grantOf(["demo", "demo.sub"], []), holder)).toBe(false);
  });

  it("空的授予是任何人的子集(全部取消勾選一定合法)", () => {
    expect(isSubsetOf(grantOf([], []), holder)).toBe(true);
  });
});
