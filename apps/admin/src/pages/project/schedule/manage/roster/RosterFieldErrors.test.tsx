import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { graphqlError } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../schedule-test-support";
import { fastUser, findDialog, findLabelled } from "./roster-test-queries";

setupFakeViewport();

const renderRoster = (options: Parameters<typeof renderSchedulePage>[0]) => ({
  ...renderSchedulePage(options),
  user: fastUser(),
});

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";
const GENERIC = "有欄位不正確,請檢查標示的欄位";

/** GQL-04 的 `VALIDATION_FAILED`(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", extensions);

/** REACT-18:排班表的排班 / 人力需求對話框,欄位錯了原因寫在欄位正下方,上方提示只放通用句。 */
describe("排班作業:欄位下寫原因", () => {
  it("排班:和另一筆排班重疊(api 帶 reason)→ 上班欄下寫原因;任務已被填 → 任務下寫原因", async () => {
    const { user } = renderRoster({ path: ROSTER });
    server.use(
      api.mutation("SaveScheduleEntry", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["startAt"],
          reason: "ENTRY_OVERLAP",
        }),
      ),
    );
    const wang = await findLabelled("王小明 11/1");
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    expect(
      await within(dialog).findByText("和這個人的另一筆排班時間重疊"),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/上班/)).toHaveAccessibleDescription(
      "和這個人的另一筆排班時間重疊",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(GENERIC);

    server.use(
      api.mutation("SaveScheduleEntry", () =>
        businessError({
          code: "VALIDATION_FAILED",
          fields: ["assignments"],
          reason: "TASK_TAKEN",
        }),
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("這個任務已經有人排了"),
    ).toBeInTheDocument();
  });

  it("人力需求:沒填時間、沒選崗位 → 各欄下寫格式要求", async () => {
    const { user } = renderRoster({ path: ROSTER });
    await user.click(await findLabelled("林美麗 11/6"));
    const entryDialog = await findDialog("新增排班 · 11/6(五)");
    await user.click(
      within(entryDialog).getByRole("button", { name: "新增一筆人力需求" }),
    );
    const dialog = await findDialog("新增人力需求");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    expect(within(dialog).getByLabelText(/開始/)).toHaveAccessibleDescription(
      "必填,請填時間(時:分)",
    );
    expect(within(dialog).getByText("必填")).toBeInTheDocument();
  });

  it("已發布:沒選異動原因 → 異動原因下寫「必填,請選擇原因」", async () => {
    const { user } = renderRoster({
      path: ROSTER,
      roster: { isPublished: true },
    });
    const wang = await findLabelled("王小明 11/1");
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("必填,請選擇原因"),
    ).toBeInTheDocument();
    expect(screen.queryByText(GENERIC)).not.toBeInTheDocument();
  });
});
