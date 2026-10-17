import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  defaultDesignOptions,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const openVersions = async (
  user: ReturnType<typeof renderFormsPage>["user"],
) => {
  await findDesigner();
  await user.click(screen.getByRole("tab", { name: "表單版本" }));
  return screen.findByRole("table", { name: "版本清單" });
};

describe("表單管理:版本面板", () => {
  it("發布:填變更說明、帶 expectedDraftRevision;檢查器有錯時就地列出、不發布", async () => {
    const { user, world } = renderFormsPage({
      ...defaultDesignOptions(),
      failures: {
        PublishFormVersion: {
          code: "VALIDATION_FAILED",
          extensions: {
            fields: ["definition"],
            issues: [
              {
                code: "SUMMARY_UNMAPPED",
                message: "摘要槽「title」沒有對到欄位",
                location: { summarySlot: "title" },
              },
            ],
          },
        },
      },
    });
    const table = await openVersions(user);

    await user.click(within(table).getByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布新版本" });
    const confirm = within(dialog).getByRole("button", { name: "發布" });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "加欄位",
    );
    await user.click(confirm);

    expect(
      await within(dialog).findByText("摘要槽「title」沒有對到欄位"),
    ).toBeInTheDocument();
    expect(world.inputs.publishFormVersion[0]).toEqual({
      formKey: "shopping_list",
      expectedDraftRevision: 1,
      changelog: "加欄位",
    });
  });

  it("發布成功:草稿變成新版本、前一版退役", async () => {
    const { user } = renderFormsPage();
    const table = await openVersions(user);

    await user.click(within(table).getByRole("button", { name: "發布" }));
    const dialog = await screen.findByRole("dialog", { name: "發布新版本" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "變更說明" }),
      "第二版",
    );
    await user.click(within(dialog).getByRole("button", { name: "發布" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "發布新版本" })).toBeNull();
    });
    const refreshed = await screen.findByRole("table", { name: "版本清單" });
    expect(await within(refreshed).findByText("v2")).toBeInTheDocument();
    expect(within(refreshed).getByText("已退役")).toBeInTheDocument();
  });

  it("以此為基底建新表單:key 建立後不可改的提示", async () => {
    const { user } = renderFormsPage();
    await findDesigner();

    await user.click(
      screen.getByRole("button", { name: "以此為基底建新表單" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "以「購物單」為基底建新表單",
    });

    expect(
      within(dialog).getByText("建立後不可修改;建議格式:<來源 key>_<組織短碼>"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "新表單 key" }),
    ).toHaveValue("shopping_list_");
  });
});
