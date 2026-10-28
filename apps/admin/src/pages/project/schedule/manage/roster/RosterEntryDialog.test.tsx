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
  timeField,
  timeValue,
  typeTimeIn,
} from "./roster-test-queries";

setupFakeViewport();

const ROSTER = "/schedule/manage?tab=roster&month=2026-11";
const WEEK = `${ROSTER}&view=week&date=2026-11-04`;
const CLOSED = "這段時間有店休,不能排班";
const DEMAND_CLOSED = "這段時間有店休,不能建人力需求";
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

/** 疊開 [新增一筆人力需求]:09:00–13:00、店外攤位、只有一位負責人(人力需求對話框裡才填時間)。 */
const addLeaderOnlyDemand = async (user: User, dialog: HTMLElement) => {
  await user.click(
    within(dialog).getByRole("button", { name: "新增一筆人力需求" }),
  );
  const demandDialog = await findDialog("新增人力需求");
  await typeTimeIn(user, demandDialog, /開始/, "09:00");
  await typeTimeIn(user, demandDialog, /結束/, "13:00");
  await user.click(
    within(demandDialog).getByRole("combobox", { name: /崗位/ }),
  );
  await user.click(await findOption("店外攤位"));
  await user.click(
    within(demandDialog).getByRole("button", { name: "+ 負責人" }),
  );
  await user.click(within(demandDialog).getByRole("button", { name: "新增" }));
  await waitFor(() => {
    expect(queryDialog("新增人力需求")).not.toBeInTheDocument();
  });
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
    await addLeaderOnlyDemand(user, dialog);

    // 和從缺額打開一樣:時間、休息(依規則)、負責任務都帶好
    expect(timeValue(dialog, /上班/)).toBe("09:00");
    expect(timeValue(dialog, /下班/)).toBe("13:00");
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

  it("同一個人、同一筆只有負責人的人力需求:疊開帶回、點缺額打開、手動選,畫面狀態相同(保留負責任務、組下寫原因、[儲存] 停用)", async () => {
    const { user } = renderRoster(`${ROSTER}&view=week&date=2026-11-10`);
    const stateOf = (dialog: HTMLElement) => ({
      demand: within(dialog).getByRole("combobox", { name: "人力需求" })
        .textContent,
      task: taskSelect(dialog).textContent,
      start: timeValue(dialog, /上班/),
      end: timeValue(dialog, /下班/),
      breakMinutes: within(dialog).getByLabelText(/休息/).getAttribute("value"),
      reason: within(dialog)
        .getByRole("group", { name: "加入的人力需求" })
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent)
        .join(""),
      isSaveDisabled: saveButton(dialog).hasAttribute("disabled"),
    });

    // 疊開:先選林美麗(不能擔任負責人),回來後那一列照樣填上負責任務
    const stacked = await openFromToolbar(
      user,
      "2026-11-10",
      "新增排班 · 11/10(二)",
    );
    await pickPerson(user, stacked, "林美麗");
    await addLeaderOnlyDemand(user, stacked);
    const fromStacked = stateOf(stacked);
    expect(fromStacked).toEqual(
      expect.objectContaining({
        task: "負責 · 店內事務與帳目負責",
        reason: CANNOT_LEAD,
        isSaveDisabled: true,
      }),
    );
    await user.click(within(stacked).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(queryDialog(/^新增排班/)).not.toBeInTheDocument();
    });

    // 缺額:點剛建的那一筆的缺負責,選同一個人
    const timeline = await screen.findByRole("group", { name: "週檢視" });
    const vacancies = await within(timeline).findAllByRole("button", {
      name: /缺負責 1$/,
    });
    const vacancy = vacancies.at(0);
    if (vacancy === undefined) {
      throw new Error("找不到缺額");
    }
    await user.click(vacancy);
    const fromVacancyDialog = await findDialog("新增排班 · 11/10(二)");
    await pickPerson(user, fromVacancyDialog, "林美麗");
    expect(stateOf(fromVacancyDialog)).toEqual(fromStacked);
    await user.click(
      within(fromVacancyDialog).getByRole("button", { name: "取消" }),
    );
    await waitFor(() => {
      expect(queryDialog(/^新增排班/)).not.toBeInTheDocument();
    });

    // 手動:工具列選同一天、同一個人、同樣的時間,[+ 加入人力需求] 選剛建的那一筆
    const manual = await openFromToolbar(
      user,
      "2026-11-10",
      "新增排班 · 11/10(二)",
    );
    await pickPerson(user, manual, "林美麗");
    await typeTimeIn(user, manual, /上班/, "09:00");
    await typeTimeIn(user, manual, /下班/, "13:00");
    await user.click(
      within(manual).getByRole("button", { name: "+ 加入人力需求" }),
    );
    await user.click(
      within(manual).getByRole("combobox", { name: "人力需求" }),
    );
    await user.click(
      await screen.findByRole("option", { name: /09:00–13:00/ }),
    );
    expect(stateOf(manual)).toEqual(fromStacked);
  });

  it("缺額 → 選不能擔任負責人的人:人力需求下寫原因、[儲存] 停用;下拉裡負責選項反灰並寫原因", async () => {
    const { user, rosterFake } = renderRoster(WEEK);
    const dialog = await openVacancy(user);
    expect(timeValue(dialog, /上班/)).toBe("08:30");
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
    // 選中的那一項不另寫次文字(原因已在這一組下方);沒選中時的次文字見「班表空白格」那條
    expect(leader).not.toHaveTextContent(CANNOT_LEAD);
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
    expect(timeField(dialog, /上班/)).toHaveAccessibleDescription(DAY_OFF);
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

  it("店休:工具列選店休那天 → 上班欄下寫原因、[儲存] 與 [新增一筆人力需求] 停用(店休日不能建人力需求)", async () => {
    const { user } = renderRoster(ROSTER);
    const dialog = await openFromToolbar(
      user,
      "2026-11-03",
      "新增排班 · 11/3(二)",
    );
    expect(timeField(dialog, /上班/)).toHaveAccessibleDescription(CLOSED);
    expect(saveButton(dialog)).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "新增一筆人力需求" }),
    ).toBeDisabled();
  });

  it("人力需求對話框:日期選店休那天、或跨午夜做進隔天店休 → 開始時間欄下寫原因、[新增] 停用;結束剛好 00:00 不算隔天", async () => {
    const { user } = renderRoster(ROSTER);
    await user.click(await findButton("+ 人力需求"));
    const dialog = await findDialog("新增人力需求");
    const createButton = () =>
      within(dialog).getByRole("button", { name: "新增" });
    await user.click(within(dialog).getByRole("group", { name: /日期/ }));
    await user.keyboard("20261103");
    await waitFor(() => {
      expect(timeField(dialog, /開始/)).toHaveAccessibleDescription(
        DEMAND_CLOSED,
      );
    });
    expect(createButton()).toBeDisabled();

    // 11/2 22:00–02:00 做進 11/3 店休
    await user.click(within(dialog).getByRole("group", { name: /日期/ }));
    await user.keyboard("20261102");
    await typeTimeIn(user, dialog, /開始/, "22:00");
    await typeTimeIn(user, dialog, /結束/, "02:00");
    expect(timeField(dialog, /開始/)).toHaveAccessibleDescription(
      DEMAND_CLOSED,
    );
    expect(createButton()).toBeDisabled();

    // 做到 11/3 00:00 剛好結束:不碰店休
    await typeTimeIn(user, dialog, /結束/, "00:00");
    expect(timeField(dialog, /開始/)).not.toHaveAccessibleDescription(
      DEMAND_CLOSED,
    );
    expect(createButton()).toBeEnabled();
  });

  it("人力需求對話框:api 回店休(STORE_CLOSED,前端還不知道那天店休)→ 開始時間欄下寫「不能建人力需求」那句", async () => {
    renderSchedulePage({
      path: ROSTER,
      roster: { closedDemandDates: ["2026-11-06"] },
    });
    const user = fastUser();
    await user.click(await findButton("+ 人力需求"));
    const dialog = await findDialog("新增人力需求");
    await user.click(within(dialog).getByRole("group", { name: /日期/ }));
    await user.keyboard("20261106");
    await typeTimeIn(user, dialog, /開始/, "09:00");
    await typeTimeIn(user, dialog, /結束/, "13:00");
    await user.click(within(dialog).getByRole("combobox", { name: /崗位/ }));
    await user.click(await findOption("店外攤位"));
    await user.click(within(dialog).getByRole("button", { name: "新增" }));
    await waitFor(() => {
      expect(timeField(dialog, /開始/)).toHaveAccessibleDescription(
        DEMAND_CLOSED,
      );
    });
  });

  it("日期欄的店休日反灰(排班對話框與人力需求對話框同一套;店休日不能建人力需求)", async () => {
    const { user } = renderRoster(ROSTER);
    /** 打開對話框裡日期欄的月曆,回 11/3(店休)與 11/4 兩格 */
    const daysIn = async (dialog: HTMLElement) => {
      const date = within(dialog).getByRole("group", { name: /日期/ });
      await user.click(
        within(date.parentElement ?? dialog).getByRole("button", {
          name: /choose date/i,
        }),
      );
      return {
        closed: await screen.findByRole("gridcell", { name: "3" }),
        open: screen.getByRole("gridcell", { name: "4" }),
      };
    };

    // 先填 11/4,月曆才會開在 11 月
    const entryDialog = await openFromToolbar(
      user,
      "2026-11-04",
      "新增排班 · 11/4(三)",
    );
    const entryDays = await daysIn(entryDialog);
    expect(entryDays.closed).toBeDisabled();
    expect(entryDays.open).toBeEnabled();
    await user.keyboard("{Escape}");
    await user.click(within(entryDialog).getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(queryDialog(/^新增排班/)).not.toBeInTheDocument();
    });

    await user.click(await findButton("+ 人力需求"));
    const demandDialog = await findDialog("新增人力需求");
    await user.click(within(demandDialog).getByRole("group", { name: /日期/ }));
    await user.keyboard("20261104");
    const demandDays = await daysIn(demandDialog);
    expect(demandDays.closed).toBeDisabled();
    expect(demandDays.open).toBeEnabled();
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
