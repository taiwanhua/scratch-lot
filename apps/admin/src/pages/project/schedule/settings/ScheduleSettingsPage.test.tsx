import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { renderSchedulePage } from "../schedule-test-support";

const SETTINGS = "/schedule/settings";

/**
 * 排班設定(SC-08 / SC-09a / SC-09b / SC-10;規格 14.2–14.4):走正式的頁面登記、路由與殼,只有 api 是假的。
 * 能不能改的旗標由 api 算好(夾具依權限給),頁面只讀;沒有對應權限時看不到按鈕。
 */
describe("排班設定", () => {
  it("四個分頁:排班人員、人力需求範本、人力需求週範本、規則", async () => {
    renderSchedulePage({ path: SETTINGS });
    const tablist = await screen.findByRole("tablist", { name: "排班設定" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "排班人員",
      "人力需求範本",
      "人力需求週範本",
      "規則",
    ]);
  });

  describe("排班人員", () => {
    it("只有未加入的人可以勾選;勾選後 [加入排班(N)] 送出那些人", async () => {
      const { user, settingsFake } = renderSchedulePage({ path: SETTINGS });
      const wang = await screen.findByRole("checkbox", {
        name: "選取「王小明」",
      });
      expect(wang).toBeDisabled();
      const add = screen.getByRole("button", { name: "加入排班(0)" });
      expect(add).toBeDisabled();

      await user.click(
        screen.getByRole("checkbox", { name: "選取「林新人」" }),
      );
      await user.click(
        await screen.findByRole("button", { name: "加入排班(1)" }),
      );
      await waitFor(() => {
        expect(settingsFake.inputs.addStaff).toEqual([{ userIds: ["u-lin"] }]);
      });
      expect(await screen.findByText("已加入排班")).toBeInTheDocument();
    });

    it("已被看不到的組織加入的人:標「已在其他組織加入」,勾選框停用", async () => {
      renderSchedulePage({ path: SETTINGS });
      expect(
        await screen.findByRole("checkbox", { name: "選取「陳支援」" }),
      ).toBeDisabled();
      expect(screen.getByText("已在其他組織加入")).toBeInTheDocument();
    });

    it("共用進來的別店人員:標「其他店的排班人員(只能看)」;點開唯讀,沒有 [儲存]", async () => {
      const { user } = renderSchedulePage({ path: SETTINGS });
      expect(
        await screen.findByRole("checkbox", { name: "選取「吳外店」" }),
      ).toBeDisabled();
      expect(screen.getByText("其他店的排班人員(只能看)")).toBeInTheDocument();
      await user.click(screen.getByText("吳外店"));
      const dialog = await screen.findByRole("dialog", {
        name: "排班人員設定 · 吳外店",
      });
      expect(
        within(dialog).queryByRole("button", { name: "儲存" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "關閉" }),
      ).toBeEnabled();
    });

    it("篩選「未加入」不列出已在其他組織加入的人;「已加入」才列出", async () => {
      renderSchedulePage({ path: `${SETTINGS}?joined=no` });
      expect(
        await screen.findByRole("checkbox", { name: "選取「林新人」" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("陳支援")).not.toBeInTheDocument();
    });

    it("篩選「已加入」列出已在其他組織加入的人", async () => {
      renderSchedulePage({ path: `${SETTINGS}?joined=yes` });
      expect(await screen.findByText("陳支援")).toBeInTheDocument();
      expect(screen.queryByText("林新人")).not.toBeInTheDocument();
    });

    it("沒有 edit-staff:看不到 [加入排班]", async () => {
      renderSchedulePage({
        path: SETTINGS,
        omit: ["schedule.settings.edit-staff"],
        settings: { canEditStaff: false },
      });
      expect(await screen.findByText("林新人")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /加入排班/ }),
      ).not.toBeInTheDocument();
    });

    it("點已加入的人 → 排班人員設定(可擔任負責人、主要分店)", async () => {
      const { user } = renderSchedulePage({ path: SETTINGS });
      await user.click(await screen.findByText("王小明"));
      const dialog = await screen.findByRole("dialog", {
        name: "排班人員設定 · 王小明",
      });
      expect(within(dialog).getByText("A-2 台北分店")).toBeInTheDocument();
      expect(within(dialog).getAllByLabelText("主要分店")[0]).toBeChecked();
    });
  });

  describe("人力需求範本", () => {
    it("上層建立的範本列表看得到「建立於」;點開唯讀", async () => {
      const { user } = renderSchedulePage({
        path: `${SETTINGS}?tab=templates`,
      });
      expect(await screen.findByText("早班")).toBeInTheDocument();
      expect(screen.getAllByText("租戶 A").length).toBeGreaterThan(0);
      await user.click(screen.getByText("早班"));
      const dialog = await screen.findByRole("dialog", {
        name: "人力需求範本 · 早班",
      });
      expect(
        within(dialog).getByText(
          "這是「租戶 A」建立的範本,只有建立的那一層能改。",
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "儲存" }),
      ).not.toBeInTheDocument();
    });

    it("有 edit-templates 看得到 [+ 新增人力需求範本];沒有就看不到", async () => {
      const first = renderSchedulePage({ path: `${SETTINGS}?tab=templates` });
      expect(
        await screen.findByRole("button", { name: "+ 新增人力需求範本" }),
      ).toBeInTheDocument();
      first.unmount();

      renderSchedulePage({
        path: `${SETTINGS}?tab=templates`,
        omit: ["schedule.settings.edit-templates"],
        settings: { canEditTemplates: false },
      });
      expect(await screen.findByText("早班")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "+ 新增人力需求範本" }),
      ).not.toBeInTheDocument();
    });

    it("新增負責人一列帶入規則的負責人預設任務;負責人滿 1 筆後 [+ 負責人] 停用", async () => {
      const { user } = renderSchedulePage({
        path: `${SETTINGS}?tab=templates`,
      });
      await user.click(
        await screen.findByRole("button", { name: "+ 新增人力需求範本" }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "新增人力需求範本",
      });
      await user.click(
        within(dialog).getByRole("button", { name: "+ 負責人" }),
      );
      expect(
        await within(dialog).findByText("店內事務與帳目負責"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "+ 負責人" }),
      ).toBeDisabled();
    });
  });

  describe("人力需求週範本", () => {
    it("格子寫範本簡稱;沒有 edit-templates 看不到新增", async () => {
      renderSchedulePage({
        path: `${SETTINGS}?tab=week-templates`,
        omit: ["schedule.settings.edit-templates"],
        settings: { canEditTemplates: false },
      });
      expect(await screen.findByText("平日標準週")).toBeInTheDocument();
      expect(screen.getAllByText("早、晚、補")).toHaveLength(2);
      expect(
        screen.queryByRole("button", { name: "+ 新增人力需求週範本" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("規則", () => {
    it("一條規則一列、依規格表順序;沿用 / 本店自訂 / 上層值", async () => {
      renderSchedulePage({ path: `${SETTINGS}?tab=rules` });
      const first = await screen.findByText("每月最多畫休");
      const row = first.closest("[data-rule-key]");
      if (!(row instanceof HTMLElement)) {
        throw new TypeError("找不到規則列");
      }
      expect(within(row).getByText("沿用:租戶 A")).toBeInTheDocument();
      expect(within(row).getByText("8 天")).toBeInTheDocument();

      const own = screen.getByText("最多連續上班").closest("[data-rule-key]");
      if (!(own instanceof HTMLElement)) {
        throw new TypeError("找不到規則列");
      }
      expect(within(own).getByText("本店自訂")).toBeInTheDocument();
      expect(within(own).getByText("上層:6 天")).toBeInTheDocument();
      expect(within(own).getByRole("button", { name: "還原" })).toBeVisible();

      const keys = [
        ...document.querySelectorAll<HTMLElement>("[data-rule-key]"),
      ].map((element) => element.dataset.ruleKey);
      expect(keys.slice(0, 3)).toEqual([
        "maxMonthlyDayOffs",
        "minMonthlyDayOffs",
        "maxConsecutiveWorkDays",
      ]);
      expect(keys.at(-1)).toBe("defaultTasks");
      expect(
        screen.getByText(/1\. 延續同一人的排班 · 2\. 負責人次數多者優先/),
      ).toBeInTheDocument();
    });

    it("[還原] 送出本層那一條;[自訂] 打開規則編輯對話框", async () => {
      const { user, settingsFake } = renderSchedulePage({
        path: `${SETTINGS}?tab=rules`,
      });
      const ownLabel = await screen.findByText("最多連續上班");
      const own = ownLabel.closest("[data-rule-key]");
      if (!(own instanceof HTMLElement)) {
        throw new TypeError("找不到規則列");
      }
      await user.click(within(own).getByRole("button", { name: "還原" }));
      await waitFor(() => {
        expect(settingsFake.inputs.restore).toEqual([
          { orgId: "org-store", key: "maxConsecutiveWorkDays" },
        ]);
      });

      const dayOffs = screen
        .getByText("每月最多畫休")
        .closest("[data-rule-key]");
      if (!(dayOffs instanceof HTMLElement)) {
        throw new TypeError("找不到規則列");
      }
      await user.click(within(dayOffs).getByRole("button", { name: "自訂" }));
      const dialog = await screen.findByRole("dialog", {
        name: "規則 · 每月最多畫休",
      });
      await user.clear(within(dialog).getByLabelText("值(天)"));
      await user.type(within(dialog).getByLabelText("值(天)"), "6");
      await user.click(within(dialog).getByRole("button", { name: "儲存" }));
      await waitFor(() => {
        expect(settingsFake.inputs.customize).toEqual([
          expect.objectContaining({
            orgId: "org-store",
            key: "maxMonthlyDayOffs",
            value: { amount: 6 },
            level: "limit",
          }),
        ]);
      });
    });

    it("沒有改規則的權限:看不到 [自訂] [還原]", async () => {
      renderSchedulePage({
        path: `${SETTINGS}?tab=rules`,
        omit: [
          "schedule.settings.edit-default-rules",
          "schedule.settings.edit-org-rules",
        ],
        settings: { canEditRules: false },
      });
      expect(await screen.findByText("每月最多畫休")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "自訂" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "還原" }),
      ).not.toBeInTheDocument();
    });
  });
});
