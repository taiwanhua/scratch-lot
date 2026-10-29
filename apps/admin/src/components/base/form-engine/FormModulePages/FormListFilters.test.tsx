import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { FormSubmissionStatus, ModuleListColumnKind } from "@repo/graphql";

import {
  DEMO_FORM_KEY,
  DEMO_FORM_ROUTES,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import type { FormRuntimeWorldOptions } from "@/test/msw/form-runtime-handlers";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { currentSearch, urlJson } from "@/test/url-reload";
import {
  restoreViewportAfterEach,
  setMobileViewport,
  setupFakeViewport,
} from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

setupFakeViewport();
restoreViewportAfterEach();

/**
 * 兩筆:總部的「雞蛋」(摘要日期 9/20)、中山店的「牛奶」(9/25)。
 * 組織樹:總部 > 中山店;列表只配一欄標題(摘要槽),看列就知道條件有沒有套上。
 */
const world = (): FormRuntimeWorldOptions => ({
  ...defaultRuntimeOptions(),
  submissions: [
    submissionFragment({ orgId: "org-1" }),
    submissionFragment({
      id: "sub-2",
      orgId: "org-2",
      summary: {
        title: "牛奶",
        date: "2026-09-25T04:00:00.000Z",
        amount: null,
      },
    }),
  ],
  listColumns: {
    [DEMO_FORM_KEY]: [
      {
        kind: ModuleListColumnKind.Slot,
        key: "title",
        formKey: null,
        width: 200,
        order: 0,
      },
    ],
  },
  tenantOrgTree: toTenantTree([
    {
      id: "org-1",
      name: "總部",
      children: [{ id: "org-2", name: "中山店", parentId: "org-1" }],
    },
  ]),
});

const table = () =>
  screen.findByRole(
    "table",
    { name: "示範表單(頂層)清單" },
    { timeout: 10_000 },
  );

/** 列表上的標題(依畫面順序)。 */
const shownTitles = (grid: HTMLElement) =>
  ["雞蛋", "牛奶"].filter((title) => within(grid).queryByText(title) !== null);

/** 在日期欄(`group`)逐段打 `YYYY-MM-DD`。 */
const typeDate = async (
  user: ReturnType<typeof renderShopping>["user"],
  label: string,
  date: string,
  container: HTMLElement = document.body,
) => {
  const group = within(container).getByRole("group", { name: label });
  await user.click(within(group).getByRole("spinbutton", { name: "Year" }));
  await user.keyboard(date.replaceAll("-", ""));
};

describe("表單模組列表頁:組織與日期區間篩選", () => {
  it("組織:選了中山店 → 查詢帶 orgId、寫進 `?list=`,清單只剩那一筆", async () => {
    const { user, world: runtime } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: world(),
    });
    const grid = await table();
    await within(grid).findByText("牛奶");
    expect(shownTitles(grid)).toEqual(["雞蛋", "牛奶"]);

    await user.click(screen.getByRole("combobox", { name: "組織" }));
    await user.click(await screen.findByText("中山店"));

    await waitFor(() => {
      expect(runtime.inputs.formSubmissions.at(-1)).toMatchObject({
        orgId: "org-2",
        page: 1,
      });
    });
    await waitFor(() => {
      expect(shownTitles(grid)).toEqual(["牛奶"]);
    });
    expect(urlJson("list")).toMatchObject({ orgId: "org-2" });
  });

  it("日期起迄:打完才套用、寫進 `?list=`;重新整理後條件還在", async () => {
    const first = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: world(),
    });
    const grid = await table();
    await within(grid).findByText("牛奶");

    await typeDate(first.user, "日期起", "2026-09-21");
    await waitFor(() => {
      expect(shownTitles(grid)).toEqual(["牛奶"]);
    });
    expect(first.world.inputs.formSubmissions.at(-1)).toMatchObject({
      dateFrom: "2026-09-21",
    });
    expect(first.world.inputs.formSubmissions.at(-1)).not.toHaveProperty(
      "dateTo",
    );

    await typeDate(first.user, "日期迄", "2026-09-24");
    await waitFor(() => {
      expect(shownTitles(grid)).toEqual([]);
    });
    expect(urlJson("list")).toMatchObject({
      dateFrom: "2026-09-21",
      dateTo: "2026-09-24",
      page: 1,
    });
    first.unmount();

    const second = renderShopping({
      path: `${DEMO_FORM_ROUTES.list}${currentSearch()}`,
      world: world(),
    });
    await waitFor(() => {
      expect(second.world.inputs.formSubmissions.at(-1)).toMatchObject({
        dateFrom: "2026-09-21",
        dateTo: "2026-09-24",
      });
    });
    expect(screen.getByRole("group", { name: "日期起" })).toHaveTextContent(
      "2026-09-21",
    );
  });

  it("網址裡的日期不是 YYYY-MM-DD → 整包回預設(不帶日期條件)", async () => {
    const list = encodeURIComponent('{"dateFrom":"9/21"}');
    const { world: runtime } = renderShopping({
      path: `${DEMO_FORM_ROUTES.list}?list=${list}`,
      world: world(),
    });
    await table();
    await waitFor(() => {
      expect(runtime.inputs.formSubmissions.length).toBeGreaterThan(0);
    });
    expect(runtime.inputs.formSubmissions.at(-1)).not.toHaveProperty(
      "dateFrom",
    );
  });

  it("手機:篩選收進抽屜,改的是草稿;[套用] 才查詢,按鈕顯示已套用數", async () => {
    setMobileViewport();
    const { user, world: runtime } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: world(),
    });
    // 搜尋框留在外面;篩選欄位不在畫面上
    expect(
      await screen.findByRole("textbox", { name: "搜尋" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "狀態" })).toBeNull();

    await user.click(await screen.findByRole("button", { name: "篩選" }));
    const drawer = await screen.findByRole("presentation");
    await user.click(within(drawer).getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "草稿" }));
    await typeDate(user, "日期起", "2026-09-21", drawer);
    // 還沒套用:查詢不帶這兩個條件
    expect(runtime.inputs.formSubmissions.at(-1)).not.toHaveProperty("status");

    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(runtime.inputs.formSubmissions.at(-1)).toMatchObject({
        status: FormSubmissionStatus.Draft,
        dateFrom: "2026-09-21",
      });
    });
    expect(
      await screen.findByRole("button", { name: "篩選 (2)" }),
    ).toBeInTheDocument();
  });
});
