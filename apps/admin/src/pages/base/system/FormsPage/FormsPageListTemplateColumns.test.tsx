import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ModuleListColumnKind } from "@repo/graphql";

import { graphqlError } from "@/test/msw/auth-handlers";
import {
  SHOPPING_FORM_KEY,
  shoppingDefinition,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { api, server } from "@/test/msw/server";

import {
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const openEditor = async (user: ReturnType<typeof renderFormsPage>["user"]) => {
  await findDesigner();
  await user.click(screen.getByRole("button", { name: "列表欄位配置" }));
  const dialog = await screen.findByRole("dialog", {
    name: "列表欄位配置 — 示範表單(頂層)",
  });
  await within(dialog).findByText("目前沒有設定,列表使用預設欄(標題、日期)。");
  await user.click(within(dialog).getByRole("button", { name: "+ 組合欄" }));
  return dialog;
};

describe("列表欄位配置:組合欄", () => {
  it("新增組合欄:欄名、限定表單、模板從「插入欄位」挑摘要槽與欄位;存的是 kind TEMPLATE + 模板 + 欄名", async () => {
    const { user, world } = renderFormsPage();
    // 可插入的欄位讀共用表單目前版本的定義(執行期的版本查詢)
    server.use(
      ...formRuntimeWorld({
        versions: { [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition() },
      }).handlers,
    );
    const dialog = await openEditor(user);
    const row = within(dialog).getByRole("group", { name: "第 1 欄" });

    await user.type(within(row).getByLabelText("欄名"), "品項摘要");
    await user.click(within(row).getByRole("combobox", { name: "限定表單" }));
    await user.click(await screen.findByRole("option", { name: "購物單" }));
    const insert = () =>
      within(row).getByRole("combobox", { name: "插入欄位" });
    await user.click(insert());
    await user.click(
      await screen.findByRole("option", { name: "摘要槽 / 單號" }),
    );
    await user.type(within(row).getByLabelText("模板"), " ");
    await user.click(insert());
    await user.click(
      await screen.findByRole("option", { name: "購物單 / 品項" }),
    );
    expect(within(row).getByLabelText("模板")).toHaveValue(
      "{{serialNo}} {{value.item}}",
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(world.inputs.setModuleListColumns).toEqual([
        expect.objectContaining({
          moduleKey: "demo-form",
          columns: [
            {
              kind: ModuleListColumnKind.Template,
              key: "{{serialNo}} {{value.item}}",
              formKey: SHOPPING_FORM_KEY,
              label: "品項摘要",
              width: 180,
              order: 0,
            },
          ],
        }),
      ]);
    });
  });

  it("「插入欄位」給日期多列常用格式(插入 `|格式`),其他摘要槽沒有;格式字串也能自己打", async () => {
    const { user } = renderFormsPage();
    server.use(
      ...formRuntimeWorld({
        versions: { [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition() },
      }).handlers,
    );
    const dialog = await openEditor(user);
    const row = within(dialog).getByRole("group", { name: "第 1 欄" });
    await user.click(within(row).getByRole("combobox", { name: "插入欄位" }));
    expect(
      screen.queryByRole("option", { name: "摘要槽 / 標題(格式 HH:mm)" }),
    ).toBeNull();
    expect(
      screen.getByRole("option", { name: "摘要槽 / 日期(格式 YYYY/MM/DD)" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("option", { name: "摘要槽 / 日期(格式 HH:mm)" }),
    );
    expect(within(row).getByLabelText("模板")).toHaveValue("{{date|HH:mm}}");
  });

  it("api 擋下:欄名格式錯寫在欄名下、模板引用受保護欄位寫在那一列下", async () => {
    const { user } = renderFormsPage();
    server.use(
      api.mutation("SetModuleListColumns", () =>
        graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          fields: ["columns.0.label"],
        }),
      ),
    );
    const dialog = await openEditor(user);
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByText("欄名必填,最多 50 個字"),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("欄名")).toHaveAccessibleDescription(
      "欄名必填,最多 50 個字",
    );

    server.use(
      api.mutation("SetModuleListColumns", () =>
        graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          fields: ["columns.0"],
          reason: "LIST_COLUMN_PROTECTED",
        }),
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(
      await within(dialog).findByRole("group", { name: "第 1 欄" }),
    ).toHaveAccessibleDescription("模板不能引用受保護的欄位");
  });
});
