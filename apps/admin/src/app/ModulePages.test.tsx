import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";
import { useState } from "react";

import { ModuleListColumnKind } from "@repo/graphql";

import { formModulePages } from "@/components/base/form-engine/FormModulePages/form-module-pages";
import {
  SHOPPING_ALL,
  defaultRuntimeOptions,
} from "@/components/base/form-engine/FormModulePages/form-module-test-support";
import { FormSubmissionList } from "@/components/base/form-engine/FormSubmissionList";
import { DEFAULT_FORM_MODULE_OPTIONS } from "@/lib/base/form-engine/form-module-options";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { authWorld } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_KEY,
  DEMO_FORM_ROUTES,
  demoFormModules,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { setupFakeViewport } from "@/test/viewport";

import { baseModulePages } from "./base/module-pages";
import { ModuleRoute } from "./guards/ModuleRoute/ModuleRoute";
import { RequireAuth } from "./guards/RequireAuth";
import { composeModulePages } from "./module-page-registry";
import {
  formModuleOptions,
  modulePageMinWidths,
  modulePages,
} from "./module-pages";

setupFakeViewport();

/**
 * 客製頁組裝一例(Spec 6a §8「登記與客製」):列表頁自己排版、表單相關的部分用零件綁進去
 * (這裡:自訂欄位的 `FormSubmissionList`),其餘三頁沿用預設。
 */
const CustomShoppingPage = ({ module }: ModulePageProps) => {
  const [page, setPage] = useState(1);
  return (
    <section aria-label="自訂購物頁">
      <h2>{module.name}(自訂)</h2>
      <FormSubmissionList
        moduleKey={DEMO_FORM_KEY}
        filters={{ keyword: "", formKey: null, status: null, page }}
        onPageChange={setPage}
        columns={[
          {
            kind: ModuleListColumnKind.Field,
            key: "unit_price",
            width: 120,
            order: 0,
          },
        ]}
        aria-label="自訂清單"
      />
    </section>
  );
};

/** 專案自有的表單模組:列表頁客製(`pageOverrides`),其餘三頁沿用預設。 */
const customPages = composeModulePages({
  base: { pages: [], forms: [] },
  project: {
    pages: [],
    forms: [
      {
        moduleKey: DEMO_FORM_KEY,
        pageOverrides: { list: { Page: CustomShoppingPage } },
      },
    ],
  },
  replacements: [],
}).pages;

/** 底座來源配上空的專案來源:底座原版的相容性在這裡鎖,不看正式的專案登記。 */
const baseOnly = composeModulePages({
  base: baseModulePages,
  project: { pages: [], forms: [] },
  replacements: [],
});

describe("底座來源 + 空專案(原版相容性)", () => {
  it("底座登記沒有碰撞;底座頁一頁不少", () => {
    expect(
      Object.keys(baseOnly.pages).toSorted((a, b) =>
        a.localeCompare(b, "zh-Hant"),
      ),
    ).toEqual(
      [
        "apply-center",
        "apply-center.view-page",
        "demo-form",
        "demo-form.create-page",
        "demo-form.edit-page",
        "demo-form.view-page",
        "demo.form",
        "demo.form.create-page",
        "demo.form.edit-page",
        "demo.form.view-page",
        "demo.sample-two",
        "demo.sample-two.create-page",
        "demo.sample-two.edit-page",
        "demo.sample-two.view-page",
        "demo.sub.form",
        "demo.sub.form.create-page",
        "demo.sub.form.edit-page",
        "demo.sub.form.view-page",
        "demo.sub.sample-one",
        "demo.sub.sample-one.create-page",
        "demo.sub.sample-one.edit-page",
        "demo.sub.sample-one.view-page",
        "overview",
        "system.data-scope",
        "system.field-manager",
        "system.forms",
        "system.module-manager",
        "system.notification-settings",
        "system.org-manager",
        "system.printers",
        "system.role-manager",
        "system.user-manager",
        "system.workflows",
        "system.workflows.blocked-page",
      ].toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    );
  });

  it("寬度:底座頁都沒宣告,一律用殼層預設(兩個設計器在 xl 以下自己換版,T48)", () => {
    expect(baseOnly.pageMinWidths).toEqual({});
  });

  it("三個示範表單模組的設定取自同一份 forms 登記,模板用預設", () => {
    expect([...baseOnly.formModuleOptions.keys()]).toEqual([
      "demo-form",
      "demo.form",
      "demo.sub.form",
    ]);
    for (const options of baseOnly.formModuleOptions.values()) {
      expect(options).toEqual(DEFAULT_FORM_MODULE_OPTIONS);
    }
  });

  it("沒有替換時每一頁都是底座登記的那個元件", () => {
    for (const { key, Page } of baseModulePages.pages) {
      expect(baseOnly.pages[key]).toBe(Page);
    }
  });
});

