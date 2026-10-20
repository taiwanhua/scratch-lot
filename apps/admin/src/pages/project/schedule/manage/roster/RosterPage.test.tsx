import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../schedule-test-support";
import {
  fastUser,
  findDialog,
  findLabelled,
  findOption,
  queryButton,
  queryDialog,
} from "./roster-test-queries";

setupFakeViewport();

/** 整頁測試:事件之間不讓出計時器(`fastUser`);查詢見 `roster-test-queries.ts`。 */
const renderRoster = (options: Parameters<typeof renderSchedulePage>[0]) => ({
  ...renderSchedulePage(options),
  user: fastUser(),
});

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

const cell = async (name: string, date: string) =>
  findLabelled(`${name} ${date}`);

/** 沒有 `edit` 時格子不能點(不是按鈕),以 `data-roster-cell` 找。 */
const cellOf = async (userId: string, date: string): Promise<HTMLElement> => {
  await screen.findByText("王小明", {
    selector: "h6, .MuiTypography-subtitle2",
  });
  const key = [userId, date].join("|");
  const found = document.querySelector<HTMLElement>(
    `[data-roster-cell="${CSS.escape(key)}"]`,
  );
  if (found === null) {
    throw new Error(`找不到 ${userId} ${date} 的格子`);
  }
  return found;
};

/**
 * 排班作業 → 排班表(SC-03、SC-04a–f、SC-21a–d、SC-33/33a/33b;規格 14.5):班表檢視、兩種對話框、
 * 沒有 `edit` 的唯讀。假 api 見 `test/msw/project/schedule-roster-handlers.ts`(2026-11 的 1–7 日)。
 */
