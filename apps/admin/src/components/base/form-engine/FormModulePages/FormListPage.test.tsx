import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleListColumnKind } from "@repo/graphql";

import { readStoredEntries, routeTabsStorageKey } from "@/lib/base/route-tabs";
import { testUser } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_KEY,
  DEMO_FORM_ROUTES,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
  shoppingForm,
} from "./form-module-test-support";

setupFakeViewport();

/** 新增鈕在「此刻可新增的表單」回來之前不出現;等它出現且可按再點。 */
const createButton = async () => {
  // 停用時 Tooltip 會包一層 span,啟用後節點換掉:每次都重新查
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "+ 新增" })).toBeEnabled();
  });
  return screen.getByRole("button", { name: "+ 新增" });
};

/**
 * 列表要接力載完才出現(登入 → 模組 → 表單清單 → 列表欄位配置 → 提交清單);整包並行跑時
 * 5 秒的預設等待偶爾不夠(曾在本機全量跑紅一次、單檔跑過),這一段放寬到 10 秒。
 */
const table = () =>
  screen.findByRole(
    "table",
    { name: "示範表單(頂層)清單" },
    { timeout: 10_000 },
  );

describe("表單模組列表頁(預設組裝)", () => {
  it("列表依列表欄位配置顯示;配置引用那一筆版本沒有的欄位顯示「—」", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [submissionFragment()],
        listColumns: {
          [DEMO_FORM_KEY]: [
            {
              kind: ModuleListColumnKind.Slot,
              key: "title",
              formKey: null,
              width: 200,
              order: 0,
            },
            {
              kind: ModuleListColumnKind.Field,
              key: "qty",
              formKey: null,
              width: 120,
              order: 1,
            },
            {
              kind: ModuleListColumnKind.Field,
              key: "discount",
              formKey: null,
              width: 120,
              order: 2,
            },
          ],
        },
      },
    });

    const grid = await table();
    expect(await within(grid).findByText("雞蛋")).toBeInTheDocument();
    // 數量是版本裡有的欄位:顯示值;折扣是配置引用、那一版沒有的欄位:顯示「—」
    expect(
      await within(grid).findByRole("columnheader", { name: /數量/ }),
    ).toBeInTheDocument();
    const row = within(grid).getByText("雞蛋").closest("tr");
    expect(row).not.toBeNull();
    await waitFor(() => {
      expect(within(row as HTMLElement).getByText("2")).toBeInTheDocument();
    });
    expect(within(row as HTMLElement).getAllByText("—").length).toBeGreaterThan(
      0,
    );
  });

  it("沒有資料列時表頭仍是欄位名(讀表單目前版本);內建欄關掉的不顯示", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [],
        listColumns: {
          [DEMO_FORM_KEY]: [
            {
              kind: ModuleListColumnKind.Field,
              key: "qty",
              formKey: null,
              width: 120,
              order: 0,
            },
          ],
        },
        listBuiltin: {
          [DEMO_FORM_KEY]: { form: false, status: true, createdBy: false },
        },
      },
    });

    const grid = await table();
    expect(
      await within(grid).findByRole("columnheader", { name: /^數量/ }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("columnheader", { name: /^狀態/ }),
    ).toBeInTheDocument();
    expect(
      within(grid).queryByRole("columnheader", { name: /^表單/ }),
    ).toBeNull();
    expect(
      within(grid).queryByRole("columnheader", { name: /^建立者/ }),
    ).toBeNull();
  });

  it("此刻可新增的表單只有一張:按新增直接進那張表單", async () => {
    const { user } = renderShopping({ path: DEMO_FORM_ROUTES.list });

    await user.click(await createButton());

    expect(
      await screen.findByRole("heading", { name: "新增 — 購物單" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      `${DEMO_FORM_ROUTES.createPage}/shopping_list`,
    );
  });

  it("多張表單:先選(FormPicker),選了才進新增頁", async () => {
    const { user } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        moduleForms: [
          shoppingForm,
          {
            ...shoppingForm,
            key: "shopping_list_good_food",
            name: "購物單(門市版)",
          },
        ],
      },
    });

    await user.click(await createButton());
    const picker = await screen.findByRole("dialog", {
      name: "選擇要填寫的表單",
    });
    expect(within(picker).getByText("購物單(門市版)")).toBeInTheDocument();

    await user.click(within(picker).getByText("購物單"));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${DEMO_FORM_ROUTES.createPage}/shopping_list`,
      );
    });
  });

  it("沒有可新增的表單(停用、收回或退役):新增鈕停用", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: { ...defaultRuntimeOptions(), moduleForms: [] },
    });

    expect(
      await screen.findByRole("button", { name: "+ 新增" }),
    ).toBeDisabled();
  });

  it("從列表刪除:當前頁籤(列表)不變,那一筆在背景的詳情 / 編輯子頁籤收掉、別筆不動", async () => {
    const storageKey = routeTabsStorageKey(testUser.id);
    const other = `${DEMO_FORM_ROUTES.viewPage}/sub-2`;
    sessionStorage.clear();
    sessionStorage.setItem(
      storageKey,
      JSON.stringify([
        { route: DEMO_FORM_ROUTES.list },
        { route: `${DEMO_FORM_ROUTES.viewPage}/sub-1` },
        { route: `${DEMO_FORM_ROUTES.editPage}/sub-1` },
        { route: other },
      ]),
    );
    const { user } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [submissionFragment()],
      },
    });
    const list = await table();

    await user.click(
      await within(list).findByRole("button", { name: "刪除「雞蛋」" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "確認刪除" }));

    await waitFor(() => {
      expect(readStoredEntries(storageKey).map((entry) => entry.route)).toEqual(
        [DEMO_FORM_ROUTES.list, other],
      );
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      DEMO_FORM_ROUTES.list,
    );
  });
});
