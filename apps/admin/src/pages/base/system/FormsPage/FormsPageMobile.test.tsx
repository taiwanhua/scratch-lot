import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import { currentSearch, urlParam } from "@/test/url-reload";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import {
  FORMS_ALL,
  defaultDesignOptions,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const options = () => ({
  ...defaultDesignOptions(),
  forms: [
    formFragment(),
    formFragment({ id: "form-trip", key: "trip", name: "出差單" }),
  ],
});

const formList = () => screen.queryByRole("list", { name: "表單清單" });
const findSummary = async () =>
  screen.findByRole("region", { name: "表單摘要" });

describe("表單管理:手機寬只顯示清單或唯讀摘要", () => {
  restoreViewportAfterEach();

  it("清單滿版 → 點表單只顯示摘要與提示、沒有設計器 → [← 返回] 回到清單;重新整理停在同一張", async () => {
    setMobileViewport();
    const first = renderFormsPage(options());
    const list = await screen.findByRole("list", { name: "表單清單" });
    expect(screen.queryByRole("region", { name: "表單摘要" })).toBeNull();

    await first.user.click(within(list).getByText("出差單"));
    const summary = await findSummary();
    expect(
      within(summary).getByRole("heading", { name: "出差單" }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("設計與編輯請使用平板或電腦。"),
    ).toBeInTheDocument();
    // 設計器與設定區不掛載
    expect(screen.queryByRole("region", { name: "表單設定" })).toBeNull();
    expect(screen.queryByRole("region", { name: "元件" })).toBeNull();
    expect(formList()).toBeNull();
    expect(urlParam("detail")).toBe("trip");
    const search = currentSearch();

    await first.user.click(screen.getByRole("button", { name: "← 返回" }));
    await waitFor(() => {
      expect(formList()).not.toBeNull();
    });
    expect(urlParam("detail")).toBeNull();
    first.unmount();

    renderFormsPage(options(), FORMS_ALL, {}, search);
    expect(
      within(await findSummary()).getByRole("heading", { name: "出差單" }),
    ).toBeInTheDocument();
  });

  it("手機寬清單裡預設選中的第一張(網址還沒有選取)也點得進去", async () => {
    setMobileViewport();
    const { user } = renderFormsPage(options());
    const list = await screen.findByRole("list", { name: "表單清單" });
    await user.click(within(list).getByText("購物單"));
    expect(
      within(await findSummary()).getByRole("heading", { name: "購物單" }),
    ).toBeInTheDocument();
    expect(urlParam("detail")).toBe("shopping_list");
  });

  it("sm 以上照舊:兩欄並排、右欄是表單設定與設計器", async () => {
    renderFormsPage(options());
    await screen.findByRole("list", { name: "表單清單" });
    expect(
      await screen.findByRole("region", { name: "表單設定" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "表單摘要" })).toBeNull();
  });
});

describe("表單管理:同一筆不經過未存攔截", () => {
  it("sm 以上:網址沒有選取、設計器有未存變更時再點同一張 → 不跳攔截、改動留著,只把選取寫進網址", async () => {
    const { user } = renderFormsPage(options());
    const palette = await findDesigner();
    await user.click(
      within(palette).getByRole("button", { name: "新增數字欄位" }),
    );
    expect(await screen.findByText(/有未儲存的變更/)).toBeInTheDocument();
    expect(urlParam("detail")).toBeNull();

    const list = screen.getByRole("list", { name: "表單清單" });
    await user.click(within(list).getByText("購物單"));
    await waitFor(() => {
      expect(urlParam("detail")).toBe("shopping_list");
    });
    expect(screen.queryByRole("dialog", { name: "有未存的變更" })).toBeNull();
    expect(screen.getByText(/有未儲存的變更/)).toBeInTheDocument();
  });
});
