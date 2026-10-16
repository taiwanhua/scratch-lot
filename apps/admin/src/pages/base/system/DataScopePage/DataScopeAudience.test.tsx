import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { checkboxOf } from "@/components/base/OrgTreeSelect/org-tree-select-test-support";

import {
  audienceRegion,
  autocompleteGroupLabels,
  chooseOption,
  conditionsRegion,
  pickAutocomplete,
  renderPage,
  waitForEditor,
} from "./data-scope-test-support";

type Actor = ReturnType<typeof renderPage>["user"];

/** 加一條新規則,把套用對象切到「符合條件」(新規則預設「所有人」)。 */
const startMatchRule = async (actor: Actor) => {
  await waitForEditor("示範模組1(demo_items_one)");
  await actor.click(screen.getByRole("button", { name: "+ 新增規則" }));
  await actor.click(
    within(audienceRegion()).getByRole("radio", { name: "符合條件" }),
  );
};

/** 套用對象區塊裡依浮動標籤取第 n 個下拉。 */
const audienceCombobox = (label: string, index = 0): HTMLElement => {
  const found = within(audienceRegion()).getAllByRole("combobox", {
    name: label,
  });
  expect(found.length).toBeGreaterThan(index);
  return found[index];
};

/** 把第 n 列的欄位換成角色並挑一個角色(主文字開頭比對)。 */
const pickRole = async (actor: Actor, role: string, index = 0) => {
  await chooseOption(actor, audienceCombobox("欄位", index), "角色");
  await pickAutocomplete(actor, audienceCombobox("值", index), role);
  await actor.keyboard("{Escape}");
};

