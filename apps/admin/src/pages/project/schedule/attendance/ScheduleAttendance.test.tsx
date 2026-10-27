import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { LIST_PAGE_ASIDE_MAX_HEIGHT } from "@/lib/base/list-page-layout";
import { mediaRulesAt } from "@/test/media-rules";
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
    const { attendanceFake } = renderSchedulePage({ path: BY_STORE });
    expect(
      await screen.findByText(
        "排班 4 人 · 已到 3 · 未到 1 · 未對應排班的打卡 2 張",
      ),
    ).toBeInTheDocument();
    // 送那天台北 00:00 的時點
    expect(attendanceFake.inputs.byStore[0]?.date).toBe(
      "2026-11-03T16:00:00.000Z",
    );
    expect(screen.getByText("遲到 11 分")).toBeInTheDocument();
    expect(screen.getByText("未到")).toBeInTheDocument();
    expect(
      screen.getByText("張小芳 · 09:02 上班 · 15:10 下班"),
    ).toBeInTheDocument();
  });

  it("依分店(日):未對應排班的打卡在表格上方;釘高時(1024×768)限高自捲、矮視窗(1024×600)不限高(STYLE-08)", async () => {
    renderSchedulePage({ path: BY_STORE });
    const table = await screen.findByRole("table", { name: "出勤紀錄" });
    const aside = await screen.findByRole("region", { name: "未對應排班" });
    expect(
      aside.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const capped = `max-height: ${LIST_PAGE_ASIDE_MAX_HEIGHT}`;
    const pinned = mediaRulesAt(aside, { width: 1024, height: 768 }).join(" ");
    expect(pinned).toContain(capped);
    expect(pinned).toContain("overflow: auto");
    expect(
      mediaRulesAt(aside, { width: 1024, height: 600 }).join(" "),
    ).not.toContain(capped);
    expect(globalThis.getComputedStyle(aside).flexShrink).toBe("0");
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

  it("匯出 Excel:送那天所在月份在台北的 [月初 00:00, 下月初 00:00)", async () => {
    const user = fastUser();
    const { attendanceFake } = renderSchedulePage({ path: BY_STORE });
    await user.click(await findButton("匯出 Excel"));
    await waitFor(() => {
      expect(attendanceFake.inputs.exports).toEqual([
        {
          from: "2026-10-31T16:00:00.000Z",
          to: "2026-11-30T16:00:00.000Z",
          orgId: "org-store",
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

  it("補打卡新增頁:帶入補打卡時間與對應排班;改了日期,選的班還在前後一天範圍內就保留、不在才清空;沒選對應排班 → 「請選擇對應排班」", async () => {
    const user = fastUser();
    const { formsFake, attendanceFake } = renderSchedulePage({
      // 帶入台北 11/3 14:30 下班(那一班的排班下班時間)
      path: "/schedule/attendance/create-page/makeup_punch?at=2026-11-03T06:30:00.000Z&org=org-store&type=out&entry=e-wang-2026-11-03",
      forms: makeupPunchFormWorld(),
    });
    const entry = await screen.findByRole("combobox", { name: /對應排班/ });
    await waitFor(() => {
      expect(entry).toHaveTextContent("11/3 早 08:30–14:30");
    });
    const picker = screen.getByRole("group", { name: /補打卡時間/ });
    expect(picker).toHaveTextContent("2026-11-03 14:30");
    // 下拉以那天台北 00:00 查
    expect(attendanceFake.inputs.makeupOptions.at(-1)).toEqual({
      at: "2026-11-02T16:00:00.000Z",
      orgId: "org-store",
    });
    // 同一天只改分鐘:對應排班不清
    await user.click(
      within(picker).getByRole("spinbutton", { name: "Minutes" }),
    );
    await user.keyboard("35");
    expect(entry).toHaveTextContent("早 08:30–14:30");
    // 改成隔天 11/4:11/3 的班還在 11/3–11/5 → 保留
    await user.click(within(picker).getByRole("spinbutton", { name: "Day" }));
    await user.keyboard("04");
    await waitFor(() => {
      expect(attendanceFake.inputs.makeupOptions.at(-1)?.at).toBe(
        "2026-11-03T16:00:00.000Z",
      );
    });
    await waitFor(() => {
      expect(entry).toHaveTextContent("11/3 早 08:30–14:30");
    });
    // 再改成 11/5:範圍 11/4–11/6,不含 11/3 → 清空
    await user.click(within(picker).getByRole("spinbutton", { name: "Day" }));
    await user.keyboard("05");
    await waitFor(() => {
      expect(entry).not.toHaveTextContent("早 08:30–14:30");
    });
    await user.click(screen.getByRole("combobox", { name: /原因/ }));
    await user.click(await findOption("忘記打卡"));
    await user.click(await findButton("送出"));
    expect(await screen.findByText("請選擇對應排班")).toBeInTheDocument();
    expect(formsFake.inputs.createAndSubmitFormSubmission).toEqual([]);
    // 選了對應排班 → 送出整張表單的值(補打卡時間是時點、對應排班 + 顯示文字)
    // 下拉列前後各一天的班,選項帶日期(前一天 11/4 的晚班也列得到)
    await user.click(entry);
    expect(await findOption("11/4 晚 17:00–22:00")).toBeInTheDocument();
    await user.click(await findOption("11/5 晚 17:00–22:00"));
    await user.click(await findButton("送出"));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(
      formsFake.inputs.createAndSubmitFormSubmission[0]?.values,
    ).toMatchObject({
      punch_at: "2026-11-05T06:35:00Z",
      branch: "org-store",
      entry: "e-wang-late-2026-11-05",
      entry_label: "11/5 晚 17:00–22:00",
      punch_type: "out",
      reason: { value: "forgot-punch", label: "忘記打卡" },
    });
  });

  it("補打卡新增頁:選「沒有排班(臨時代班)」→ 對應排班存 none、顯示文字照規格用詞", async () => {
    const user = fastUser();
    const { formsFake } = renderSchedulePage({
      path: "/schedule/attendance/create-page/makeup_punch?at=2026-11-03T01:02:00.000Z&org=org-store&type=in",
      forms: makeupPunchFormWorld(),
    });
    await user.click(await screen.findByRole("combobox", { name: /對應排班/ }));
    await user.click(await findOption("沒有排班(臨時代班)"));
    await user.click(screen.getByRole("combobox", { name: /原因/ }));
    await user.click(await findOption("忘記打卡"));
    await user.click(await findButton("送出"));
    await waitFor(() => {
      expect(formsFake.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(
      formsFake.inputs.createAndSubmitFormSubmission[0]?.values,
    ).toMatchObject({
      punch_at: "2026-11-03T01:02:00.000Z",
      entry: "none",
      entry_label: "沒有排班(臨時代班)",
    });
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

  it("申請中心詳情頁:選的排班已被刪除 → 警告、[核准] 停用(模組登記的審核畫面擴充);排班還在 → 可以核准", async () => {
    renderSchedulePage({
      path: `/apply-center/view-page/inst-${MAKEUP_ENTRY_DELETED_ID}`,
      forms: makeupPunchFormWorld(),
      workflow: makeupPunchWorkflowWorld(),
    });
    expect(
      await screen.findByText("對應的排班已被刪除,不能核准;請退回讓申請人重選"),
    ).toBeInTheDocument();
    await waitFor(async () => {
      expect(await findButton("核准")).toBeDisabled();
    });
    expect(await findButton("退回修改")).toBeEnabled();
  });

  it("申請中心詳情頁:排班還在 → 沒有警告、可以核准;不顯示對應排班的系統代碼", async () => {
    renderSchedulePage({
      path: `/apply-center/view-page/inst-${MAKEUP_REVIEWING_ID}`,
      forms: makeupPunchFormWorld(),
      workflow: makeupPunchWorkflowWorld(),
    });
    expect(await findButton("核准")).toBeEnabled();
    // 唯讀檢視:對應排班只顯示文字欄,存排班 id 的那一欄不渲染
    const shown = (value: string) =>
      screen.queryAllByText(value).length +
      screen.queryAllByDisplayValue(value).length;
    expect(shown("早 08:30–14:30")).toBeGreaterThan(0);
    expect(shown("e-wang-2026-11-02")).toBe(0);
    expect(screen.queryByText("對應排班(系統代碼)")).toBeNull();
    expect(
      screen.queryByText("對應的排班已被刪除,不能核准;請退回讓申請人重選"),
    ).toBeNull();
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
