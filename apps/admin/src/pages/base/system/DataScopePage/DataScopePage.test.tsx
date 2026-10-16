import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { savedRule } from "@/test/msw/data-scope-fixtures";

import { DATA_SCOPE_PERMISSIONS } from "./data-scope-permissions";
import {
  audienceRegion,
  conditionsRegion,
  editor,
  renderPage,
  targetList,
  waitForEditor,
} from "./data-scope-test-support";

describe("資料範圍頁(/system/data-scope)", () => {
  it("左清單一列 = 一個模組(主文字模組名、副文字 collection),已經設過規則的掛「已設規則」;預設選第一個", async () => {
    renderPage({ world: { rules: [savedRule] } });

    await waitForEditor("示範模組1(demo_items_one)");

    const items = within(targetList()).getAllByRole("button");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("示範模組1");
    expect(items[0]).toHaveTextContent("demo_items_one");
    expect(items[0]).toHaveTextContent("已設規則");
    // 兩個表單模組共用 form_submissions,各自一列;還沒有規則,不掛標籤
    expect(items[1]).toHaveTextContent("示範表單(頂層)");
    expect(items[1]).toHaveTextContent("form_submissions");
    expect(items[1]).not.toHaveTextContent("已設規則");
    expect(items[2]).toHaveTextContent("示範表單(群組內)");
    expect(items[2]).toHaveTextContent("form_submissions");
  });

  it("右邊一定看得到「沒有規則 = 可見範圍內」的預設提示與保底說明", async () => {
    renderPage();

    await waitForEditor("示範模組1(demo_items_one)");
    expect(
      within(editor()).getByText(/未命中任何規則的人 → 預設:可見範圍內/),
    ).toBeInTheDocument();
    expect(
      within(editor()).getByText(
        "目前沒有規則:每個人都看得到自己可見範圍內的全部資料。",
      ),
    ).toBeInTheDocument();
  });

  it("已存在的規則讀回編輯器:頂層合成、套用對象與條件組合的巢狀群組都還原", async () => {
    renderPage({ world: { rules: [savedRule] } });

    await waitForEditor("示範模組1(demo_items_one)");

    expect(
      within(editor()).getByRole("combobox", { name: "規則合成" }),
    ).toHaveTextContent("OR — 命中任一規則即可(資料變多)");
    // 套用對象:客服 AND(A-2 台北分店含下層 OR 持有「示範模組1 · 編輯」)
    const audience = audienceRegion();
    expect(
      within(audience).getByRole("radio", { name: "符合條件" }),
    ).toBeChecked();
    expect(
      within(audience).getByRole("combobox", { name: "組合" }),
    ).toHaveTextContent("AND — 全部成立才放行");
    expect(
      within(audience).getByRole("combobox", { name: "群組組合" }),
    ).toHaveTextContent("OR — 其中一個成立即可");
    expect(
      within(audience)
        .getAllByRole("combobox", { name: "欄位" })
        .map((field) => field.textContent),
    ).toEqual(["角色", "所屬組織", "權限"]);
    expect(await within(audience).findByText("客服")).toBeInTheDocument();
    expect(
      await within(audience).findByText("A-2 台北分店"),
    ).toBeInTheDocument();
    expect(
      within(audience).getByRole("combobox", { name: "範圍" }),
    ).toHaveTextContent("含下層");
    expect(
      await within(audience).findByText("示範模組1 · 編輯"),
    ).toBeInTheDocument();
    // 條件組合:根群組 AND + 一個 OR 子群組(根層下拉同樣叫「組合」)
    const conditions = conditionsRegion();
    expect(
      within(conditions).getByRole("combobox", { name: "組合" }),
    ).toHaveTextContent("AND — 全部成立才放行");
    expect(
      within(conditions).getByRole("combobox", { name: "群組組合" }),
    ).toHaveTextContent("OR — 其中一個成立即可");
    expect(
      within(conditions).getByText("整個群組視為上一層的一個條件"),
    ).toBeInTheDocument();
  });

  it("切換資料目標會換成那個目標的規則", async () => {
    const { user: actor } = renderPage({ world: { rules: [savedRule] } });

    await waitForEditor("示範模組1(demo_items_one)");
    await actor.click(
      within(targetList()).getByRole("button", { name: /示範表單\(頂層\)/ }),
    );

    await waitForEditor("示範表單(頂層)(form_submissions)");
    expect(
      within(editor()).queryByRole("region", { name: "套用對象" }),
    ).not.toBeInTheDocument();
  });

  it("有未儲存的變更時切目標要先確認;「繼續編輯」留在原地,「放棄變更」才切過去", async () => {
    const { user: actor } = renderPage();

    await waitForEditor("示範模組1(demo_items_one)");
    await actor.click(screen.getByRole("button", { name: "+ 新增規則" }));
    await actor.click(
      within(targetList()).getByRole("button", { name: /示範表單\(頂層\)/ }),
    );

    expect(await screen.findByText("放棄未儲存的變更?")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "繼續編輯" }));
    await waitFor(() => {
      expect(screen.queryByText("放棄未儲存的變更?")).not.toBeInTheDocument();
    });
    expect(
      within(editor()).getByText("示範模組1(demo_items_one)"),
    ).toBeInTheDocument();

    await actor.click(
      within(targetList()).getByRole("button", { name: /示範表單\(頂層\)/ }),
    );
    await actor.click(await screen.findByRole("button", { name: "放棄變更" }));

    await waitForEditor("示範表單(頂層)(form_submissions)");
  });

  it("只有檢視權限時,編輯器唯讀:新增 / 刪除 / 儲存都不出現", async () => {
    renderPage({
      permissions: [DATA_SCOPE_PERMISSIONS.view],
      world: { rules: [savedRule] },
    });

    await waitForEditor("示範模組1(demo_items_one)");
    for (const label of [
      "+ 新增規則",
      "刪除規則",
      "+ 條件",
      "+ 群組",
      "儲存",
    ]) {
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
    }
    expect(
      within(editor()).getByRole("combobox", { name: "規則合成" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
