import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { reportsWorld } from "@/test/msw/project/lottery/reports-handlers";
import { server } from "@/test/msw/server";

import { renderReportsPage } from "./ReportsPage/reports-test-support";

/**
 * 輸出報表的兩張正式報表(專案規格第 11 章;Figma RE-01 / RE-02 / RE-03 / RE-04 / RE-05):正式路由與登記清單,
 * 報表查詢換成假 api(`reports-handlers.ts`,與 mock 模式同一份)。
 */

const conditions = (value: Record<string, unknown>) =>
  `conditions=${encodeURIComponent(JSON.stringify(value))}`;

const TWO_BRANCHES = ["org-zhongshan", "org-hsinchu"];

const render = (
  permissions: readonly string[],
  search: string,
  options: { withCost?: boolean } = {},
) => {
  const rendered = renderReportsPage({ permissions, search });
  const world = reportsWorld(options);
  server.use(...world.handlers);
  return { ...rendered, world };
};

describe("營運報表", () => {
  it("對齊日結:勾選框旁提醒,逐店列出實際期間;當天沒日結的店標示改用整天", async () => {
    render(
      ["reports.operations"],
      `?${conditions({
        period: { kind: "day", date: "2026-10-16" },
        orgIds: TWO_BRANCHES,
        extra: { alignDailyClose: true },
      })}`,
    );
    expect(
      await screen.findByText(/不要把多天的日報加總當成週報或月報/),
    ).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "各分店實際期間" });
    const rows = await within(table).findAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "分店實際期間註記",
      "中山店10/15 22:05 ~ 10/16 22:30",
      "新竹店10/16 00:00 ~ 10/17 00:00本店 10/16 未日結,期間改用整天,小金庫和盤點未核對",
    ]);
  });

  it("日:不勾對齊日結也提醒「不要把多天的日報加總」,但不列逐店期間", async () => {
    render(
      ["reports.operations"],
      `?${conditions({
        period: { kind: "day", date: "2026-10-16" },
        orgIds: TWO_BRANCHES,
        extra: {},
      })}`,
    );
    expect(
      await screen.findByText(/不要把多天的日報加總當成週報或月報/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "各分店實際期間" }),
    ).not.toBeInTheDocument();
  });

  it("預覽:區塊卡片(同一份工作表);有 show-cost 才有毛利;依遊戲展開", async () => {
    const { user, world } = render(
      ["reports.operations", "reports.show-cost"],
      `?${conditions({
        period: { kind: "day", date: "2026-10-16" },
        orgIds: TWO_BRANCHES,
        extra: {},
      })}`,
    );
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    const sales = await screen.findByRole("region", { name: "1 銷售" });
    expect(within(sales).getByText("刷條碼售出")).toBeInTheDocument();
    // 全部分店合計:210 + 105 張
    expect(within(sales).getByText("315 張 · 63,000")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "2 毛利" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "1 銷售 · 依遊戲展開" }),
    ).toBeInTheDocument();
    expect(world.operationsInputs[0]).toMatchObject({
      periodKind: "day",
      orgIds: TWO_BRANCHES,
    });
    // 只有日才送「對齊日結」
    expect(world.operationsInputs[0]?.alignDailyClose).toBe(false);
  });

  it("沒有 show-cost:預覽沒有毛利區塊(api 回 null 的成本不顯示)", async () => {
    const { user } = render(
      ["reports.operations"],
      `?${conditions({
        period: { kind: "day", date: "2026-10-16" },
        orgIds: TWO_BRANCHES,
        extra: {},
      })}`,
      { withCost: false },
    );
    await user.click(await screen.findByRole("button", { name: "預覽" }));
    await screen.findByRole("region", { name: "1 銷售" });
    expect(
      screen.queryByRole("region", { name: "2 毛利" }),
    ).not.toBeInTheDocument();
  });

  it("月:月份格子標示已關帳 / 尚未關帳,選到已關帳的月份說明前期更正", async () => {
    render(
      ["reports.operations"],
      `?${conditions({
        period: { kind: "month", date: "2026-09-01" },
        orgIds: TWO_BRANCHES,
        extra: {},
      })}`,
    );
    expect(await screen.findByText(/9 月已關帳:數字固定/)).toBeInTheDocument();
    const closed = await screen.findAllByText("已關帳");
    expect(closed.length).toBeGreaterThan(0);
    expect(screen.getAllByText("尚未關帳").length).toBeGreaterThan(0);
  });
});

describe("班次結帳歷史報表", () => {
  it("選了多家店:收銀點選項加分店名", async () => {
    const { user } = render(
      ["reports.shift-checkouts"],
      `?report=shift-checkouts&${conditions({
        period: { kind: "week", date: "2026-10-11" },
        orgIds: TWO_BRANCHES,
        extra: {},
      })}`,
    );
    await user.click(await screen.findByRole("combobox", { name: "收銀點" }));
    expect(
      await screen.findByRole("option", { name: "新竹店 · 店外攤位" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "中山店 · 店內櫃台" }),
    ).toBeInTheDocument();
  });

  it("條件有收銀點與只看有差額;預覽一班一列,盤點欄標示未盤點(跳過)", async () => {
    const { user, world } = render(
      ["reports.shift-checkouts"],
      `?report=shift-checkouts&${conditions({
        period: { kind: "week", date: "2026-10-11" },
        orgIds: ["org-zhongshan"],
        extra: {},
      })}`,
    );
    await screen.findByRole("region", { name: "班次結帳歷史報表 · 條件" });
    expect(
      screen.getByRole("combobox", { name: "收銀點" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "只看有差額" }));
    await user.click(screen.getByRole("button", { name: "預覽" }));
    const table = await screen.findByRole("table", { name: "全部分店合計" });
    expect(
      await within(table).findByText("未盤點(跳過):人力不足"),
    ).toBeInTheDocument();
    expect(within(table).getByText("陳小美")).toBeInTheDocument();
    expect(world.shiftInputs.at(-1)).toMatchObject({
      periodKind: "week",
      onlyWithDifference: true,
      cashPointId: "",
    });
  });
});
