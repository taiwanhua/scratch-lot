import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../schedule-test-support";
import {
  fastUser,
  findButton,
  findDialog,
  findLabelled,
  findOption,
  queryDialog,
} from "./roster-test-queries";

setupFakeViewport();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";
const WEEK = `${ROSTER}&view=week&date=2026-11-04`;
const CLOSED = "這段時間有店休,不能排班";
const DAY_OFF = "和這個人的畫休重疊";
const CANNOT_LEAD = "這個人不能擔任負責人";

const renderRoster = (path: string) => ({
  ...renderSchedulePage({ path }),
  user: fastUser(),
});

type User = ReturnType<typeof fastUser>;

const pickPerson = async (user: User, dialog: HTMLElement, name: string) => {
  await user.click(within(dialog).getByRole("combobox", { name: /人員/ }));
  await user.click(await findOption(name));
};

/** 工具列 [+ 新增排班]:對話框裡自己選日期(日期欄逐位輸入 `YYYYMMDD`)。 */
const openFromToolbar = async (user: User, date: string, title: string) => {
  await user.click(await findButton("+ 新增排班"));
  const dialog = await findDialog(/^新增排班/);
  await user.click(within(dialog).getByRole("group", { name: /日期/ }));
  await user.keyboard(date.replaceAll("-", ""));
  await findDialog(title);
  return dialog;
};

/** 週檢視點「早班 缺負責 1」(11/5):帶好那筆人力需求的時間與負責任務。 */
const openVacancy = async (user: User) => {
  const timeline = await screen.findByRole("group", { name: "週檢視" });
  await user.click(
    await within(timeline).findByRole("button", { name: "早班 缺負責 1" }),
  );
  return findDialog("新增排班 · 11/5(四)");
};

const taskSelect = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: "職責 · 執行任務" });

const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "儲存" });

/**
 * 排班對話框各入口同一套規則(規格 14.5):工具列、班表空白格、缺額、疊開新增人力需求帶回的結果一致;
 * 店休、畫休、不能擔任負責人送出前就寫在欄位下(REACT-18)、[儲存] 停用,停用的選項寫原因。
 */
