import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  MAKEUP_ENTRY_DELETED_ID,
  MAKEUP_REVIEWING_ID,
  makeupPunchFormWorld,
  makeupPunchWorkflowWorld,
} from "@/test/msw/project/schedule-makeup-punch-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  fastUser,
  findButton,
  findDialog,
  findOption,
  queryButton,
} from "../manage/roster/roster-test-queries";
import { renderSchedulePage } from "../schedule-test-support";

setupFakeViewport();

const BY_STORE = "/schedule/attendance?tab=store&date=2026-11-04";
const BY_PERSON = "/schedule/attendance?tab=person&month=2026-11";

/**
 * 出勤紀錄(SC-11 / SC-12 / SC-13 / SC-29 / SC-30;規格 14.7、14.8):依分店(日)、依人員(月)、
 * 改對應排班、補打卡新增頁與審核頁。假 api 見 `test/msw/project/schedule-attendance-handlers.ts`。
 */
describe("出勤紀錄", () => {
  it("依分店(日):排班人數 / 已到 / 未到、狀態標籤(遲到 11 分、未到)、未對應排班另列", async () => {
    renderSchedulePage({ path: BY_STORE });
    expect(
      await screen.findByText(
        "排班 4 人 · 已到 3 · 未到 1 · 未對應排班的打卡 2 張",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("遲到 11 分")).toBeInTheDocument();
    expect(screen.getByText("未到")).toBeInTheDocument();
    expect(
      screen.getByText("張小芳 · 09:02 上班 · 15:10 下班"),
    ).toBeInTheDocument();
  });

  it("改對應排班:原因必填;選了原因送出 → 帶對應排班與原因", async () => {
    const user = fastUser();
    const { attendanceFake } = renderSchedulePage({ path: BY_STORE });
    const line = await screen.findByText("張小芳 · 09:02 上班 · 15:10 下班");
    const row = line.parentElement;
    if (row === null) {
      throw new Error("找不到未對應排班那一行");
    }
    await user.click(within(row).getByRole("button", { name: "改對應排班" }));
    const dialog = await findDialog("修改這張打卡對應的排班");
    expect(
      within(dialog).getByText("時間和類型不能改,只能改對應的排班"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(attendanceFake.inputs.reassigned).toEqual([]);
    await user.click(
      within(dialog).getByRole("combobox", { name: /對應排班/ }),
    );
    await user.click(await findOption("11/4 補 13:00–17:00"));
    await user.click(within(dialog).getByRole("combobox", { name: /原因/ }));
    await user.click(await findOption("臨時代班補排班後改對應"));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(attendanceFake.inputs.reassigned).toEqual([
        {
          punchId: "p-chang-in-2026-11-04",
          entryId: "e-chang-temp",
          reasonKey: "cover-shift-reassign",
        },
      ]);
    });
  });

  it("沒有 reassign-punches / export:看不到 [改對應排班] [匯出 Excel]", async () => {
    renderSchedulePage({
      path: BY_STORE,
      omit: [
        "schedule.attendance.reassign-punches",
        "schedule.attendance.export",
      ],
      attendance: { canReassign: false, canExport: false },
    });
    expect(await screen.findByText("遲到 11 分")).toBeInTheDocument();
    expect(queryButton("改對應排班")).toBeNull();
    expect(queryButton("匯出 Excel")).toBeNull();
    expect(queryButton("補打卡申請")).not.toBeNull();
  });

  it("依人員(月):缺卡的班附 [補打卡];員工(沒有 view-all)不能換人", async () => {
    renderSchedulePage({
      path: BY_PERSON,
      omit: ["schedule.attendance.view-all"],
      attendance: { canViewAll: false },
    });
    expect(await screen.findByText("店慶")).toBeInTheDocument();
    expect(screen.getAllByText("補打卡", { selector: "button" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("combobox", { name: /人員/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("補打卡新增頁:帶入對應排班;改了日期就清空;沒選對應排班 → 「請選擇對應排班」", async () => {
    const user = fastUser();
    const { formsFake } = renderSchedulePage({
      path: "/schedule/attendance/create-page/makeup_punch?date=2026-11-03&org=org-store&type=out&entry=e-wang-2026-11-03",
      forms: makeupPunchFormWorld(),
    });
    const entry = await screen.findByRole("combobox", { name: /對應排班/ });
    await waitFor(() => {
      expect(entry).toHaveTextContent("早 08:30–14:30");
    });
    // 改日期:對應排班清空
    const date = screen.getByRole("group", { name: /日期/ });
    fireEvent.click(
      within(date.parentElement ?? document.body).getByRole("button", {
        name: /choose date/i,
      }),
    );
    fireEvent.click(await screen.findByRole("gridcell", { name: "5" }));
    await waitFor(() => {
      expect(entry).not.toHaveTextContent("早 08:30–14:30");
    });
    await user.type(screen.getByLabelText(/時間/), "14:35");
    await user.click(screen.getByRole("combobox", { name: /原因/ }));
    await user.click(await findOption("忘記打卡"));
    await user.click(await findButton("送出"));
    expect(await screen.findByText("請選擇對應排班")).toBeInTheDocument();
    expect(formsFake.inputs.createAndSubmitFormSubmission).toEqual([]);
    // 選了對應排班 → 送出整張表單的值(對應排班 + 顯示文字)
    await user.click(entry);
    await user.click(await findOption("晚 17:00–22:00"));
    await user.click(await findButton("送出"));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(
      formsFake.inputs.createAndSubmitFormSubmission[0]?.values,
    ).toMatchObject({
      date: "2026-11-04T16:00:00.000Z",
      branch: "org-store",
      entry: "e-wang-late-2026-11-05",
      entry_label: "晚 17:00–22:00",
      punch_type: "out",
      time: "14:35",
      reason: { value: "forgot-punch", label: "忘記打卡" },
    });
  });

  it("補打卡新增頁:選「沒有排班(臨時代班)」→ 對應排班存 none、顯示文字照規格用詞", async () => {
    const user = fastUser();
    const { formsFake } = renderSchedulePage({
      path: "/schedule/attendance/create-page/makeup_punch?date=2026-11-03&org=org-store&type=in",
      forms: makeupPunchFormWorld(),
    });
    await user.click(await screen.findByRole("combobox", { name: /對應排班/ }));
    await user.click(await findOption("沒有排班(臨時代班)"));
    await user.type(screen.getByLabelText(/時間/), "09:02");
    await user.click(screen.getByRole("combobox", { name: /原因/ }));
    await user.click(await findOption("忘記打卡"));
    await user.click(await findButton("送出"));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(
      formsFake.inputs.createAndSubmitFormSubmission[0]?.values,
    ).toMatchObject({ entry: "none", entry_label: "沒有排班(臨時代班)" });
  });

  it("審核頁:選的排班已被刪除 → 警告、[核准] 停用;排班還在 → 可以核准", async () => {
    const workflow = makeupPunchWorkflowWorld();
    renderSchedulePage({
      path: `/schedule/attendance/view-page/${MAKEUP_ENTRY_DELETED_ID}`,
      forms: makeupPunchFormWorld(),
      workflow,
    });
    expect(
      await screen.findByText("對應的排班已被刪除,不能核准;請退回讓申請人重選"),
    ).toBeInTheDocument();
    expect(await findButton("核准")).toBeDisabled();
    expect(await findButton("退回修改")).toBeEnabled();
  });

  it("審核頁:排班還在 → 沒有警告、可以核准;摘要列出當天排班", async () => {
    renderSchedulePage({
      path: `/schedule/attendance/view-page/${MAKEUP_REVIEWING_ID}`,
      forms: makeupPunchFormWorld(),
      workflow: makeupPunchWorkflowWorld(),
    });
    expect(await screen.findByText("M-0031 · 補打卡申請")).toBeInTheDocument();
    expect(await findButton("核准")).toBeEnabled();
    expect(screen.getByText("早 08:30–14:30")).toBeInTheDocument();
    expect(
      screen.queryByText("對應的排班已被刪除,不能核准;請退回讓申請人重選"),
    ).toBeNull();
  });
});