/**
 * 正式的組裝入口(底座 + 專案目前登記的內容)。專案可以合法地新增頁、新增表單模組、替換底座頁,
 * 所以這裡只驗不論專案登記什麼都成立的合約,不鎖頁數、寬度或「專案是空的」。
 */
describe("正式登記表(app/module-pages.tsx 的真組裝)", () => {
  it("載入即通過碰撞驗證;底座登記的每個 key 都還在(被替換也仍是同一個 key)", () => {
    for (const key of Object.keys(baseOnly.pages)) {
      expect(modulePages[key]).toBeDefined();
    }
  });

  it("宣告寬度的 key 都是登記過的頁", () => {
    for (const key of Object.keys(modulePageMinWidths)) {
      expect(modulePages[key]).toBeDefined();
    }
  });

  it("每個登記的表單模組四頁都在表裡,設定的模板欄位已補齊(一定是字串)", () => {
    for (const [moduleKey, options] of formModuleOptions) {
      for (const key of Object.keys(formModulePages(moduleKey))) {
        expect(modulePages[key]).toBeDefined();
      }
      // 只驗「補齊了」:空字串是合法的登記值(套出來是空的時頁籤退回表單名)
      expect(typeof options.tabLabelTemplate).toBe("string");
    }
  });

  it("底座表單模組的設定不受專案登記影響", () => {
    for (const [moduleKey, options] of baseOnly.formModuleOptions) {
      expect(formModuleOptions.get(moduleKey)).toEqual(options);
    }
  });
});

describe("formModulePages:預設組裝與客製", () => {
  it("產出四個 key 的預設元件;pageOverrides 只換那一頁", () => {
    const defaults = formModulePages(DEMO_FORM_KEY);
    expect(new Set(Object.keys(defaults))).toEqual(
      new Set([
        DEMO_FORM_KEY,
        `${DEMO_FORM_KEY}.view-page`,
        `${DEMO_FORM_KEY}.create-page`,
        `${DEMO_FORM_KEY}.edit-page`,
      ]),
    );
    expect(customPages[DEMO_FORM_KEY]).toBe(CustomShoppingPage);
    // 其餘三頁沿用預設(同一個模組層常數,不是每次呼叫各建一份)
    for (const suffix of ["view-page", "create-page", "edit-page"]) {
      const key = `${DEMO_FORM_KEY}.${suffix}`;
      expect(customPages[key]).toBe(defaults[key]);
      expect(customPages[key]).not.toBe(CustomShoppingPage);
    }
  });

  it("只回傳四頁,不登記任何東西:呼叫幾次都拿到同一組 lazy 元件", () => {
    const first = formModulePages(DEMO_FORM_KEY);
    const second = formModulePages(DEMO_FORM_KEY);
    const other = formModulePages("another-form");

    expect(second).toEqual(first);
    expect(other["another-form"]).toBe(first[DEMO_FORM_KEY]);
    expect(other["another-form.edit-page"]).toBe(
      first[`${DEMO_FORM_KEY}.edit-page`],
    );
  });

  it("客製列表頁用零件組裝:自訂欄位的 FormSubmissionList 照樣吃提交與版本定義", async () => {
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: demoFormModules(SHOPPING_ALL),
      }).handlers,
      ...formRuntimeWorld({
        ...defaultRuntimeOptions(),
        submissions: [submissionFragment()],
      }).handlers,
    );
    renderApp({
      path: DEMO_FORM_ROUTES.list,
      extra: (
        <RequireAuth>
          <ModuleRoute pages={customPages} />
        </RequireAuth>
      ),
    });

    const custom = await screen.findByRole("region", { name: "自訂購物頁" });
    expect(
      within(custom).getByText("示範表單(頂層)(自訂)"),
    ).toBeInTheDocument();
    const table = await within(custom).findByRole("table", {
      name: "自訂清單",
    });
    expect(await within(table).findByText("30 元")).toBeInTheDocument();
  });
});
