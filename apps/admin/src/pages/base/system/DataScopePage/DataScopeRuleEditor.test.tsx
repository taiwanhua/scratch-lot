import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { savedRule } from "@/test/msw/data-scope-fixtures";

import {
  autocompleteGroupLabels,
  autocompleteOptions,
  chooseOption,
  comboboxAt,
  editor,
  pickAutocomplete,
  renderPage,
  waitForEditor,
} from "./data-scope-test-support";

/** 每個測試都從「加一條新規則」開始:新規則預設是第一個欄位(狀態,enum)的一條條件列。 */
const startRule = async (actor: {
  click: (element: Element) => Promise<void>;
}) => {
  await waitForEditor("示範模組1(demo_items_one)");
  await actor.click(screen.getByRole("button", { name: "+ 新增規則" }));
};

/** 新規則 → 根群組一條「草稿」→ 第二層「已發布」→ 第三層「草稿」。 */
const buildThreeLevels = async (
  actor: ReturnType<typeof renderPage>["user"],
) => {
  await startRule(actor);
  await chooseOption(actor, comboboxAt("值"), "草稿");
  await actor.keyboard("{Escape}");

  // 第二層
  await actor.click(screen.getAllByRole("button", { name: "+ 群組" })[0]);
  await chooseOption(actor, comboboxAt("值", 1), "已發布");
  await actor.keyboard("{Escape}");
  // 第三層:子群組的「+ 群組」在 DOM 上排在根群組的前面(根的動作列在所有子節點之後)
  await actor.click(screen.getAllByRole("button", { name: "+ 群組" })[0]);
  await chooseOption(actor, comboboxAt("值", 2), "草稿");
  await actor.keyboard("{Escape}");
};

