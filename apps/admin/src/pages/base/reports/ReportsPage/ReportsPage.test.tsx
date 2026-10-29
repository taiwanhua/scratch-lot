import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { captureDownloads } from "@/test/download";

import {
  DAILY_PERMISSION,
  DAY_WITH_TWO_ORGS,
  FIXTURE_REPORTS,
  SUMMARY_PERMISSION,
} from "./reports-fixtures";

/**
 * 輸出報表外框(`docs/modules/reports.md`):正式路由、殼、守門與登記的合成都是真的,
 * 底座的報表登記換成兩張測試報表(ESM 要先登記 mock 再動態載入)。
 */
jest.unstable_mockModule("@/app/base/reports", () => ({
  baseReports: FIXTURE_REPORTS,
}));

const { adminText, renderReportsPage } = await import("@/test/reports-page");

const SUMMARY = adminText("userManager.tableLabel");
const DAILY = adminText("roleManager.listTitle");
const conditionsTitle = (name: string) =>
  adminText("reports.conditions.title", { name });
const previewTitle = (name: string, period: string) =>
  adminText("reports.preview.title", { name, period });
const TOTAL_SHEET = adminText("reports.totalSheet");
const ORGS_LABEL = adminText("reports.conditions.orgs");
const RANGE_TOO_LARGE = adminText("reports.errors.RANGE_TOO_LARGE");

const downloads = captureDownloads();

const reportList = () => screen.findByRole("region", { name: "報表" });

describe("輸出報表:選單依權限", () => {
  it("有一張報表的權限:選單只有那一張(註明組織上限),右側是它的條件", async () => {
    renderReportsPage({ permissions: [SUMMARY_PERMISSION] });

    const list = await reportList();
    expect(
      within(list)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual([
      adminText("reports.reportList.option", { name: SUMMARY, max: 50 }),
    ]);
    expect(within(list).getByRole("radio")).toBeChecked();
    expect(
      await screen.findByRole("region", { name: conditionsTitle(SUMMARY) }),
    ).toBeInTheDocument();
  });

  it("兩張都有:都在選單;點另一張,條件換成那一張(只有日,不顯示期間頁籤)", async () => {
    const { user } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION, DAILY_PERMISSION],
    });
    const list = await reportList();
    expect(within(list).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "週" })).toBeInTheDocument();

    await user.click(
      within(list).getByRole("radio", { name: new RegExp(DAILY) }),
    );
    expect(
      await screen.findByRole("region", { name: conditionsTitle(DAILY) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "週" })).not.toBeInTheDocument();
  });

  it("沒有任何報表權限:選單是空的並顯示說明,沒有條件區", async () => {
    renderReportsPage({ permissions: [] });

    const list = await reportList();
    expect(within(list).queryAllByRole("radio")).toEqual([]);
    expect(
      within(list).getByText(adminText("reports.reportList.empty")),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /條件/ }),
    ).not.toBeInTheDocument();
  });
});

