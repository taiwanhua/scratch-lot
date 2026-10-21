import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import {
  fastUser,
  findButton,
  findDialog,
  queryButton,
} from "../roster-test-queries";

setupFakeViewport();

/** 整頁測試:事件之間不讓出計時器(`fastUser`);查詢見 `roster-test-queries.ts`。 */
const renderRoster = (options: Parameters<typeof renderSchedulePage>[0]) => ({
  ...renderSchedulePage(options),
  user: fastUser(),
});

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

/** 套用範本是右側抽屜(不是 role=dialog):以抽屜裡的標題找到抽屜本體。 */
const findApplyDrawer = async (): Promise<HTMLElement> => {
  const heading = await screen.findByText("人力需求範本(可多選)");
  const paper = heading.closest<HTMLElement>(".MuiDrawer-paper");
  if (paper === null) {
    throw new Error("找不到套用範本抽屜");
  }
  return paper;
};

/**
 * 排班表的套用範本與自動排班(SC-17a/b、SC-20a/b/c、SC-36、SC-37;規格 14.4、14.5)。
 * 假 api 見 `test/msw/project/schedule-auto-run-handlers.ts`(套用的規則與預覽由 api 算)。
 */
describe("排班作業:套用範本", () => {
  it("[套用範本] → 抽屜:預設整個月全選(店休不選)、勾範本後預覽「將產生 N 個時段,略過 M 個」→ [套用] 送出", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("套用範本"));
    const drawer = await findApplyDrawer();
    const apply = within(drawer).getByRole("button", { name: "套用" });
    expect(apply).toBeDisabled();
    await user.click(
      within(drawer).getByRole("checkbox", { name: /^晚班 14:30–22:00/u }),
    );
    expect(
      await within(drawer).findByText(
        /^將產生 \d+ 個時段,略過 \d+ 個已存在的相同時段$/u,
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "會加入到選取的日子,即使那天已經有其他人力需求;同一天崗位和時間完全相同的會略過。",
      ),
    ).toBeInTheDocument();
    await user.click(apply);
    await waitFor(() => {
      expect(rosterFake.autoInputs.applied).toHaveLength(1);
    });
    const [sent] = rosterFake.autoInputs.applied;
    expect(sent).toMatchObject({
      month: "2026-11",
      kind: "template",
      templateIds: ["tpl-late"],
    });
    // 整個月 30 天,夾具 11/3 店休不能選
    expect(sent.dates).toHaveLength(29);
    expect(sent.dates).not.toContain("2026-11-03");
  });

  it("週範本:單選、說明文字換成週範本的、[平日] 快選;預覽「將補上 N 天」", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("套用範本"));
    const drawer = await findApplyDrawer();
    await user.click(
      within(drawer).getByRole("button", { name: "人力需求週範本" }),
    );
    expect(
      within(drawer).getByRole("radio", { name: /^平日標準週 · / }),
    ).toBeChecked();
    await user.click(within(drawer).getByRole("button", { name: "平日" }));
    expect(
      await within(drawer).findByText(
        /^將補上 \d+ 天的人力需求\(略過已經有人力需求的 \d+ 天\)$/u,
      ),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(rosterFake.autoInputs.applied).toHaveLength(1);
    });
    const [sent] = rosterFake.autoInputs.applied;
    expect(sent).toMatchObject({
      kind: "week-template",
      weekTemplateId: "wk-normal",
    });
    // 2026-11-01 是星期日:平日不含 1、7、8 日
    expect(sent.dates).not.toContain("2026-11-01");
    expect(sent.dates).toContain("2026-11-02");
  });

  it("沒有 edit → 看不到 [套用範本]", async () => {
    renderRoster({ path: ROSTER, omit: ["schedule.manage.edit"] });
    await findButton("限制 1 · 提醒 6");
    expect(queryButton("套用範本")).not.toBeInTheDocument();
  });
});

