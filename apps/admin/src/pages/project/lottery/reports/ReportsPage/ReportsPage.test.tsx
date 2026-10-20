import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { captureDownloads } from "@/test/download";

import { DAY_WITH_TWO_BRANCHES, FIXTURE_REPORTS } from "./reports-fixtures";

/**
 * 輸出報表外框(專案規格第 11 章、18.4;Figma RE-01 / RE-02 / RE-03):正式路由、殼、守門都是真的,
 * 報表登記清單換成測試報表(ESM 要先登記 mock 再動態載入;本票不登記正式報表)。
 */
jest.unstable_mockModule(
  "@/pages/project/lottery/reports/report-registrations",
  () => ({
    REPORT_REGISTRATIONS: FIXTURE_REPORTS,
  }),
);

const { renderReportsPage } = await import("./reports-test-support");

const downloads = captureDownloads();

const reportList = () => screen.findByRole("region", { name: "報表" });

describe("輸出報表:選單依權限", () => {
  it("有營運報表的權限:選單只有營運報表(註明分店上限),右側是它的條件", async () => {
    renderReportsPage({ permissions: ["reports.operations"] });

    const list = await reportList();
    expect(
      within(list)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["營運報表(分店最多 50 家)"]);
    expect(within(list).getByRole("radio")).toBeChecked();
    expect(
      await screen.findByRole("region", { name: "營運報表 · 條件" }),
    ).toBeInTheDocument();
  });

  it("兩張都有:都在選單;點另一張,條件換成那一張(只有日,不顯示期間頁籤)", async () => {
    const { user } = renderReportsPage({
      permissions: ["reports.operations", "reports.shift-checkouts"],
    });
    const list = await reportList();
    expect(within(list).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "週" })).toBeInTheDocument();

    await user.click(
      within(list).getByRole("radio", { name: /班次結帳歷史報表/ }),
    );
    expect(
      await screen.findByRole("region", { name: "班次結帳歷史報表 · 條件" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "週" })).not.toBeInTheDocument();
  });

  it("沒有任何報表權限:選單是空的並顯示說明,沒有條件區", async () => {
    renderReportsPage({ permissions: [] });

    const list = await reportList();
    expect(within(list).queryAllByRole("radio")).toEqual([]);
    expect(
      within(list).getByText(/你目前沒有可以輸出的報表/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /條件/ }),
    ).not.toBeInTheDocument();
  });
});

describe("輸出報表:[匯出 Excel] 依 reports.export", () => {
  it("沒有 reports.export:看不到 [匯出 Excel],[預覽] 照常", async () => {
    renderReportsPage({ permissions: ["reports.operations"] });
    await screen.findByRole("region", { name: "營運報表 · 條件" });
    expect(screen.getByRole("button", { name: "預覽" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "匯出 Excel" }),
    ).not.toBeInTheDocument();
  });

  it("有 reports.export:看得到 [匯出 Excel];沒選分店時兩顆都不能按", async () => {
    renderReportsPage({
      permissions: ["reports.operations", "reports.export"],
    });
    await screen.findByRole("region", { name: "營運報表 · 條件" });
    expect(screen.getByRole("button", { name: "匯出 Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "預覽" })).toBeDisabled();
    expect(screen.getByText("請至少選一家分店")).toBeInTheDocument();
  });
});

describe("輸出報表:預覽與匯出", () => {
  it("預覽:送出租戶時區的起訖時點與分店;預設顯示全部分店合計,可切換分店", async () => {
    const { user, fake } = renderReportsPage({
      permissions: ["reports.operations"],
      search: DAY_WITH_TWO_BRANCHES,
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));

    const preview = await screen.findByRole("region", {
      name: "營運報表 · 2026-10-16",
    });
    expect(fake.inputs).toEqual([
      {
        periodKind: "day",
        from: "2026-10-15T16:00:00.000Z",
        to: "2026-10-16T16:00:00.000Z",
        orgIds: ["org-zhongshan", "org-hsinchu"],
      },
    ]);
    const tabs = await within(preview).findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "全部分店合計",
      "中山店",
      "新竹店",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(preview).getByText("合計說明")).toBeInTheDocument();
    expect(within(preview).getByText("300")).toBeInTheDocument();

    await user.click(within(preview).getByRole("tab", { name: "新竹店" }));
    expect(await within(preview).findByText("200")).toBeInTheDocument();
    expect(within(preview).queryByText("合計說明")).not.toBeInTheDocument();
  });

  it("匯出 Excel:下載「<報表>_<期間>.xlsx」", async () => {
    const { user, fake } = renderReportsPage({
      permissions: ["reports.operations", "reports.export"],
      search: DAY_WITH_TWO_BRANCHES,
    });
    await user.click(await screen.findByRole("button", { name: "匯出 Excel" }));
    await waitFor(() => {
      expect(downloads.map((download) => download.fileName)).toEqual([
        "營運報表_2026-10-16.xlsx",
      ]);
    });
    expect(fake.inputs).toHaveLength(1);
  });

  it("api 回 RANGE_TOO_LARGE:顯示超過上限的說明", async () => {
    const { user } = renderReportsPage({
      permissions: ["reports.operations"],
      search: DAY_WITH_TWO_BRANCHES,
      fail: { code: "VALIDATION_FAILED", reason: "RANGE_TOO_LARGE" },
    });
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    expect(
      await screen.findByText(/期間或分店數超過這張報表的上限/),
    ).toBeInTheDocument();
  });
});
