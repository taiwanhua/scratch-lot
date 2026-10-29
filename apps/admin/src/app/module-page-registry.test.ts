import { describe, expect, it } from "@jest/globals";

import { formModulePages } from "@/components/base/form-engine/FormModulePages/form-module-pages";
import { DEFAULT_TAB_LABEL_TEMPLATE } from "@/lib/base/form-engine/tab-label";

import {
  type ModulePageSource,
  type PageComponent,
  composeModulePages,
} from "./module-page-registry";

/** 測試用頁面:每次呼叫一個新身分;只比對身分,不渲染。 */
const page = (name: string): PageComponent => {
  const Page: PageComponent = () => name;
  Page.displayName = name;
  return Page;
};

const BaseOverview = page("BaseOverview");
const BaseRoles = page("BaseRoles");
const BaseDesigner = page("BaseDesigner");
const ProjectReport = page("ProjectReport");
const ProjectRoles = page("ProjectRoles");

const EMPTY: ModulePageSource = { pages: [], forms: [] };

const base: ModulePageSource = {
  pages: [
    { key: "overview", Page: BaseOverview },
    { key: "system.role-manager", Page: BaseRoles },
    { key: "system.forms", Page: BaseDesigner, minWidth: "xl" },
  ],
  forms: [{ moduleKey: "demo-form" }],
};

const compose = (
  input: Partial<Parameters<typeof composeModulePages>[0]> = {},
) => composeModulePages({ base, project: EMPTY, replacements: [], ...input });

describe("composeModulePages:新增", () => {
  it("底座與專案的頁面合成一張表;表單模組展開成四頁", () => {
    const { pages, pageMinWidths } = compose({
      project: {
        pages: [{ key: "project.report", Page: ProjectReport }],
        forms: [{ moduleKey: "project.leave" }],
      },
    });
    const defaults = formModulePages("demo-form");

    expect(
      Object.keys(pages).toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    ).toEqual(
      [
        "demo-form",
        "demo-form.create-page",
        "demo-form.edit-page",
        "demo-form.view-page",
        "overview",
        "project.leave",
        "project.leave.create-page",
        "project.leave.edit-page",
        "project.leave.view-page",
        "project.report",
        "system.forms",
        "system.role-manager",
      ].toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    );
    expect(pages.overview).toBe(BaseOverview);
    expect(pages["project.report"]).toBe(ProjectReport);
    // 四頁沿用表單引擎的預設元件(同一個 lazy 身分,不是每次合成各建一份)
    for (const [key, Page] of Object.entries(defaults)) {
      expect(pages[key]).toBe(Page);
    }
    expect(pages["project.leave.view-page"]).toBe(
      defaults["demo-form.view-page"],
    );
    expect(pageMinWidths).toEqual({ "system.forms": "xl" });
  });

  it("專案表單的單頁客製走 pageOverrides:只換那一頁,寬度明寫才有", () => {
    const CustomList = page("CustomList");
    const CustomView = page("CustomView");
    const { pages, pageMinWidths } = compose({
      project: {
        pages: [],
        forms: [
          {
            moduleKey: "project.leave",
            pageOverrides: {
              list: { Page: CustomList, minWidth: "xl" },
              viewPage: { Page: CustomView },
            },
          },
        ],
      },
    });
    const defaults = formModulePages("project.leave");

    expect(pages["project.leave"]).toBe(CustomList);
    expect(pages["project.leave.view-page"]).toBe(CustomView);
    expect(pages["project.leave.create-page"]).toBe(
      defaults["project.leave.create-page"],
    );
    expect(pages["project.leave.edit-page"]).toBe(
      defaults["project.leave.edit-page"],
    );
    expect(pageMinWidths["project.leave"]).toBe("xl");
    expect(pageMinWidths["project.leave.view-page"]).toBeUndefined();
  });

  it("表單設定跟著 forms 走:沒給模板用預設,不另維護一份 key 清單", () => {
    const { formModuleOptions } = compose({
      project: {
        pages: [],
        forms: [
          {
            moduleKey: "project.leave",
            options: { tabLabelTemplate: "{{applicant}}" },
          },
        ],
      },
    });

    expect([...formModuleOptions.keys()]).toEqual([
      "demo-form",
      "project.leave",
    ]);
    expect(formModuleOptions.get("demo-form")?.tabLabelTemplate).toBe(
      DEFAULT_TAB_LABEL_TEMPLATE,
    );
    expect(formModuleOptions.get("project.leave")?.tabLabelTemplate).toBe(
      "{{applicant}}",
    );
  });
});