describe("套用對象(AudiencePicker)", () => {
  it("新規則預設「所有人」:條件樹收起;切到「符合條件」才出現,根層下拉叫「組合」", async () => {
    const { user: actor } = renderPage();
    await waitForEditor("示範模組1(demo_items_one)");
    await actor.click(screen.getByRole("button", { name: "+ 新增規則" }));

    expect(
      within(audienceRegion()).getByRole("radio", { name: "所有人" }),
    ).toBeChecked();
    expect(
      within(audienceRegion()).queryByRole("combobox", { name: "組合" }),
    ).not.toBeInTheDocument();

    await actor.click(
      within(audienceRegion()).getByRole("radio", { name: "符合條件" }),
    );
    expect(audienceCombobox("組合")).toHaveTextContent("AND — 全部成立才放行");
  });

  it("選「所有人」時條件樹收起;切回「符合條件」保留先前內容", async () => {
    const { user: actor } = renderPage();
    await startMatchRule(actor);
    await pickRole(actor, "客服");
    expect(within(audienceRegion()).getByText("客服")).toBeInTheDocument();

    await actor.click(
      within(audienceRegion()).getByRole("radio", { name: "所有人" }),
    );
    expect(
      within(audienceRegion()).queryByRole("combobox", { name: "欄位" }),
    ).not.toBeInTheDocument();

    await actor.click(
      within(audienceRegion()).getByRole("radio", { name: "符合條件" }),
    );
    expect(audienceCombobox("欄位")).toHaveTextContent("角色");
    expect(within(audienceRegion()).getByText("客服")).toBeInTheDocument();
  });

  it("角色依擁有組織分組,每個組織的標題只出現一次(#372)", async () => {
    const { user: actor } = renderPage();
    await startMatchRule(actor);
    await chooseOption(actor, audienceCombobox("欄位"), "角色");
    await actor.click(audienceCombobox("值"));

    expect(autocompleteGroupLabels()).toEqual([
      "租戶 A",
      "租戶 A 業務部",
      "租戶 B",
    ]);
  });

  it("巢狀最多三層:第三層的群組沒有 [+ 群組]", async () => {
    const { user: actor } = renderPage();
    await startMatchRule(actor);

    await actor.click(
      within(audienceRegion()).getByRole("button", { name: "+ 群組" }),
    );
    // 子群組的動作列在 DOM 上排在根群組的前面
    await actor.click(
      within(audienceRegion()).getAllByRole("button", { name: "+ 群組" })[0],
    );

    expect(
      within(audienceRegion()).getAllByRole("combobox", { name: "群組組合" }),
    ).toHaveLength(2);
    expect(
      within(audienceRegion()).getAllByRole("button", { name: "+ 群組" }),
    ).toHaveLength(2);
    expect(
      within(audienceRegion()).getAllByRole("button", { name: "+ 條件" }),
    ).toHaveLength(3);
  });

  it("空群組無法儲存:刪光條件列後按儲存,錯誤標在群組上、不送出", async () => {
    const { user: actor, fake } = renderPage();
    await startMatchRule(actor);
    await actor.click(
      within(audienceRegion()).getByRole("button", { name: "刪除" }),
    );

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    expect(
      await within(audienceRegion()).findByText("群組至少要有一個條件。"),
    ).toBeInTheDocument();
    expect(fake.inputs.saveDataScopeRule).toHaveLength(0);
  });

  it("伺服器回 AUDIENCE_INVALID + path:錯誤標在 path 指到的那一列", async () => {
    const { user: actor, fake } = renderPage({
      world: {
        failures: {
          SaveDataScopeRule: {
            code: "RULE_INVALID",
            extensions: {
              path: "rules[0].audience.filter.children[1].value.values[0]",
              reason: "AUDIENCE_INVALID",
            },
          },
        },
      },
    });
    await startMatchRule(actor);
    await pickRole(actor, "客服");
    await actor.click(
      within(audienceRegion()).getByRole("button", { name: "+ 條件" }),
    );
    await pickRole(actor, "編輯", 1);
    // 條件組合那一半也填好,本地驗證才會放行
    await chooseOption(
      actor,
      within(conditionsRegion()).getByRole("combobox", { name: "值" }),
      "草稿",
    );
    await actor.keyboard("{Escape}");

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    const message = "請把套用對象的條件填完整(每一列都要選值)。";
    expect(
      await within(audienceRegion()).findByText(message),
    ).toBeInTheDocument();
    expect(within(audienceRegion()).getAllByText(message)).toHaveLength(1);
    expect(audienceCombobox("值", 1)).toHaveAttribute("aria-invalid", "true");
    expect(audienceCombobox("值", 0)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("角色 + 所屬組織(含下層)+ 權限:送出的人員條件與正本形狀一致", async () => {
    const { user: actor, fake } = renderPage();
    await startMatchRule(actor);
    await pickRole(actor, "客服");

    // 所屬組織:組織樹多選 + 範圍
    await actor.click(
      within(audienceRegion()).getByRole("button", { name: "+ 條件" }),
    );
    await chooseOption(actor, audienceCombobox("欄位", 1), "所屬組織");
    await actor.click(audienceCombobox("值", 1));
    await screen.findByRole("tree", { name: "值" });
    fireEvent.click(checkboxOf("A-2 台北分店"));
    await actor.keyboard("{Escape}");
    await chooseOption(actor, audienceCombobox("範圍"), "含下層");

    // 權限:可搜尋的模組 / 權限樹,只有權限列可勾
    await actor.click(
      within(audienceRegion()).getByRole("button", { name: "+ 條件" }),
    );
    await chooseOption(actor, audienceCombobox("欄位", 2), "權限");
    expect(audienceCombobox("條件", 2)).toHaveTextContent("持有");
    await actor.click(audienceCombobox("值", 2));
    await actor.type(
      await screen.findByRole("textbox", { name: "搜尋權限" }),
      "編輯",
    );
    fireEvent.click(checkboxOf("編輯"));
    await actor.keyboard("{Escape}");
    expect(
      within(audienceRegion()).getByText("示範模組1 · 編輯"),
    ).toBeInTheDocument();

    await chooseOption(
      actor,
      within(conditionsRegion()).getByRole("combobox", { name: "值" }),
      "草稿",
    );
    await actor.keyboard("{Escape}");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    expect(fake.inputs.saveDataScopeRule[0]?.rules[0]?.audience).toEqual({
      mode: "match",
      filter: {
        op: "AND",
        children: [
          {
            field: "role",
            cond: "in",
            value: { kind: "static", values: ["role-support"] },
          },
          {
            field: "org",
            cond: "in",
            value: { kind: "static", values: ["org-store"] },
            range: "descendants",
          },
          {
            field: "permission",
            cond: "in",
            value: { kind: "static", values: ["demo.sub.sample-one.edit"] },
          },
        ],
      },
    });
  });
});
