import { beforeAll } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";
import { FormVersionStatus } from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  type FormDesignWorld,
  type FormDesignWorldOptions,
  formDesignWorld,
} from "@/test/msw/form-design-handlers";
import {
  FORMS_ROUTE,
  SHOPPING_FORM_KEY,
  field,
  formFragment,
  formsModules,
  shoppingDefinition,
  versionFragment,
} from "@/test/msw/form-fixtures";
import type { FormRuntimeWorldOptions } from "@/test/msw/form-runtime-handlers";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 表單管理頁是 `React.lazy` 載入的(`lazy-forms-page.ts`,Suspense 在 `ModuleRoute`):第一次 `import()`
 * 要在 jest ESM 裡現載設計器整條依賴鏈(dnd-kit、表達式選擇器、檢查器),全套並行時 CPU 被搶,
 * 會把 `findDesigner` 的 5 秒吃光(#470)。每個表單管理頁測試檔在頂層呼叫一次,先載進模組快取(TEST-08)。
 */
export const preloadFormsPage = (): void => {
  beforeAll(async () => {
    await import("./FormsPage");
  });
};

/**
 * 表單管理頁測試的共用場景:root(持 `system.forms.*`)、一張共用表單「購物單」,
 * 已發布 v1 + 一份以 v1 為基底的草稿(修訂 1)。
 */
export const FORMS_ALL = ["system.forms.*"];

export const defaultDesignOptions = (): FormDesignWorldOptions => ({
  forms: [formFragment()],
  versions: {
    [SHOPPING_FORM_KEY]: [
      versionFragment(shoppingDefinition(), { baseVersion: 1 }),
      versionFragment(shoppingDefinition(), {
        id: `ver-${SHOPPING_FORM_KEY}-1`,
        version: 1,
        status: FormVersionStatus.Published,
        changelog: "第一版",
        publishedAt: "2026-09-20T08:00:00.000Z",
      }),
    ],
  },
});

/**
 * 只有一個「品項」欄的小草稿:只操作元件面板 / 屬性面板的測試用它,畫布越小每一步重繪越快
 * (全套並行時 CPU 被搶,整張購物單的畫布會把單一測試的 15 秒吃光;TEST-08)。
 */
export const smallDraft = (): FormDefinition => ({
  fields: [field("item", "品項", "text")],
  layout: {
    sections: [
      {
        key: "basic",
        title: "採購內容",
        rows: [{ cols: [{ fieldKey: "item", span: 12 }] }],
      },
    ],
  },
  summaryMap: { title: "item" },
  prefills: [],
});

/** 草稿換成小草稿(已發布 v1 照舊是整張購物單)。 */
export const smallDesignOptions = (): FormDesignWorldOptions => {
  const options = defaultDesignOptions();
  return {
    ...options,
    versions: {
      [SHOPPING_FORM_KEY]: [
        versionFragment(smallDraft(), { baseVersion: 1 }),
        ...(options.versions?.[SHOPPING_FORM_KEY] ?? []).slice(1),
      ],
    },
  };
};

export const renderFormsPage = (
  options: FormDesignWorldOptions = defaultDesignOptions(),
  permissions: readonly string[] = FORMS_ALL,
  /** 執行端的假 api(預覽與設計器裡的選項選擇器會打,例:類別選項 `fieldOptions`) */
  runtime: FormRuntimeWorldOptions = {},
  /** 起始網址的查詢字串(含 `?`;重新整理、帶參數打開用) */
  search = "",
): ReturnType<typeof renderApp> & { world: FormDesignWorld } => {
  const world = formDesignWorld(options);
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: formsModules(permissions),
    }).handlers,
    ...world.handlers,
    // 預覽模式的帶入 / 選項會打執行端的查詢
    ...formRuntimeWorld(runtime).handlers,
  );
  return { ...renderApp({ path: `${FORMS_ROUTE}${search}` }), world };
};

/** 等設計器載完草稿(元件面板出現)。 */
export const findDesigner = () => screen.findByRole("region", { name: "元件" });

type TestUser = ReturnType<typeof renderFormsPage>["user"];

/** 設計器畫布。 */
export const canvas = () => screen.getByRole("region", { name: "畫布" });

/** 點畫布上的欄位選它(屬性面板換成它)。 */
export const selectField = async (
  user: TestUser,
  label: string,
  key: string,
): Promise<void> => {
  await user.click(
    within(canvas()).getByRole("button", {
      name: `選取欄位「${label}」(${key})`,
    }),
  );
};

/** 從元件面板加一個欄位(`typeLabel` = 面板上的型別名,如「單選」);加完會選中它。 */
export const addField = async (
  user: TestUser,
  typeLabel: string,
): Promise<void> => {
  const palette = await findDesigner();
  await user.click(
    within(palette).getByRole("button", { name: `新增${typeLabel}欄位` }),
  );
  await screen.findByRole("textbox", { name: "顯示名稱" });
};

/** 打開 SelectField(以無障礙名稱找 combobox),回傳展開的選項文字。 */
export const openSelect = async (
  user: TestUser,
  name: string,
  scope: HTMLElement = document.body,
): Promise<string[]> => {
  await user.click(within(scope).getByRole("combobox", { name }));
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent);
};

/** 在 SelectField 選一項。 */
export const pickOption = async (
  user: TestUser,
  name: string,
  option: string,
  scope: HTMLElement = document.body,
): Promise<void> => {
  await openSelect(user, name, scope);
  await user.click(screen.getByRole("option", { name: option }));
};