describe("composeModulePages:碰撞一律拒絕,錯誤列出 key 與來源", () => {
  it("空 key", () => {
    expect(() =>
      compose({
        project: { pages: [{ key: "", Page: ProjectReport }], forms: [] },
      }),
    ).toThrow(/空的.*project\.pages\[0\]/s);
    expect(() =>
      compose({ project: { pages: [], forms: [{ moduleKey: " " }] } }),
    ).toThrow(/空的.*project\.forms\[0\]/s);
  });

  it("同一個來源重複", () => {
    expect(() =>
      compose({
        project: {
          pages: [
            { key: "project.report", Page: ProjectReport },
            { key: "project.other", Page: ProjectRoles },
            { key: "project.report", Page: ProjectRoles },
          ],
          forms: [],
        },
      }),
    ).toThrow(/project\.report.*project\.pages\[0\].*project\.pages\[2\]/s);
  });

  it("底座與專案撞 key(不能用撞 key 表達替換)", () => {
    expect(() =>
      compose({
        project: {
          pages: [{ key: "system.role-manager", Page: ProjectRoles }],
          forms: [],
        },
      }),
    ).toThrow(/system\.role-manager.*base\.pages\[1\].*project\.pages\[0\]/s);
  });

  it("表單展開的四頁與固定頁碰撞", () => {
    expect(() =>
      compose({
        project: {
          pages: [{ key: "demo-form.view-page", Page: ProjectReport }],
          forms: [],
        },
      }),
    ).toThrow(
      /demo-form\.view-page.*base\.forms\[0\].*viewPage.*project\.pages\[0\]/s,
    );
    // 同一個表單模組登記兩次:四頁全撞
    expect(() =>
      compose({
        project: { pages: [], forms: [{ moduleKey: "demo-form" }] },
      }),
    ).toThrow(/demo-form.*base\.forms\[0\].*project\.forms\[0\]/s);
  });

  it("多個問題一次列完", () => {
    expect(() =>
      compose({
        project: {
          pages: [
            { key: "overview", Page: ProjectReport },
            { key: "system.forms", Page: ProjectReport },
          ],
          forms: [],
        },
      }),
    ).toThrow(/overview.*system\.forms/s);
  });
});

