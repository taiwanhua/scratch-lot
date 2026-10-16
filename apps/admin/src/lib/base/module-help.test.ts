import { describe, expect, it } from "@jest/globals";

import { ModuleEngine } from "@repo/graphql";

import {
  FORM_MODULE_HELP_KEY,
  buildHelpRegistry,
  composeHelpRegistry,
  moduleKeyFromHelpPath,
  resolveModuleHelp,
  stripLeadingTitle,
} from "./module-help";

describe("moduleKeyFromHelpPath(檔名 → 模組 key)", () => {
  it("取檔名去掉 .help.md,點號是 key 的一部分", () => {
    expect(
      moduleKeyFromHelpPath("/src/md/module-help/system.org-manager.help.md"),
    ).toBe("system.org-manager");
    expect(
      moduleKeyFromHelpPath("/src/md/module-help/demo.sub.sample-one.help.md"),
    ).toBe("demo.sub.sample-one");
    expect(moduleKeyFromHelpPath("/src/md/module-help/overview.help.md")).toBe(
      "overview",
    );
  });

  it("不是 help.md 的路徑回 null", () => {
    expect(moduleKeyFromHelpPath("/src/md/module-help/README.md")).toBeNull();
    expect(moduleKeyFromHelpPath("/src/md/module-help/.help.md")).toBeNull();
  });
});

describe("stripLeadingTitle(彈窗標題已有模組名,內文不再重複一次)", () => {
  it("拔掉開頭的 `# 模組名`,從第一個小節開始", () => {
    const markdown =
      "# 角色管理\n\n## 這個模組做什麼\n\n角色是一組權限的集合。";

    expect(stripLeadingTitle(markdown)).toBe(
      "## 這個模組做什麼\n\n角色是一組權限的集合。",
    );
  });

  it("開頭不是 h1 就原樣保留(含內文中間的 h1)", () => {
    const markdown = "## 這個模組做什麼\n\n內文\n\n# 中間的大標";

    expect(stripLeadingTitle(markdown)).toBe(markdown);
  });
});