describe("條件樹編輯器(資料範圍)", () => {
  it("目錄驅動:換欄位就換掉運算子清單與值的控制項", async () => {
    const { user: actor } = renderPage();
    await startRule(actor);

    // enum 欄位:運算子是屬於 / 不屬於,值是種子宣告的固定選項
    expect(comboboxAt("欄位")).toHaveTextContent("狀態");
    expect(comboboxAt("條件")).toHaveTextContent("屬於");
    await actor.click(comboboxAt("值"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["草稿", "已發布"]);
    await actor.keyboard("{Escape}");

    // 換成日期欄位:運算子變成之間 / 之前 / 之後,值換成日期輸入(「之間」兩格)
    await chooseOption(actor, comboboxAt("欄位"), "建立時間");
    expect(comboboxAt("條件")).toHaveTextContent("之間");
    // MUI X 的日期欄位把 label 連到多個節點(欄位容器與各個區段),所以用 getAll
    expect(within(editor()).getAllByLabelText("起日").length).toBeGreaterThan(
      0,
    );
    expect(within(editor()).getAllByLabelText("迄日").length).toBeGreaterThan(
      0,
    );

    await chooseOption(actor, comboboxAt("條件"), "之後");
    expect(within(editor()).getAllByLabelText("值").length).toBeGreaterThan(0);
    expect(within(editor()).queryAllByLabelText("迄日")).toHaveLength(0);

    // 換成使用者欄位:值的下拉多了動態值
    await chooseOption(actor, comboboxAt("欄位"), "建立者");
    expect(comboboxAt("條件")).toHaveTextContent("屬於");
    await actor.click(comboboxAt("值"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toContain("【操作者本人】");
  });

  it("套用對象:角色與使用者是 Autocomplete 多選,組織用組織樹", async () => {
    const { user: actor } = renderPage();
    await startRule(actor);

    await chooseOption(actor, comboboxAt("套用對象"), "角色");
    await actor.click(comboboxAt("對象"));
    // 每列主文字角色名、次文字擁有組織(Figma Draft/Autocomplete 253:39);
    // 兩個租戶各有一個同名的「租戶管理員」,靠次文字與分組標題才分得出來(#261 的 8)。
    // 夾具給的順序是亂的,清單先依「擁有組織 → 角色名」排過(#372)
    expect(autocompleteOptions()).toEqual([
      "客服租戶 A",
      "租戶管理員租戶 A",
      "編輯租戶 A",
      "稽核租戶 A 業務部",
      "租戶管理員租戶 B",
    ]);
    // 分組標題是 listbox 的標題、不是可選的選項(換掉 Select 前它是一個 disabled 的 option);
    // 連文字順序一起驗,才看得出每個標題底下掛的是哪幾列
    expect(screen.getByRole("listbox").textContent).toBe(
      [
        "租戶 A客服租戶 A租戶管理員租戶 A編輯租戶 A",
        "租戶 A 業務部稽核租戶 A 業務部",
        "租戶 B租戶管理員租戶 B",
      ].join(""),
    );
    await actor.keyboard("{Escape}");

    await chooseOption(actor, comboboxAt("套用對象"), "組織");
    expect(
      await within(editor()).findByRole("tree", { name: "組織" }),
    ).toBeInTheDocument();
  });

  // #372:同一個擁有組織的角色被 api 回的順序隔開時,MUI 的 `groupBy` 只合併相鄰的同值,
  // 於是「租戶 A」會出現兩次。分組改以**擁有組織**為準(租戶頂層底下可以有很多個),
  // 清單先排序讓同組織的角色相鄰。
  it("套用對象「指定角色」:依擁有組織分組,每個組織的標題只出現一次", async () => {
    const { user: actor } = renderPage();
    await startRule(actor);

    await chooseOption(actor, comboboxAt("套用對象"), "角色");
    await actor.click(comboboxAt("對象"));

    expect(autocompleteGroupLabels()).toEqual([
      "租戶 A",
      "租戶 A 業務部",
      "租戶 B",
    ]);
    // 「租戶 A 業務部」的租戶頂層是「租戶 A」—— 標題是擁有組織,不是租戶頂層
    expect(autocompleteGroupLabels()).not.toContain("共用");
  });

  it("套用對象「指定角色」:在選單內輸入即收斂(不再有選單外的搜尋框)", async () => {
    const { user: actor } = renderPage();
    await startRule(actor);

    await chooseOption(actor, comboboxAt("套用對象"), "角色");
    // #307:搜尋回到選單內,選單外那個獨立的「搜尋角色」欄位已移除
    expect(within(editor()).queryByLabelText("搜尋角色")).toBeNull();

    await actor.type(comboboxAt("對象"), "租戶管理員");

    // 同名的兩筆都留著,靠次文字分辨
    expect(autocompleteOptions()).toEqual([
      "租戶管理員租戶 A",
      "租戶管理員租戶 B",
    ]);
  });

  it("動態值【操作者本人】存成佔位符,送出的 payload 與正本形狀一致", async () => {
    const { user: actor, fake } = renderPage();
    await startRule(actor);

    await chooseOption(actor, comboboxAt("套用對象"), "角色");
    await pickAutocomplete(actor, comboboxAt("對象"), "客服");
    await actor.keyboard("{Escape}");
    await chooseOption(actor, comboboxAt("欄位"), "建立者");
    await chooseOption(actor, comboboxAt("值"), "【操作者本人】");
    await actor.keyboard("{Escape}");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    expect(fake.inputs.saveDataScopeRule[0]).toEqual({
      targetId: "target-sample-one",
      combineOp: "OR",
      rules: [
        {
          audience: {
            mode: "match",
            filter: {
              field: "role",
              cond: "in",
              value: { kind: "static", values: ["role-support"] },
            },
          },
          filter: {
            op: "AND",
            children: [
              {
                field: "createdBy",
                cond: "in",
                value: { kind: "dynamic", ref: "current-user" },
              },
            ],
          },
        },
      ],
    });
  });

  it("日期條件:存的時點以租戶時區回顯成日期,改選的那天送出台北 00:00 的時點", async () => {
    const { user: actor, fake } = renderPage({ world: { rules: [savedRule] } });
    await waitForEditor("示範模組1(demo_items_one)");

    // 夾具存的是台北 2026-01-01 / 2026-12-31 00:00 的時點(UTC 是前一天 16:00)
    const from = await within(editor()).findByRole("group", { name: "起日" });
    const to = within(editor()).getByRole("group", { name: "迄日" });
    expect(from).toHaveTextContent("2026-01-01");
    expect(to).toHaveTextContent("2026-12-31");

    fireEvent.click(
      within(to.parentElement ?? document.body).getByRole("button", {
        name: /choose date/i,
      }),
    );
    fireEvent.click(await screen.findByRole("gridcell", { name: "30" }));
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    expect(
      JSON.stringify(fake.inputs.saveDataScopeRule[0]?.rules[0]?.filter),
    ).toContain(
      JSON.stringify({
        field: "createdAt",
        cond: "between",
        value: {
          kind: "static",
          values: ["2025-12-31T16:00:00.000Z", "2026-12-29T16:00:00.000Z"],
        },
      }),
    );
  });

  // 分成兩案:全套並行時單一案例在 CI 逾時 15 秒(TEST-08:一案只做一件事);建三層的步驟共用 `buildThreeLevels`
  it("巢狀群組最多三層:第三層不再給「+ 群組」,「+ 條件」還在", async () => {
    const { user: actor } = renderPage();
    await buildThreeLevels(actor);

    expect(
      within(editor()).getAllByRole("combobox", { name: "群組組合" }),
    ).toHaveLength(2);
    // 第三層的群組不再給「+ 群組」(UI 上限三層),但「+ 條件」還在
    expect(screen.getAllByRole("button", { name: "+ 群組" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "+ 條件" })).toHaveLength(3);
  });

  it("巢狀群組最多三層:送出的 filter 也是三層", async () => {
    const { user: actor, fake } = renderPage();
    await buildThreeLevels(actor);

    await actor.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    expect(fake.inputs.saveDataScopeRule[0]?.rules[0]?.filter).toEqual({
      op: "AND",
      children: [
        {
          field: "status",
          cond: "in",
          value: { kind: "static", values: ["draft"] },
        },
        {
          op: "AND",
          children: [
            {
              field: "status",
              cond: "in",
              value: { kind: "static", values: ["published"] },
            },
            {
              op: "AND",
              children: [
                {
                  field: "status",
                  cond: "in",
                  value: { kind: "static", values: ["draft"] },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("本地驗證先擋:沒填值就按儲存不會送出,錯誤標在那一列", async () => {
    const { user: actor, fake } = renderPage();
    await startRule(actor);

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    expect(
      await within(editor()).findByText("請填一個有效的值。"),
    ).toBeInTheDocument();
    expect(fake.inputs.saveDataScopeRule).toHaveLength(0);
  });

  it("api 的 RULE_INVALID 標到 path 指到的那一列,不是第一列", async () => {
    const { user: actor, fake } = renderPage({
      world: {
        failures: {
          SaveDataScopeRule: {
            code: "RULE_INVALID",
            extensions: {
              path: "rules[0].filter.children[1].value.values[0]",
              reason: "VALUE_INVALID",
            },
          },
        },
      },
    });
    await startRule(actor);

    await chooseOption(actor, comboboxAt("值"), "草稿");
    await actor.keyboard("{Escape}");
    await actor.click(screen.getByRole("button", { name: "+ 條件" }));
    await chooseOption(actor, comboboxAt("欄位", 1), "建立者");
    await chooseOption(actor, comboboxAt("值", 1), "【操作者本人】");
    await actor.keyboard("{Escape}");

    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.saveDataScopeRule).toHaveLength(1);
    });
    // 錯誤只出現一次,而且是在 children[1](建立者)那一列,不是第一列(狀態)
    expect(
      await within(editor()).findByText("請填一個有效的值。"),
    ).toBeInTheDocument();
    expect(within(editor()).getAllByText("請填一個有效的值。")).toHaveLength(1);
    expect(comboboxAt("值", 1)).toHaveAttribute("aria-invalid", "true");
    expect(comboboxAt("值", 0)).not.toHaveAttribute("aria-invalid", "true");
    expect(
      within(editor()).getByText(
        "規則不合法,請依畫面上標出的位置修正後再儲存。",
      ),
    ).toBeInTheDocument();
  });

  it("儲存成功後左清單的「已設規則」亮起來(該目標的規則被失效重查)", async () => {
    const { user: actor } = renderPage();
    await startRule(actor);

    await chooseOption(actor, comboboxAt("值"), "草稿");
    await actor.keyboard("{Escape}");
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "資料目標" })).getAllByRole(
          "button",
        )[0],
      ).toHaveTextContent("已設規則");
    });
  });
});