describe("排班對話框:各入口一致", () => {
  it("工具列 → 沒選人、沒填時間就疊開新增人力需求(只有負責人)→ 帶回時間與負責任務,選人後可以存", async () => {
    const { user, rosterFake } = renderRoster(ROSTER);
    const dialog = await openFromToolbar(
      user,
      "2026-11-10",
      "新增排班 · 11/10(二)",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "新增一筆人力需求" }),
    );
    const demandDialog = await findDialog("新增人力需求");
    await user.type(within(demandDialog).getByLabelText(/開始/), "09:00");
    await user.type(within(demandDialog).getByLabelText(/結束/), "13:00");
    await user.click(
      within(demandDialog).getByRole("combobox", { name: /崗位/ }),
    );
    await user.click(await findOption("店外攤位"));
    await user.click(
      within(demandDialog).getByRole("button", { name: "+ 負責人" }),
    );
    await user.click(
      within(demandDialog).getByRole("button", { name: "新增" }),
    );
    await waitFor(() => {
      expect(queryDialog("新增人力需求")).not.toBeInTheDocument();
    });

    // 和從缺額打開一樣:時間、休息(依規則)、負責任務都帶好
    expect(within(dialog).getByLabelText(/上班/)).toHaveValue("09:00");
    expect(within(dialog).getByLabelText(/下班/)).toHaveValue("13:00");
    expect(within(dialog).getByLabelText(/休息/)).toHaveValue(30);
    expect(taskSelect(dialog)).toHaveTextContent("負責 · 店內事務與帳目負責");
    // 還沒選人:[儲存] 停用(人員必填)
    expect(saveButton(dialog)).toBeDisabled();

    await pickPerson(user, dialog, "王小明");
    expect(saveButton(dialog)).toBeEnabled();
    await user.click(saveButton(dialog));
    await waitFor(() => {
      expect(rosterFake.inputs.entries).toEqual([
        expect.objectContaining({
          userId: "u-wang",
          breakMinutes: 30,
          assignments: [
            expect.objectContaining({ demandId: expect.any(String) }),
          ],
        }),
      ]);
    });
  });

  it("缺額 → 選不能擔任負責人的人:人力需求下寫原因、[儲存] 停用;下拉裡負責選項反灰並寫原因", async () => {
    const { user, rosterFake } = renderRoster(WEEK);
    const dialog = await openVacancy(user);
    expect(within(dialog).getByLabelText(/上班/)).toHaveValue("08:30");
    expect(within(dialog).getByLabelText(/休息/)).toHaveValue(30);

    await pickPerson(user, dialog, "林美麗");
    const group = within(dialog).getByRole("group", { name: "加入的人力需求" });
    expect(group).toHaveAccessibleDescription(CANNOT_LEAD);
    expect(saveButton(dialog)).toBeDisabled();

    await user.click(taskSelect(dialog));
    const options = await screen.findAllByRole("option");
    const leader = options.find((option) =>
      option.textContent.startsWith("負責 · 店內事務與帳目負責"),
    );
    expect(leader).toHaveAttribute("aria-disabled", "true");
    expect(leader).toHaveTextContent(CANNOT_LEAD);
    // 改成協同 → 原因消失、可以存
    const helper = options.find((option) =>
      option.textContent.startsWith("協同"),
    );
    if (helper === undefined) {
      throw new Error("找不到協同選項");
    }
    await user.click(helper);
    expect(group).not.toHaveAccessibleDescription(CANNOT_LEAD);
    expect(saveButton(dialog)).toBeEnabled();
    expect(rosterFake.inputs.entries).toHaveLength(0);
  });

  it("缺額 → 選那天整天畫休的人:上班欄下寫原因、[儲存] 停用", async () => {
    const { user } = renderRoster(WEEK);
    const dialog = await openVacancy(user);
    await pickPerson(user, dialog, "王小明");
    expect(within(dialog).getByLabelText(/上班/)).toHaveAccessibleDescription(
      DAY_OFF,
    );
    expect(saveButton(dialog)).toBeDisabled();
  });

  it("班表空白格 → 不能擔任負責人的人選了有空負責的人力需求:自動填協同,負責選項反灰寫原因", async () => {
    const { user } = renderRoster(ROSTER);
    await user.click(await findLabelled("林美麗 11/6"));
    const dialog = await findDialog("新增排班 · 11/6(五)");
    await user.click(
      within(dialog).getByRole("button", { name: "+ 加入人力需求" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "人力需求" }),
    );
    await user.click(await findOption("晚班 14:30–22:00 · 店內櫃台"));
    expect(taskSelect(dialog)).toHaveTextContent("協同 · 店內事務");
    await user.click(taskSelect(dialog));
    const options = await screen.findAllByRole("option");
    expect(
      options.find((option) => option.textContent.startsWith("負責")),
    ).toHaveTextContent(CANNOT_LEAD);
  });

  it("店休:工具列選店休那天 → 上班欄下寫原因、[儲存] 停用(人力需求照樣可以新增)", async () => {
    const { user } = renderRoster(ROSTER);
    const dialog = await openFromToolbar(
      user,
      "2026-11-03",
      "新增排班 · 11/3(二)",
    );
    expect(within(dialog).getByLabelText(/上班/)).toHaveAccessibleDescription(
      CLOSED,
    );
    expect(saveButton(dialog)).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "新增一筆人力需求" }),
    ).toBeEnabled();
  });

  it("編輯既有的負責人排班:原本就填著的負責任務不擋", async () => {
    const { user } = renderRoster(ROSTER);
    const wang = await findLabelled("王小明 11/1");
    await user.click(within(wang).getByRole("button", { name: /^早/ }));
    const dialog = await findDialog("排班 · 王小明 11/1(日)");
    expect(saveButton(dialog)).toBeEnabled();
    expect(
      within(dialog).getByRole("group", { name: "加入的人力需求" }),
    ).not.toHaveAccessibleDescription(CANNOT_LEAD);
  });
});