describe("buildHelpRegistry(glob 產物 → 模組 key 對照表)", () => {
  it("每個檔案一筆,內容已去掉開頭標題", () => {
    const registry = buildHelpRegistry({
      "/src/md/module-help/overview.help.md":
        "# 總覽\n\n## 這個模組做什麼\n\n看重點。",
      "/src/md/module-help/system.org-manager.help.md":
        "## 這個模組做什麼\n\n管組織。",
    });

    expect([...registry.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual(
      ["overview", "system.org-manager"],
    );
    expect(registry.get("overview")).toBe("## 這個模組做什麼\n\n看重點。");
  });

  it("空白的、或只有標題的 help.md 當作沒有說明,不收進表裡", () => {
    const registry = buildHelpRegistry({
      "/src/md/module-help/blank.help.md": "   \n\n",
      "/src/md/module-help/title-only.help.md": "# 只有標題\n",
      "/src/md/module-help/ok.help.md": "## 有內容\n\n嗨。",
    });

    expect([...registry.keys()]).toEqual(["ok"]);
  });
});

describe("composeHelpRegistry(底座 / 專案新增 / 專案替換 → 一張對照表)", () => {
  const BASE = "/src/md/module-help/base";
  const ADDITIONS = "/src/md/module-help/project/additions";
  const REPLACEMENTS = "/src/md/module-help/project/replacements";
  const base = {
    [`${BASE}/overview.help.md`]: "# 總覽\n\n## 這個模組做什麼\n\n底座總覽。",
    [`${BASE}/system.role-manager.help.md`]: "## 這個模組做什麼\n\n底座角色。",
    [`${BASE}/form-module.help.md`]: "## 這個模組做什麼\n\n表單通用。",
  };

  it("專案來源是空的:結果就是底座那一份", () => {
    const registry = composeHelpRegistry({
      base,
      additions: {},
      replacements: {},
    });

    expect(registry).toEqual(buildHelpRegistry(base));
  });

  it("新增多一筆;替換換掉同 key 的底座說明,沒被替換的仍是原說明", () => {
    const registry = composeHelpRegistry({
      base,
      additions: {
        [`${ADDITIONS}/project.report.help.md`]:
          "# 報表\n\n## 這個模組做什麼\n\n專案報表。",
      },
      replacements: {
        [`${REPLACEMENTS}/system.role-manager.help.md`]:
          "# 角色\n\n## 這個模組做什麼\n\n客製角色。",
      },
    });

    expect(registry.get("project.report")).toBe(
      "## 這個模組做什麼\n\n專案報表。",
    );
    expect(registry.get("system.role-manager")).toBe(
      "## 這個模組做什麼\n\n客製角色。",
    );
    expect(registry.get("overview")).toBe("## 這個模組做什麼\n\n底座總覽。");
    expect(registry.get(FORM_MODULE_HELP_KEY)).toBe(
      "## 這個模組做什麼\n\n表單通用。",
    );
  });

  it("拿掉替換就回到底座原說明;輸入不被修改", () => {
    const replacements = Object.freeze({
      [`${REPLACEMENTS}/overview.help.md`]: "## 客製\n\n客製總覽。",
    });
    const frozenBase = Object.freeze({ ...base });

    const replaced = composeHelpRegistry({
      base: frozenBase,
      additions: {},
      replacements,
    });
    const restored = composeHelpRegistry({
      base: frozenBase,
      additions: {},
      replacements: {},
    });

    expect(replaced.get("overview")).toBe("## 客製\n\n客製總覽。");
    expect(restored.get("overview")).toBe("## 這個模組做什麼\n\n底座總覽。");
    expect(frozenBase).toEqual(base);
  });

  it("同一個來源裡兩個檔案對到同一個 key:拒絕並列出兩個路徑", () => {
    expect(() =>
      composeHelpRegistry({
        base: {
          ...base,
          [`${BASE}/nested/overview.help.md`]: "## 重複\n\n另一份總覽。",
        },
        additions: {},
        replacements: {},
      }),
    ).toThrow(
      /overview.*base\/overview\.help\.md.*nested\/overview\.help\.md/s,
    );
  });

  it("新增與底座撞 key:拒絕(要換掉底座說明請放替換)", () => {
    expect(() =>
      composeHelpRegistry({
        base,
        additions: { [`${ADDITIONS}/overview.help.md`]: "## 撞\n\n撞到了。" },
        replacements: {},
      }),
    ).toThrow(/overview.*additions\/overview\.help\.md/s);
  });

  it("替換不存在的底座說明:拒絕(專案新增的說明也不是替換目標)", () => {
    expect(() =>
      composeHelpRegistry({
        base,
        additions: {},
        replacements: { [`${REPLACEMENTS}/system.nope.help.md`]: "## x\n\ny" },
      }),
    ).toThrow(/system\.nope.*replacements\/system\.nope\.help\.md/s);
    expect(() =>
      composeHelpRegistry({
        base,
        additions: { [`${ADDITIONS}/project.report.help.md`]: "## a\n\nb" },
        replacements: {
          [`${REPLACEMENTS}/project.report.help.md`]: "## x\n\ny",
        },
      }),
    ).toThrow(/project\.report/);
  });

  it("同一份底座說明被替換兩次:拒絕", () => {
    expect(() =>
      composeHelpRegistry({
        base,
        additions: {},
        replacements: {
          [`${REPLACEMENTS}/overview.help.md`]: "## 一\n\n第一份。",
          [`${REPLACEMENTS}/again/overview.help.md`]: "## 二\n\n第二份。",
        },
      }),
    ).toThrow(
      /overview.*replacements\/overview\.help\.md.*again\/overview\.help\.md/s,
    );
  });

  it.each([
    ["全空白", "  \n\n"],
    ["只有標題", "# 總覽\n"],
  ])("空白的替換(%s):拒絕,不能把底座說明換成沒有", (_label, content) => {
    expect(() =>
      composeHelpRegistry({
        base,
        additions: {},
        replacements: { [`${REPLACEMENTS}/overview.help.md`]: content },
      }),
    ).toThrow(/overview.*空白/s);
  });

  it("模組 key 剛好是物件原型上的名字也只認登記過的", () => {
    const registry = composeHelpRegistry({
      base,
      additions: {},
      replacements: {},
    });

    expect(registry.get("constructor")).toBeUndefined();
    expect(() =>
      composeHelpRegistry({
        base,
        additions: {},
        replacements: {
          [`${REPLACEMENTS}/constructor.help.md`]: "## x\n\ny",
        },
      }),
    ).toThrow(/constructor/);
  });
});

describe("resolveModuleHelp(模組 → 用哪一份說明)", () => {
  const registry = new Map([
    [FORM_MODULE_HELP_KEY, "表單通用"],
    ["form-special", "表單專屬"],
    ["system.org-manager", "組織管理"],
  ]);

  it("專屬檔優先(表單模組也一樣)", () => {
    expect(
      resolveModuleHelp(registry, {
        key: "form-special",
        engine: ModuleEngine.Form,
      }),
    ).toBe("表單專屬");
    expect(
      resolveModuleHelp(registry, {
        key: "system.org-manager",
        engine: ModuleEngine.Fixed,
      }),
    ).toBe("組織管理");
  });

  it("表單模組沒有專屬檔 → 通用說明;固定欄位模組沒有 → undefined", () => {
    expect(
      resolveModuleHelp(registry, { key: "form-x", engine: ModuleEngine.Form }),
    ).toBe("表單通用");
    expect(
      resolveModuleHelp(registry, {
        key: "fixed-x",
        engine: ModuleEngine.Fixed,
      }),
    ).toBeUndefined();
  });
});
