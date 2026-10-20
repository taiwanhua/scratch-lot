import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  supportRequestFormWorld,
  supportRequestWorkflowWorld,
} from "@/test/msw/project/schedule-support-request-fixtures";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../schedule-test-support";

const SUPPORT = "/schedule/manage?tab=support-requests";

const renderSupport = (
  options: Partial<Parameters<typeof renderSchedulePage>[0]> = {},
) =>
  renderSchedulePage({
    path: SUPPORT,
    forms: supportRequestFormWorld(),
    workflow: supportRequestWorkflowWorld(),
    ...options,
  });

/**
 * 排班作業 → 支援需求單(SC-31 / SC-14;規格 14.10):列表 + 右側檢視 / 審核,[+ 新增] 開表單引擎的新增頁。
 */
describe("排班作業:支援需求單", () => {
  restoreViewportAfterEach();

  it("有 schedule.manage.view:分頁出現,列出日期、時段、崗位、人數、分店與狀態", async () => {
    renderSupport();
    expect(
      await screen.findByRole("tab", { name: "支援需求單" }),
    ).toHaveAttribute("aria-selected", "true");
    const table = await screen.findByRole("table", { name: "支援需求單列表" });
    expect(await within(table).findByText("17:00–21:00")).toBeInTheDocument();
    const row = within(table).getByText("17:00–21:00").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("店內櫃台")).toBeInTheDocument();
    expect(cells.getByText("台北分店")).toBeInTheDocument();
    expect(cells.getByText("審核中")).toBeInTheDocument();
    expect(within(table).getByText("13:00–17:00")).toBeInTheDocument();
    expect(within(table).getByText("已退回")).toBeInTheDocument();
  });

  it("只查支援需求單那一張表單;篩狀態帶給 api、回到第一頁", async () => {
    const { user, formsFake } = renderSupport();
    await screen.findByText("17:00–21:00");
    expect(formsFake.inputs.formSubmissions.at(-1)).toMatchObject({
      moduleKey: "schedule.manage",
      formKey: "support_request",
      page: 1,
    });
    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "已退回" }));
    await waitFor(() => {
      expect(formsFake.inputs.formSubmissions.at(-1)).toMatchObject({
        status: "RETURNED",
        page: 1,
      });
    });
    expect(screen.queryByText("17:00–21:00")).toBeNull();
    expect(await screen.findByText("14:30–22:00")).toBeInTheDocument();
  });

  it("沒有 schedule.manage.view:沒有支援需求單分頁", async () => {
    renderSupport({
      path: "/schedule/manage",
      omit: ["schedule.manage.view"],
    });
    expect(
      await screen.findByRole("tab", { name: "行事曆" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "支援需求單" })).toBeNull();
  });

  it("只剩一個分頁時不顯示分頁籤", async () => {
    renderSupport({
      path: "/schedule/manage",
      omit: ["schedule.manage.view", "schedule.manage.view-day-offs"],
    });
    expect(await screen.findByText(/店休/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "行事曆" })).toBeNull();
  });

  it("點一筆:右側檢視(表單內容)與審核(待我審核 → 核准 / 退回修改)", async () => {
    const { user } = renderSupport();
    await user.click(await screen.findByText("17:00–21:00"));
    const panel = await screen.findByRole("region", {
      name: "支援需求單檢視與審核",
    });
    expect(
      await within(panel).findByText("支援需求單 · 台北分店"),
    ).toBeInTheDocument();
    expect(
      await within(panel).findByDisplayValue("颱風後補人,晚間人手不足"),
    ).toBeInTheDocument();
    expect(
      await within(panel).findByRole("button", { name: "核准" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "退回修改" }),
    ).toBeInTheDocument();
  });

  it("[+ 新增] → 新增頁:表單關了「允許存草稿」,只有 [送出]、沒有 [存草稿]", async () => {
    const { user } = renderSupport();
    await user.click(await screen.findByRole("button", { name: "+ 新增" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/schedule/manage/create-page/support_request",
      );
    });
    expect(
      await screen.findByRole("button", { name: "送出" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "存草稿" })).toBeNull();
  });

  it("沒有 schedule.manage.create:沒有 [+ 新增]", async () => {
    renderSupport({
      omit: ["schedule.manage.create"],
      forms: supportRequestFormWorld({
        moduleForms: [
          {
            key: "support_request",
            name: "支援需求單",
            moduleKey: "schedule.manage",
            currentVersion: 1,
            tabLabelTemplate: null,
            allowDraft: false,
            canCreate: false,
          },
        ],
      }),
    });
    await screen.findByText("17:00–21:00");
    expect(screen.queryByRole("button", { name: "+ 新增" })).toBeNull();
  });

  it("手機:列表改卡片,點卡片進詳情頁", async () => {
    setMobileViewport();
    const { user } = renderSupport();
    const card = await screen.findByRole("button", {
      name: /17:00–21:00/,
    });
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(card);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/schedule/manage/view-page/sub-support-12",
      );
    });
  });
});
