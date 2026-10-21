import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../schedule-test-support";
import { fastUser, findDialog, findLabelled } from "./roster-test-queries";

setupFakeViewport();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";

/** 王小明 11/4 那一格的排班(早 08:30–14:30)。 */
const openWangNov4 = async (user: ReturnType<typeof fastUser>) => {
  const cell = await findLabelled("王小明 11/4");
  await user.click(within(cell).getByRole("button", { name: /^早/ }));
  return findDialog("排班 · 王小明 11/4(三)");
};

/**
 * 排班對話框的未對應排班的打卡(SC-04d、SC-04e ①;規格 14.5):假 api 的夾具是王小明 11/4 三張
 * (08:27 上班、08:31 上班 = 重複打卡、14:36 下班)、林美麗 11/1 兩張(那天沒有排班)。
 */
describe("排班表:未對應排班的打卡", () => {
  it("班表格子的時鐘圖示 + 張數", async () => {
    renderSchedulePage({ path: ROSTER });
    expect(
      await screen.findByLabelText("3 張未對應排班的打卡"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("2 張未對應排班的打卡").length,
    ).toBeGreaterThan(0);
  });

  it("預設勾容許時間內、重複打卡不勾;儲存後勾選的打卡對應到這筆排班,不勾的不對應", async () => {
    const user = fastUser();
    const { rosterFake } = renderSchedulePage({ path: ROSTER });
    const dialog = await openWangNov4(user);
    const block = within(dialog).getByRole("region", {
      name: "未對應排班的打卡",
    });
    expect(
      within(block).getByText("王小明 11/4 有 3 張未對應排班的打卡"),
    ).toBeInTheDocument();
    expect(within(block).getByLabelText("08:27 上班")).toBeChecked();
    expect(
      within(block).getByLabelText("08:31 上班 · 重複打卡"),
    ).not.toBeChecked();
    const out = within(block).getByLabelText("14:36 下班");
    expect(out).toBeChecked();
    // 不勾下班卡 → 只對應上班卡
    await user.click(out);
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(rosterFake.inputs.entries).toHaveLength(1);
    });
    expect(rosterFake.inputs.entries[0]?.punchIds).toEqual(["p-wang-1"]);
    expect(rosterFake.inputs.entries[0]?.usePunchTime).toBeUndefined();
  });

  it("上下班時間改用打卡時間:預設不勾;勾了 → 上下班換成勾選的最早上班卡、最晚下班卡,送 usePunchTime", async () => {
    const user = fastUser();
    const { rosterFake } = renderSchedulePage({ path: ROSTER });
    const dialog = await openWangNov4(user);
    const usePunchTime =
      within(dialog).getByLabelText("上下班時間改用打卡時間");
    expect(usePunchTime).not.toBeChecked();
    await user.click(usePunchTime);
    expect(
      within(dialog).getByLabelText(/上班/, { selector: "input[type=time]" }),
    ).toHaveValue("08:27");
    expect(
      within(dialog).getByLabelText(/下班/, { selector: "input[type=time]" }),
    ).toHaveValue("14:36");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(rosterFake.inputs.entries).toHaveLength(1);
    });
    expect(rosterFake.inputs.entries[0]).toMatchObject({
      punchIds: ["p-wang-1", "p-wang-3"],
      usePunchTime: true,
    });
  });

  it("沒有 use-punch-time:不顯示「上下班時間改用打卡時間」", async () => {
    const user = fastUser();
    renderSchedulePage({
      path: ROSTER,
      omit: ["schedule.manage.use-punch-time"],
      roster: { canUsePunchTime: false },
    });
    const dialog = await openWangNov4(user);
    expect(
      within(dialog).getByText("王小明 11/4 有 3 張未對應排班的打卡"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("上下班時間改用打卡時間"),
    ).toBeNull();
  });

  it("那天沒有排班:點時鐘圖示開新增排班(人員、日期帶入),同一個區塊", async () => {
    const user = fastUser();
    renderSchedulePage({ path: ROSTER });
    const cell = await findLabelled("林美麗 11/1");
    await user.click(within(cell).getByLabelText("2 張未對應排班的打卡"));
    const dialog = await findDialog("新增排班 · 11/1(日)");
    expect(
      within(dialog).getByText("林美麗 11/1 有 2 張未對應排班的打卡"),
    ).toBeInTheDocument();
  });
});
