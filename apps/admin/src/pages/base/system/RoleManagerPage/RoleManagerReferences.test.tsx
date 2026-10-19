import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { ALL_PERMISSIONS, renderRolePage } from "./role-manager-test-support";

/** 每種引用處各一筆(含一筆認不得的種類,不該顯示)。 */
const REFERENCES = [
  { kind: "notification-setting", name: "列印代理程式離線" },
  {
    kind: "workflow-approver",
    name: "請購單",
    stepName: "財務審核",
    source: "draft",
  },
  {
    kind: "workflow-step-cc",
    name: "請假單",
    stepName: "主管審核",
    source: "current",
  },
  {
    kind: "workflow-overdue",
    name: "採購單",
    stepName: "主管審核",
    source: "in-use",
    inUseCount: 3,
  },
  { kind: "workflow-cc", name: "出差單", source: "current" },
  { kind: "data-scope", name: "示範資料" },
  { kind: "unknown-kind", name: "認不得的種類" },
];

/** 打開「審核員」的刪除確認並送出,等到被擋下的提示出現。 */
const openBlockedDelete = async (
  actor: ReturnType<typeof renderRolePage>["user"],
) => {
  await screen.findByText("內容編輯");
  await actor.click(screen.getByText("審核員"));
  await actor.click(screen.getByRole("button", { name: "刪除" }));
  const dialog = await screen.findByRole("dialog");
  await actor.click(within(dialog).getByRole("button", { name: "刪除" }));
  await screen.findByText(/下列設定的人員條件還用到這個角色/);
  return dialog;
};

describe("角色管理:刪除被人員條件引用時的提示", () => {
  it("被人員條件引用:每個引用處說明為什麼與怎麼處置(四種情況)", async () => {
    const { user: actor } = renderRolePage({
      world: {
        failures: {
          DeleteRole: {
            code: "ROLE_NOT_DELETABLE",
            reasons: ["HAS_GRANTS", "REFERENCED_BY_AUDIENCE"],
            references: REFERENCES,
          },
        },
      },
    });

    const dialog = await openBlockedDelete(actor);
    const text = (pattern: string) =>
      within(dialog).getByText(
        (_content, element) =>
          element?.tagName === "LI" && element.textContent === pattern,
      );

    expect(
      within(dialog).getByText("還有使用者持有這個角色,請先把他們移除。"),
    ).toBeInTheDocument();
    // 通知設定 → 改收件人
    expect(
      text(
        "通知設定「列印代理程式離線」的收件人用了這個角色 → 到通知設定把收件人改成其他角色。",
      ),
    ).toBeInTheDocument();
    // 流程草稿 / 目前版本 → 修改並發布
    expect(
      text(
        "「請購單」流程的草稿裡,「財務審核」關卡的審核者用了這個角色 → 到流程管理修改這一關並發布。",
      ),
    ).toBeInTheDocument();
    expect(
      text(
        "「請假單」流程目前版本裡,「主管審核」關卡的知會對象用了這個角色 → 到流程管理修改這一關並發布。",
      ),
    ).toBeInTheDocument();
    expect(
      text(
        "「出差單」流程目前版本裡,整個流程的知會對象用了這個角色 → 到流程管理修改並發布。",
      ),
    ).toBeInTheDocument();
    // 進行中單據 → 等完成或撤回 / 作廢
    expect(
      text(
        "「採購單」流程有 3 張進行中的單據使用的版本裡,「主管審核」關卡逾時提醒的通知對象用了這個角色 → 等這些單據完成,或撤回 / 作廢後再刪除。",
      ),
    ).toBeInTheDocument();
    // 資料範圍 → 聯絡系統管理員
    expect(
      text(
        "資料範圍「示範資料」由系統管理員設定,它的套用對象用了這個角色 → 請聯絡系統管理員修改。",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/認不得的種類/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/不能刪除時可以改用「停用」/),
    ).toBeInTheDocument();
    // 沒有通知設定 / 流程管理的編輯權限 → 只說去哪,不做成連結
    expect(within(dialog).queryAllByRole("link")).toHaveLength(0);
  });

  it("有通知設定 / 流程管理的編輯權限:處置做成連結,點了切到那一頁", async () => {
    const { user: actor } = renderRolePage({
      permissions: [
        ...ALL_PERMISSIONS,
        "system.notification-settings.view",
        "system.notification-settings.edit",
        "system.workflows.view",
        "system.workflows.edit",
      ],
      world: {
        failures: {
          DeleteRole: {
            code: "ROLE_NOT_DELETABLE",
            reasons: ["REFERENCED_BY_AUDIENCE"],
            references: REFERENCES,
          },
        },
      },
    });

    const dialog = await openBlockedDelete(actor);
    const notificationLinks = within(dialog).getAllByRole("link", {
      name: "通知設定",
    });
    expect(notificationLinks).toHaveLength(1);
    expect(notificationLinks[0]).toHaveAttribute(
      "href",
      "/system/notification-settings",
    );
    const workflowLinks = within(dialog).getAllByRole("link", {
      name: "流程管理",
    });
    // 草稿、目前版本、整個流程的知會各一個;進行中單據沒有連結
    expect(workflowLinks).toHaveLength(3);
    expect(workflowLinks[0]).toHaveAttribute("href", "/system/workflows");
  });
});