describe("輸出報表:[匯出 Excel] 依 reports.export", () => {
  it("沒有 reports.export:看不到 [匯出 Excel],[預覽] 照常", async () => {
    renderReportsPage({ permissions: [SUMMARY_PERMISSION] });
    await screen.findByRole("region", { name: conditionsTitle(SUMMARY) });
    expect(screen.getByRole("button", { name: "預覽" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "匯出 Excel" }),
    ).not.toBeInTheDocument();
  });

  it("有 reports.export:看得到 [匯出 Excel];沒選組織時兩顆都不能按", async () => {
    renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
    });
    await screen.findByRole("region", { name: conditionsTitle(SUMMARY) });
    expect(screen.getByRole("button", { name: "匯出 Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "預覽" })).toBeDisabled();
    expect(
      screen.getByText(adminText("reports.conditions.orgsRequired")),
    ).toBeInTheDocument();
  });
});

describe("輸出報表:預覽與匯出", () => {
  it("預覽:送出租戶時區的起訖時點與組織;預設顯示全部組織合計,可切換組織", async () => {
    const { user, fake } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION],
      search: DAY_WITH_TWO_ORGS,
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));

    const preview = await screen.findByRole("region", {
      name: previewTitle(SUMMARY, "2026-10-16"),
    });
    expect(fake.inputs).toEqual([
      {
        periodKind: "day",
        from: "2026-10-15T16:00:00.000Z",
        to: "2026-10-16T16:00:00.000Z",
        orgIds: ["org-north", "org-south"],
      },
    ]);
    const tabs = await within(preview).findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      TOTAL_SHEET,
      "北區",
      "南區",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(preview).getByText("合計說明")).toBeInTheDocument();
    expect(within(preview).getByText("300")).toBeInTheDocument();

    await user.click(within(preview).getByRole("tab", { name: "南區" }));
    expect(await within(preview).findByText("200")).toBeInTheDocument();
    expect(within(preview).queryByText("合計說明")).not.toBeInTheDocument();
  });

  it("匯出 Excel:下載「<報表>_<期間>.xlsx」", async () => {
    const { user, fake } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
      search: DAY_WITH_TWO_ORGS,
    });
    await user.click(await screen.findByRole("button", { name: "匯出 Excel" }));
    await waitFor(() => {
      expect(downloads.map((download) => download.fileName)).toEqual([
        `${SUMMARY}_2026-10-16.xlsx`,
      ]);
    });
    expect(fake.inputs).toHaveLength(1);
  });

  it("api 回 RANGE_TOO_LARGE:顯示超過上限的說明", async () => {
    const { user } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION],
      search: DAY_WITH_TWO_ORGS,
      fail: { code: "VALIDATION_FAILED", reason: "RANGE_TOO_LARGE" },
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    expect(await screen.findByText(RANGE_TOO_LARGE)).toBeInTheDocument();
  });

  it("先預覽再從預覽匯出:Excel 用預覽那一份,api 只查一次", async () => {
    const { user, fake } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
      search: DAY_WITH_TWO_ORGS,
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    const preview = await screen.findByRole("region", {
      name: previewTitle(SUMMARY, "2026-10-16"),
    });
    await within(preview).findByText("300");

    await user.click(
      within(preview).getByRole("button", { name: "匯出 Excel" }),
    );
    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    expect(fake.inputs).toHaveLength(1);
  });
});

describe("輸出報表:匯出失敗的提示", () => {
  const failedExport = { code: "VALIDATION_FAILED", reason: "RANGE_TOO_LARGE" };
  const alertText = RANGE_TOO_LARGE;

  it("改條件就清掉", async () => {
    const { user } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
      search: DAY_WITH_TWO_ORGS,
      fail: failedExport,
    });
    await user.click(await screen.findByRole("button", { name: "匯出 Excel" }));
    expect(await screen.findByText(alertText)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "昨天" }));
    await waitFor(() => {
      expect(screen.queryByText(alertText)).not.toBeInTheDocument();
    });
    expect(downloads).toEqual([]);
  });

  it("關掉預覽([返回條件])就清掉", async () => {
    const { user, fake } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
      search: DAY_WITH_TWO_ORGS,
      fail: failedExport,
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    const preview = await screen.findByRole("region", {
      name: previewTitle(SUMMARY, "2026-10-16"),
    });
    expect(await screen.findByText(alertText)).toBeInTheDocument();

    // 在預覽裡匯出也失敗(預覽沒有資料可用,匯出重查)
    await user.click(
      within(preview).getByRole("button", { name: "匯出 Excel" }),
    );
    await waitFor(() => {
      expect(fake.inputs).toHaveLength(2);
    });
    expect(screen.getByText(alertText)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回條件" }));
    await screen.findByRole("region", { name: conditionsTitle(SUMMARY) });
    expect(screen.queryByText(alertText)).not.toBeInTheDocument();
    expect(downloads).toEqual([]);
  });
});

describe("輸出報表:版面與組織範圍", () => {
  it("[匯出 Excel](主要)在左、[預覽](外框)在右", async () => {
    renderReportsPage({
      permissions: [SUMMARY_PERMISSION, "reports.export"],
    });
    const conditions = await screen.findByRole("region", {
      name: conditionsTitle(SUMMARY),
    });
    const buttons = within(conditions)
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => text === "匯出 Excel" || text === "預覽");
    expect(buttons).toEqual(["匯出 Excel", "預覽"]);
  });

  it("組織選擇器與預覽的組織名稱都查整棵租戶樹(TenantOrgTree),不查管理範圍", async () => {
    const { user, fake } = renderReportsPage({
      permissions: [SUMMARY_PERMISSION],
      search: DAY_WITH_TWO_ORGS,
    });
    await user.click(await screen.findByRole("combobox", { name: ORGS_LABEL }));
    await screen.findByText("示範總部");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    const preview = await screen.findByRole("region", {
      name: previewTitle(SUMMARY, "2026-10-16"),
    });
    expect(
      await within(preview).findByRole("tab", { name: "北區" }),
    ).toBeInTheDocument();
    expect(fake.orgTreeCalls.visible).toBeGreaterThan(0);
    expect(fake.orgTreeCalls.managed).toBe(0);
  });
});
