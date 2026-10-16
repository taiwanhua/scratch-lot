import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FieldDef } from "@repo/domain/form";

import {
  addField,
  canvas,
  preloadFormsPage,
  renderFormsPage,
  smallDesignOptions,
} from "./forms-page-test-support";

preloadFormsPage();

type User = ReturnType<typeof renderFormsPage>["user"];

/** 加一個明細列,打開它預設的子欄「項目」。 */
const openDefaultColumn = async (user: User) => {
  await addField(user, "明細列");
  await user.click(screen.getByRole("button", { name: "設定子欄位「項目」" }));
  return screen.findByRole("region", { name: "子欄位設定" });
};

describe("表單管理:設計器的明細列", () => {
  it("元件面板加「明細列」:畫布是表格外觀的占位,表頭是子欄標題", async () => {
    const { user } = renderFormsPage(smallDesignOptions());
    await addField(user, "明細列");

    const table = within(canvas()).getByRole("table", { name: "明細列" });
    expect(
      within(table).getByRole("columnheader", { name: "項目" }),
    ).toBeInTheDocument();
  });

  it("預覽可新增、刪除列", async () => {
    const { user } = renderFormsPage(smallDesignOptions());
    await addField(user, "明細列");
    await user.click(
      within(screen.getByRole("tablist", { name: "設計器模式" })).getByRole(
        "tab",
        { name: "預覽" },
      ),
    );
    await user.click(await screen.findByRole("button", { name: "+ 新增一列" }));
    await user.click(screen.getByRole("button", { name: "+ 新增一列" }));
    await user.click(screen.getByRole("button", { name: "刪除第 1 列" }));

    const table = screen.getByRole("table", { name: "明細列" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("子欄位面板只列白名單內的設定(沒有顯示條件、欄位權限、預設值)", async () => {
    const { user } = renderFormsPage(smallDesignOptions());
    const panel = await openDefaultColumn(user);

    expect(
      within(panel).getByRole("combobox", { name: "值的來源" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "顯示條件" })).toBeNull();
    expect(screen.queryByRole("switch", { name: /受保護/ })).toBeNull();
    expect(screen.queryByText("預設值")).toBeNull();
  });

  it("子欄型別選「引用」:出現資料來源設定、沒有值的來源(只能使用者填);存下預設來源", async () => {
    const { user, world } = renderFormsPage(smallDesignOptions());
    const panel = await openDefaultColumn(user);
    await user.click(within(panel).getByRole("combobox", { name: "型別" }));
    await user.click(await screen.findByRole("option", { name: "引用" }));

    expect(
      within(panel).getByRole("combobox", { name: "資料來源" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("combobox", { name: "值的來源" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.saveFormVersionDraft).toHaveLength(1);
    });
    const saved = world.inputs.saveFormVersionDraft[0]?.fields.find(
      (field) => field.type === "array",
    ) as FieldDef | undefined;
    expect(saved?.columns?.[0]).toMatchObject({
      type: "reference",
      widget: { kind: "referencePicker" },
      valueSource: { kind: "input" },
      source: { provider: "user", labelField: "name" },
    });
  });

  it("子欄 key 與同一明細的別的子欄重複 → 當場擋下、不寫入", async () => {
    const { user, world } = renderFormsPage(smallDesignOptions());
    await addField(user, "明細列");
    await user.click(screen.getByRole("button", { name: "+ 子欄位" }));
    const [first] = screen.getAllByRole("button", {
      name: "設定子欄位「項目」",
    });
    await user.click(first);
    // 第一個「項目」是預設子欄 item;改它的 key 成新加的那個子欄的 key
    const key = await screen.findByRole("textbox", { name: "欄位 key" });
    await user.clear(key);
    await user.type(key, "column_1");

    expect(screen.getByText("與其他欄位的 key 重複")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.saveFormVersionDraft).toHaveLength(1);
    });
    const saved = world.inputs.saveFormVersionDraft[0]?.fields.find(
      (field) => field.type === "array",
    ) as FieldDef | undefined;
    // 定義裡停在最後一個合格的值(打到 `column_` 時還合格),重複的 `column_1` 沒寫進去
    expect(saved?.columns?.map((column) => column.key)).toEqual([
      "column_",
      "column_1",
    ]);
  });
});
