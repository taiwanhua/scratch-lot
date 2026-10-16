import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import { sectionsStorageKey } from "@/lib/base/section-collapse";
import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  shoppingDefinition,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import type { FormRuntimeWorldOptions } from "@/test/msw/form-runtime-handlers";

import {
  defaultRuntimeOptions,
  renderShopping,
  shoppingForm,
} from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;
const VIEW_PATH = `${DEMO_FORM_ROUTES.viewPage}/sub-1`;
const PAGE_ID = `form:${SHOPPING_FORM_KEY}`;
const STORAGE_KEY = sectionsStorageKey("user-1");

/**
 * 購物單拆成兩個可收合的分區:「採購內容」預設展開、收合時標題列顯示品項;
 * 「採購資訊」(採購人、內部備註)預設收合。
 */
const collapsibleDefinition = (): FormDefinition => {
  const definition = shoppingDefinition();
  const basic = definition.layout.sections.at(0);
  if (basic === undefined) {
    throw new Error("fixture 沒有分區");
  }
  const buyerRow = basic.rows.pop();
  definition.layout.sections = [
    {
      ...basic,
      collapsible: true,
      summaryFieldKeys: ["item", "qty"],
    },
    {
      key: "extra",
      title: "採購資訊",
      rows: buyerRow === undefined ? [] : [buyerRow],
      collapsible: true,
      defaultCollapsed: true,
    },
  ];
  return definition;
};

const worldOf = (
  extra: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  ...defaultRuntimeOptions(),
  versions: { [`${SHOPPING_FORM_KEY}@1`]: collapsibleDefinition() },
  ...extra,
});

const stored = (): unknown =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

const header = (name: string) => screen.findByRole("button", { name });

const scrollIntoView = jest.fn();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("表單分區收合(底座 10.3)", () => {
  it("第一次進頁:依分區設定的預設", async () => {
    renderShopping({ path: CREATE_PATH, world: worldOf() });

    expect(await header("採購內容")).toHaveAttribute("aria-expanded", "true");
    expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "false");
  });

  it("舊定義(沒有收合設定)照舊畫:有框卡片 + 標題,沒有收合按鈕", async () => {
    renderShopping({ path: CREATE_PATH });

    expect(
      await screen.findByRole("heading", { name: "採購內容" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "採購內容" }),
    ).not.toBeInTheDocument();
  });

  it("收合時標題列顯示設定的欄位值(看得到、有值的);手動切換寫入 `form:<formKey>`", async () => {
    const { user } = renderShopping({ path: CREATE_PATH, world: worldOf() });

    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "牛奶",
    );
    await user.click(await header("採購內容"));

    // 數量沒填 → 不進摘要
    expect(await header("採購內容 品項:牛奶")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(stored()).toEqual({ [PAGE_ID]: { basic: true } });
  });

  it("同一張表單的新增 / 檢視共用 `form:<formKey>`;發布新版本後照舊", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ [PAGE_ID]: { extra: false } }),
    );
    const create = renderShopping({ path: CREATE_PATH, world: worldOf() });
    await waitFor(async () => {
      expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "true");
    });
    create.unmount();

    // 檢視一筆綁第 2 版的單(新版本,分區 key 沿用)
    renderShopping({
      path: VIEW_PATH,
      world: {
        ...defaultRuntimeOptions(),
        moduleForms: [{ ...shoppingForm, currentVersion: 2 }],
        versions: {
          [`${SHOPPING_FORM_KEY}@1`]: collapsibleDefinition(),
          [`${SHOPPING_FORM_KEY}@2`]: collapsibleDefinition(),
        },
        submissions: [submissionFragment({ version: 2, viewedVersion: 2 })],
      },
    });
    await waitFor(async () => {
      expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("送出時區塊內有錯:有錯的分區全部展開、捲到第一個錯誤;不寫入儲存,重新整理回到原狀態", async () => {
    const world = worldOf({
      failures: {
        SubmitFormSubmission: {
          code: "VALIDATION_FAILED",
          extensions: {
            fieldErrors: [
              { fieldKey: "buyer", code: "REQUIRED", message: "請填採購人" },
            ],
          },
        },
      },
    });
    const first = renderShopping({ path: CREATE_PATH, world });

    expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "false");
    await first.user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "牛奶",
    );
    await first.user.click(screen.getByRole("button", { name: "送出" }));

    expect(await screen.findByText("請填採購人")).toBeInTheDocument();
    expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    const target = scrollIntoView.mock.contexts.at(-1) as HTMLElement;
    expect(target.dataset.fieldKey).toBe("buyer");
    expect(stored()).toBeNull();

    // 重新整理:回到記住的狀態(沒有紀錄 = 預設收合)
    first.unmount();
    renderShopping({ path: CREATE_PATH, world: worldOf() });
    expect(await header("採購資訊")).toHaveAttribute("aria-expanded", "false");
  });

  it("頁面已沒有某個區塊 key:打開該頁時從儲存刪掉", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [PAGE_ID]: { removed: true, extra: false },
        "dealers.detail": { contact: true },
      }),
    );
    renderShopping({ path: CREATE_PATH, world: worldOf() });

    await waitFor(() => {
      expect(stored()).toEqual({
        [PAGE_ID]: { extra: false },
        "dealers.detail": { contact: true },
      });
    });
  });
});
