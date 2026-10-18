import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { autocompleteOption, openAutocomplete } from "@/test/autocomplete";

import { renderPage, rowOf } from "../user-manager-test-support";

/** 彈窗裡的角色選擇器(`@repo/ui/autocomplete`)。 */
const rolePicker = () => screen.getByRole("combobox", { name: "角色" });

/** 打開選單並取目前列出的選項(共用 `@/test/autocomplete`,TEST-08)。 */
const openOptions = (actor: { click: (element: Element) => Promise<void> }) =>
  openAutocomplete(actor, "角色");

/**
 * 指派角色彈窗(候選改用正式的 `roles` query,擁有組織在操作者管理範圍內;
 * 第 3 段「查操作者自己持有的角色」的過渡做法退場)。
 *
 * 勾選列換成 Autocomplete —— 選項的「能不能選」從 `checkbox` 的 disabled
 * 變成 `option` 的 `aria-disabled`,原因從整列的說明文字變成選項內的次文字。
 */
describe("指派角色彈窗", () => {
  it("指派角色:候選來自 roles query,停用不可選、預設角色標記、範圍外的既有授予唯讀", async () => {
    const { user: actor, fake } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "指派角色" }),
    );

    // 候選是 `roles` 回的清單(擁有組織在管理範圍內),不再是「操作者自己持有的角色」
    await waitFor(() => {
      expect(fake.inputs.roles).toHaveLength(1);
    });
    await screen.findByRole("combobox", { name: "角色" });

    // 已持有的角色以 chip 顯示,底下的清單再列一次它們的描述與狀態
    expect(screen.getByText("內容管理相關權限")).toBeInTheDocument();

    await openOptions(actor);
    // 每列主文字角色名、次文字「擁有組織:…」(根組織視角靠它分辨同名角色)
    const editor = autocompleteOption("編輯");
    expect(editor).toHaveAttribute("aria-selected", "true");
    expect(editor).not.toHaveAttribute("aria-disabled", "true");
    expect(editor).toHaveTextContent("擁有組織:租戶 A");
    // 預設角色(租戶副本)的標記跟著選項走(決定要不要選它時就看得到)
    expect(autocompleteOption("租戶管理員")).toHaveTextContent("預設角色");

    // 停用的角色勾了也不生效(ADR-0011 步驟 2),所以不給新選
    const viewer = autocompleteOption("檢視者");
    expect(viewer).toHaveAttribute("aria-disabled", "true");
    expect(viewer).toHaveTextContent("已停用");
    // 已持有但擁有組織在管理範圍外:選不動,送出時也不包含
    const auditor = autocompleteOption("審核員");
    expect(auditor).toHaveAttribute("aria-disabled", "true");
    expect(auditor).toHaveTextContent("不在你的管理範圍內,無法變更");

    // 取消「編輯」後送出:管理範圍外的「審核員」不在 payload 裡(api 會原樣保留)
    await actor.click(editor);
    await actor.click(screen.getByRole("button", { name: "儲存指派" }));

    await waitFor(() => {
      expect(fake.inputs.assignUserRoles).toHaveLength(1);
    });
    expect(fake.inputs.assignUserRoles[0].roleIds).toEqual([]);
  });

  it("沒有授予資格的角色顯示但選不動,並就地說明只能授予哪個組織", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "指派角色" }),
    );
    await screen.findByRole("combobox", { name: "角色" });

    // 「分店專員」的擁有組織是租戶 B,王小明屬租戶 A / 內容組 ⇒ 沒有資格
    await openOptions(actor);
    const branch = autocompleteOption("分店專員");

    expect(branch).toHaveAttribute("aria-disabled", "true");
    expect(branch).toHaveTextContent(
      "此角色只能授予 租戶 B 及其下層的使用者;王小明 不在角色擁有組織之下。",
    );
  });

  it("在選單內輸入即收斂(選單外的搜尋框與組織篩選下拉已移除)", async () => {
    const { user: actor } = renderPage();

    await screen.findByText("王小明");
    await actor.click(
      within(rowOf("王小明")).getByRole("button", { name: "指派角色" }),
    );
    await screen.findByRole("combobox", { name: "角色" });

    // 搜尋回到選單內,彈窗上方那兩個欄位退場
    expect(screen.queryByLabelText("搜尋角色")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "組織(列出該組織的角色)" }),
    ).toBeNull();

    await actor.type(rolePicker(), "分店");

    const options = screen.getAllByRole("option");
    expect(
      options.map((option) => option.textContent.split("擁有組織", 1)[0]),
    ).toEqual(["分店專員"]);
  });
});