describe("排班作業:自動排班", () => {
  it("[自動排班] → 只填空位、條件照這家店的設定 → [執行];完成後檢核面板展開、最上方是這次的摘要", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("自動排班"));
    const dialog = await findDialog("自動排班");
    expect(
      within(dialog).getByRole("radio", { name: "只填空位" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: "延續同一人的排班" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "允許同一人同時段填進多筆人力需求",
      }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "先以「平日標準週」補上人力需求",
      }),
    ).toBeChecked();
    const run = within(dialog).getByRole("button", { name: "執行" });
    await waitFor(() => {
      expect(run).toBeEnabled();
    });
    await user.click(run);
    await waitFor(() => {
      expect(rosterFake.autoInputs.runs).toHaveLength(1);
    });
    expect(rosterFake.autoInputs.runs[0]).toMatchObject({
      month: "2026-11",
      from: "2026-11-01",
      to: "2026-11-30",
      mode: "fill-empty",
      fillWeekTemplate: true,
      conditions: [
        { key: "continuePreviousEntry", enabled: true },
        { key: "leaderCountFirst", enabled: true },
        { key: "monthlyShiftBalance", enabled: false },
        { key: "allowOverlappingDemands", enabled: false },
      ],
    });
    const panel = await screen.findByLabelText("檢核");
    expect(
      await within(panel).findByText(/填入 \d+ 人次$/u),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "清除自動排入的人" }),
    ).toBeInTheDocument();
  });

  it("條件可以用把手調整順序(上下鍵)", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("自動排班"));
    const dialog = await findDialog("自動排班");
    const handle = within(dialog).getByRole("button", {
      name: "調整「本月班數平均」的順序(拖拉,或按上下鍵)",
    });
    handle.focus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    const run = within(dialog).getByRole("button", { name: "執行" });
    await waitFor(() => {
      expect(run).toBeEnabled();
    });
    await user.click(run);
    await waitFor(() => {
      expect(rosterFake.autoInputs.runs).toHaveLength(1);
    });
    expect(
      rosterFake.autoInputs.runs[0]?.conditions.map((item) => item.key),
    ).toEqual([
      "monthlyShiftBalance",
      "continuePreviousEntry",
      "leaderCountFirst",
      "allowOverlappingDemands",
    ]);
  });

  it("全部重排 → 先確認「將清除 N 個手動排入的人次」,確認後才送出", async () => {
    const { user, rosterFake } = renderRoster({ path: ROSTER });
    await user.click(await findButton("自動排班"));
    const dialog = await findDialog("自動排班");
    await user.click(
      within(dialog).getByRole("radio", {
        name: "全部重排(連手動排的一起清掉)",
      }),
    );
    const run = within(dialog).getByRole("button", { name: "執行" });
    await waitFor(() => {
      expect(run).toBeEnabled();
    });
    await user.click(run);
    const confirm = await findDialog("全部重排?");
    expect(
      within(confirm).getByText(
        /^將清除 \d+ 個手動排入的人次,再重新自動排班。確定嗎\?$/u,
      ),
    ).toBeInTheDocument();
    expect(rosterFake.autoInputs.runs).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "全部重排" }));
    await waitFor(() => {
      expect(rosterFake.autoInputs.runs[0]?.mode).toBe("redo-all");
    });
  });

  it("範圍內沒有人力需求也沒有週範本 → 提示並停用 [執行](SC-20c)", async () => {
    const { user } = renderRoster({
      path: ROSTER,
      roster: { isEmpty: true },
    });
    await user.click(await findButton("自動排班"));
    const dialog = await findDialog("自動排班");
    expect(
      await within(dialog).findByText(
        "11 月還沒有任何人力需求,請先套用人力需求範本或人力需求週範本",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "執行" })).toBeDisabled();
  });

  it("沒有 auto-run 看不到 [自動排班];已發布不顯示;別人執行中 → 停用並寫「自動排班執行中」", async () => {
    const first = renderRoster({
      path: ROSTER,
      omit: ["schedule.manage.auto-run"],
      roster: { canAutoRun: false },
    });
    await findButton("套用範本");
    expect(queryButton("自動排班")).not.toBeInTheDocument();
    first.unmount();

    const second = renderRoster({
      path: ROSTER,
      roster: { isPublished: true },
    });
    await findButton("套用範本");
    expect(queryButton("自動排班")).not.toBeInTheDocument();
    second.unmount();

    renderRoster({ path: ROSTER, roster: { autoRunning: true } });
    expect(await findButton("自動排班執行中")).toBeDisabled();
  });

  it("清除自動排入的人:檢核面板 [清除自動排入的人] → 確認 → 只送範圍", async () => {
    const { user, rosterFake } = renderRoster({
      path: ROSTER,
      roster: { hasAutoRun: true },
    });
    await user.click(await findButton("限制 1 · 提醒 6"));
    const panel = await screen.findByLabelText("檢核");
    expect(
      await within(panel).findByText(/填入 112 人次 · 補上 18 天的人力需求$/u),
    ).toBeInTheDocument();
    await user.click(
      within(panel).getByRole("button", { name: "清除自動排入的人" }),
    );
    const dialog = await findDialog("清除自動排入的人");
    expect(
      within(dialog).getByText(/^只移除自動排入的人\(\d+ 人次\)/u),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "清除" }));
    await waitFor(() => {
      expect(rosterFake.autoInputs.cleared).toEqual([
        expect.objectContaining({
          month: "2026-11",
          from: "2026-11-01",
          to: "2026-11-30",
        }),
      ]);
    });
  });
});
