import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import {
  resizeViewport,
  restoreResizableViewportAfterEach,
  setResizableViewport,
} from "@/test/viewport-resize";

import {
  canvas,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
  smallDesignOptions,
} from "./forms-page-test-support";

preloadFormsPage();

const options = () => ({
  ...smallDesignOptions(),
  forms: [
    formFragment(),
    formFragment({ id: "form-trip", key: "trip", name: "出差單" }),
  ],
});

const formList = () => screen.queryByRole("list", { name: "表單清單" });
const properties = () => screen.queryByRole("region", { name: "屬性" });
const expandButton = () =>
  screen.queryByRole("button", { name: "展開表單清單" });

describe("表單管理:平板寬(sm–lg)畫布優先", () => {
  restoreResizableViewportAfterEach();

  it("768:清單一進來收起 → [展開] 打開、焦點在 [收起] → 選一張再收起;[收起] 後焦點回 [展開]", async () => {
    setResizableViewport(768);
    const { user } = renderFormsPage(options());
    await findDesigner();
    expect(formList()).toBeNull();
    const expand = screen.getByRole("button", { name: "展開表單清單" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    const list = await screen.findByRole("list", { name: "表單清單" });
    const collapse = screen.getByRole("button", { name: "收起表單清單" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveFocus();
    expect(expandButton()).toBeNull();

    await user.click(within(list).getByText("出差單"));
    await waitFor(() => {
      expect(formList()).toBeNull();
    });
    expect(
      await screen.findByRole("heading", { name: "出差單" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展開表單清單" }));
    await user.click(screen.getByRole("button", { name: "收起表單清單" }));
    await waitFor(() => {
      expect(expandButton()).toHaveFocus();
    });
    expect(formList()).toBeNull();
  });

  it("1024:屬性面板平常收著;新增欄位打開抽屜、畫布照樣看得到選中的欄位;改屬性畫布跟著變;Esc 關閉", async () => {
    setResizableViewport(1024);
    const { user } = renderFormsPage(options());
    const palette = await findDesigner();
    expect(properties()).toBeNull();

    await user.click(
      within(palette).getByRole("button", { name: "新增單行文字欄位" }),
    );
    const panel = await screen.findByRole("region", { name: "屬性" });
    const label = within(panel).getByRole("textbox", { name: "顯示名稱" });
    expect(
      within(canvas()).getByRole("button", {
        name: "選取欄位「單行文字」(field_1)",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.clear(label);
    await user.type(label, "店家");
    expect(
      within(canvas()).getByRole("button", {
        name: "選取欄位「店家」(field_1)",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(properties()).toBeNull();
    });
    // 關掉 = 取消選取,畫布回到滿寬;改動留著
    expect(
      within(canvas()).getByRole("button", {
        name: "選取欄位「店家」(field_1)",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/有未儲存的變更/)).toBeInTheDocument();
  });

  it("平板寬:[表單設定] 在抽屜裡打開表單層設定,關閉鈕收回", async () => {
    setResizableViewport(768);
    const { user } = renderFormsPage(options());
    await findDesigner();

    await user.click(screen.getByRole("button", { name: "表單設定" }));
    const panel = await screen.findByRole("region", { name: "屬性" });
    expect(within(panel).getByText("表單設定")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "關閉屬性" }));
    await waitFor(() => {
      expect(properties()).toBeNull();
    });
  });

  it("≥ lg(1440)不變:清單常駐、沒有收起 / 展開鈕、屬性面板常駐顯示表單設定、沒有 [表單設定] 鈕", async () => {
    setResizableViewport(1440);
    renderFormsPage(options());
    await findDesigner();
    expect(formList()).not.toBeNull();
    expect(expandButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "收起表單清單" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "屬性" })).getByText(
        "表單設定",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "表單設定" })).toBeNull();
    expect(screen.queryByRole("button", { name: "關閉屬性" })).toBeNull();
  });

  it("有未存變更時縮到手機寬再拉回來:草稿與「有未儲存的變更」都在;手機寬的摘要提示有未存變更", async () => {
    setResizableViewport(1024);
    const { user } = renderFormsPage(options());
    const palette = await findDesigner();
    await user.click(
      within(palette).getByRole("button", { name: "新增數字欄位" }),
    );
    expect(await screen.findByText(/有未儲存的變更/)).toBeInTheDocument();

    resizeViewport(390);
    // 手機寬:設計器藏起來(不卸載),清單滿版;點進摘要看得到提示
    expect(screen.queryByRole("region", { name: "元件" })).toBeNull();
    const list = await screen.findByRole("list", { name: "表單清單" });
    await user.click(within(list).getByText("購物單"));
    const summary = await screen.findByRole("region", { name: "表單摘要" });
    expect(summary).toBeInTheDocument();
    expect(
      screen.getByText(
        "這張表單有未儲存的變更,仍保留在設計器裡。請改用平板或電腦寬度儲存或放棄。",
      ),
    ).toBeInTheDocument();

    resizeViewport(1024);
    await findDesigner();
    expect(screen.getByText(/草稿修訂 1 · 有未儲存的變更/)).toBeInTheDocument();
    expect(
      within(canvas()).getByRole("button", {
        name: "選取欄位「數字」(field_1)",
      }),
    ).toBeInTheDocument();
  });
});