describe("排班作業:排班表(班表檢視)", () => {
  it("人員列、人力需求區的人數標籤(三態)與統計欄", async () => {
    renderRoster({ path: ROSTER });
    expect(await cell("王小明", "11/1")).toBeInTheDocument();
    // 統計欄:總工時到分鐘
    expect(screen.getByText("152:30")).toBeInTheDocument();
    // 11/2 晚班:負責有人、協同空著 → 「負1/1 協0/1」
    const lateTags = await screen.findAllByLabelText(
      "店內櫃台 人力需求 負1/1 協0/1",
    );
    expect(lateTags.length).toBeGreaterThan(0);
    // 店休那天整欄寫「店休」
    expect(screen.getAllByText("店休").length).toBeGreaterThan(0);
  });

  it("沒有 edit:看不到 [+ 人力需求] [+ 新增排班] 與日期欄 [⋯];點排班開唯讀對話框,只剩 [關閉]", async () => {
    const { user } = renderRoster({
      path: ROSTER,
      omit: ["schedule.manage.edit"],
      roster: { canEdit: false },
    });
    const wang = await cellOf("u-wang", "2026-11-01");
    expect(queryButton("+ 人力需求")).not.toBeInTheDocument();
    expect(queryButton("+ 新增排班")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("11/1 的更多動作")).not.toBeInTheDocument();
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    expect(within(dialog).getByLabelText(/上班/)).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "儲存" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "關閉" }),
    ).toBeInTheDocument();
  });

  it("排班對話框:移除最後一列 → [儲存] 停用並提示", async () => {
    const { user } = renderRoster({ path: ROSTER });
    const wang = await cell("王小明", "11/1");
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    expect(within(dialog).getByRole("button", { name: "儲存" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    expect(within(dialog).getByRole("button", { name: "儲存" })).toBeDisabled();
    expect(
      within(dialog).getByText(
        "至少要填進一筆人力需求;不要這筆排班請按 [刪除這筆排班]",
      ),
    ).toBeInTheDocument();
  });

  it("新增排班:選人力需求自動填第一個空的任務(還缺負責且可以擔任 → 負責)", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    // 11/5 早班:王小明整天畫休,負責、協同都空著;陳大文可以擔任負責人
    await user.click(await cell("陳大文", "11/5"));
    const dialog = await findDialog("新增排班 · 11/5(四)");
    await user.type(within(dialog).getByLabelText(/上班/), "08:30");
    await user.type(within(dialog).getByLabelText(/下班/), "14:00");
    await user.click(
      within(dialog).getByRole("button", { name: "+ 加入人力需求" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "人力需求" }),
    );
    await user.click(await findOption("早班 08:30–14:30 · 店內櫃台"));
    expect(
      within(dialog).getByRole("combobox", { name: "職責 · 執行任務" }),
    ).toHaveTextContent("負責 · 店內事務與帳目負責");
    // 下班 14:00 沒涵蓋早班到 14:30 → 提示 + [往後延長到 14:30]
    await user.click(
      within(dialog).getByRole("button", { name: "往後延長到 14:30" }),
    );
    expect(within(dialog).getByLabelText(/下班/)).toHaveValue("14:30");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(rosterFake.inputs.entries).toEqual([
        expect.objectContaining({
          userId: "u-chen",
          assignments: [{ demandId: "d-early-5", taskId: "d-early-5-t1" }],
        }),
      ]);
    });
  });

  it("[新增一筆人力需求] 疊開:新增成功 → 回到排班對話框並自動加一列;排班再按取消 → 人力需求保留", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await cell("林美麗", "11/6"));
    const entryDialog = await findDialog("新增排班 · 11/6(五)");
    await user.type(within(entryDialog).getByLabelText(/上班/), "13:00");
    await user.type(within(entryDialog).getByLabelText(/下班/), "18:00");

    // 先開再取消:什麼都不變
    await user.click(
      within(entryDialog).getByRole("button", { name: "新增一筆人力需求" }),
    );
    let demandDialog = await findDialog("新增人力需求");
    await user.click(
      within(demandDialog).getByRole("button", { name: "取消" }),
    );
    await waitFor(() => {
      expect(queryDialog("新增人力需求")).not.toBeInTheDocument();
    });
    expect(
      within(entryDialog).queryByRole("combobox", { name: "人力需求" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(entryDialog).getByRole("button", { name: "新增一筆人力需求" }),
    );
    demandDialog = await findDialog("新增人力需求");
    // 日期鎖定為這筆排班那天、時間帶入排班的上下班
    expect(within(demandDialog).getByLabelText(/開始/)).toHaveValue("13:00");
    await user.click(
      within(demandDialog).getByRole("combobox", { name: /崗位/ }),
    );
    await user.click(await findOption("店外攤位"));
    await user.click(
      within(demandDialog).getByRole("button", { name: "+ 協同" }),
    );
    await user.click(
      within(demandDialog).getByRole("button", { name: "新增" }),
    );
    await waitFor(() => {
      expect(queryDialog("新增人力需求")).not.toBeInTheDocument();
    });
    expect(
      within(entryDialog).getByRole("combobox", { name: "人力需求" }),
    ).toHaveTextContent("臨 13:00–18:00 · 店外攤位");
    expect(
      within(entryDialog).getByRole("combobox", { name: "職責 · 執行任務" }),
    ).toHaveTextContent("協同 · 店內事務");

    await user.click(within(entryDialog).getByRole("button", { name: "取消" }));
    expect(rosterFake.inputs.demands).toHaveLength(1);
    expect(rosterFake.inputs.entries).toHaveLength(0);
    expect(rosterFake.demandIds().some((id) => id.startsWith("d-new"))).toBe(
      true,
    );
  });

  it("刪除人力需求:列出會解除的人;零筆的排班一起刪", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await cell("王小明", "11/1");
    const tags = await screen.findAllByLabelText(
      "店內櫃台 人力需求 負1/1 協0/1",
    );
    const early = tags.at(0);
    if (early === undefined) {
      throw new Error("找不到 11/1 早班");
    }
    await user.click(early);
    const dialog = await findDialog("人力需求 · 11/1(日)早班");
    expect(within(dialog).getByText("王小明 填進")).toBeInTheDocument();
    expect(within(dialog).getByText("還沒有人填")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "刪除人力需求" }),
    );
    const confirm = await findDialog("刪除 11/1(日)早班?");
    expect(
      within(confirm).getByText("王小明 · 負責 · 店內事務與帳目負責"),
    ).toBeInTheDocument();
    await user.click(
      within(confirm).getByRole("button", {
        name: "刪除人力需求並刪除這 1 筆排班",
      }),
    );
    await waitFor(() => {
      expect(rosterFake.demandIds()).not.toContain("d-early-1");
    });
  });
});