describe("composeModulePages:替換", () => {
  it("替換已存在的底座頁:同一個 key 換成專案頁,其餘不動", () => {
    const { pages } = compose({
      replacements: [{ target: "system.role-manager", Page: ProjectRoles }],
    });

    expect(pages["system.role-manager"]).toBe(ProjectRoles);
    expect(pages.overview).toBe(BaseOverview);
  });

  it("省略 minWidth 繼承底座的寬度;明寫才改", () => {
    const inherited = compose({
      replacements: [{ target: "system.forms", Page: ProjectReport }],
    });
    const widened = compose({
      replacements: [
        { target: "system.role-manager", Page: ProjectRoles, minWidth: "xl" },
        { target: "system.forms", Page: ProjectReport, minWidth: "lg" },
      ],
    });

    expect(inherited.pageMinWidths).toEqual({ "system.forms": "xl" });
    expect(widened.pageMinWidths).toEqual({
      "system.role-manager": "xl",
      "system.forms": "lg",
    });
  });

  it("替換可以明寫 md:底座宣告 xl 的頁,換成平板寬就排得下的版本時降回殼層預設那一級", () => {
    const { pageMinWidths } = compose({
      project: {
        pages: [{ key: "project.report", Page: ProjectReport, minWidth: "md" }],
        forms: [],
      },
      replacements: [
        { target: "system.forms", Page: ProjectReport, minWidth: "md" },
      ],
    });

    // 明寫的 md 照樣進表(與省略不同:省略是繼承底座的 xl)
    expect(pageMinWidths).toEqual({
      "project.report": "md",
      "system.forms": "md",
    });
  });

  it("移除替換就恢復底座原版(底座登記沒有被改掉)", () => {
    compose({
      replacements: [{ target: "system.role-manager", Page: ProjectRoles }],
    });

    const restored = compose();

    expect(restored.pages["system.role-manager"]).toBe(BaseRoles);
  });

  it("可以替換底座表單模組的某一頁,該模組的設定不變", () => {
    const CustomView = page("CustomView");
    const { pages, formModuleOptions } = compose({
      base: {
        pages: [],
        forms: [
          { moduleKey: "demo-form", options: { tabLabelTemplate: "{{form}}" } },
        ],
      },
      replacements: [{ target: "demo-form.view-page", Page: CustomView }],
    });

    expect(pages["demo-form.view-page"]).toBe(CustomView);
    expect(pages["demo-form"]).toBe(formModulePages("demo-form")["demo-form"]);
    expect(formModuleOptions.get("demo-form")?.tabLabelTemplate).toBe(
      "{{form}}",
    );
  });

  it("未知目標拒絕(專案自己的頁也不是替換目標)", () => {
    expect(() =>
      compose({
        replacements: [{ target: "system.nope", Page: ProjectRoles }],
      }),
    ).toThrow(/system\.nope.*replacements\[0\]/s);
    expect(() =>
      compose({
        project: {
          pages: [{ key: "project.report", Page: ProjectReport }],
          forms: [],
        },
        replacements: [{ target: "project.report", Page: ProjectRoles }],
      }),
    ).toThrow(/project\.report.*replacements\[0\]/s);
  });

  it("同一個目標替換兩次拒絕", () => {
    expect(() =>
      compose({
        replacements: [
          { target: "system.role-manager", Page: ProjectRoles },
          { target: "system.role-manager", Page: ProjectReport },
        ],
      }),
    ).toThrow(/system\.role-manager.*replacements\[0\].*replacements\[1\]/s);
  });
});

describe("composeModulePages:輸入不變、輸出只認 own key", () => {
  it("不修改輸入(凍結的輸入照樣合成)", () => {
    const frozenBase: ModulePageSource = Object.freeze({
      pages: Object.freeze([
        Object.freeze({ key: "overview", Page: BaseOverview }),
      ]),
      forms: Object.freeze([Object.freeze({ moduleKey: "demo-form" })]),
    });
    const replacements = Object.freeze([
      Object.freeze({ target: "overview", Page: ProjectReport }),
    ]);

    const { pages } = composeModulePages({
      base: frozenBase,
      project: EMPTY,
      replacements,
    });

    expect(pages.overview).toBe(ProjectReport);
    expect(frozenBase.pages).toEqual([{ key: "overview", Page: BaseOverview }]);
    expect(replacements).toEqual([{ target: "overview", Page: ProjectReport }]);
  });

  it("輸出唯讀,合成之後改不動", () => {
    const { pages, pageMinWidths } = compose();

    expect(Object.isFrozen(pages)).toBe(true);
    expect(Object.isFrozen(pageMinWidths)).toBe(true);
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "沒登記的模組 key「%s」查不到物件原型上的同名成員",
    (key) => {
      const { pages, pageMinWidths } = compose();

      expect(pages[key]).toBeUndefined();
      expect(pageMinWidths[key]).toBeUndefined();
    },
  );

  it.each(["constructor", "toString", "__proto__"])(
    "模組 key 剛好叫「%s」也能登記與替換",
    (key) => {
      const source: ModulePageSource = {
        pages: [{ key, Page: BaseOverview, minWidth: "xl" }],
        forms: [],
      };

      const registered = composeModulePages({
        base: source,
        project: EMPTY,
        replacements: [],
      });
      const replaced = composeModulePages({
        base: source,
        project: EMPTY,
        replacements: [{ target: key, Page: ProjectReport }],
      });

      expect(registered.pages[key]).toBe(BaseOverview);
      expect(replaced.pages[key]).toBe(ProjectReport);
      expect(replaced.pageMinWidths[key]).toBe("xl");
    },
  );

  it("原型上的名字不算「已存在的底座頁」,不能當替換目標", () => {
    expect(() =>
      compose({
        replacements: [{ target: "constructor", Page: ProjectRoles }],
      }),
    ).toThrow(/constructor/);
  });
});
