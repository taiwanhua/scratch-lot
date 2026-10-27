import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { formFragment } from "@/test/msw/form-fixtures";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  defaultDesignOptions,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

describe("表單管理:表單設定「單號」", () => {
  it("預設不給號;打開 → 填前綴、即時預覽,[儲存單號格式] 以 updateForm 帶 serial", async () => {
    const { user, world } = renderFormsPage();

    const group = await screen.findByRole("group", { name: "單號" });
    const toggle = within(group).getByRole("switch", {
      name: "第一次送出時給單號",
    });
    expect(toggle).not.toBeChecked();
    expect(within(group).queryByLabelText("前綴")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.type(within(group).getByLabelText("前綴"), "PU");
    expect(within(group).getByText(/^例:PU-\d{6}-0001$/)).toBeInTheDocument();

    await user.click(
      within(group).getByRole("button", { name: "儲存單號格式" }),
    );

    await waitFor(() => {
      expect(world.inputs.updateForm).toEqual([
        {
          key: "shopping_list",
          serial: { prefix: "PU", period: "month", digits: 4, separator: "-" },
        },
      ]);
    });
    expect(await findSnackbarAlert()).toMatchObject({
      text: "已儲存單號格式。",
      severity: "success",
    });
  });

  it("前綴不合法 → 不能儲存", async () => {
    const { user } = renderFormsPage();

    const group = await screen.findByRole("group", { name: "單號" });
    await user.click(
      within(group).getByRole("switch", { name: "第一次送出時給單號" }),
    );
    await user.type(within(group).getByLabelText("前綴"), "TOOLONGPREFIX");

    expect(
      within(group).getByRole("button", { name: "儲存單號格式" }),
    ).toBeDisabled();
  });

  it("已設格式:關掉立刻存 serial null,提示已給的號碼保留", async () => {
    const { user, world } = renderFormsPage({
      ...defaultDesignOptions(),
      forms: [
        formFragment({
          serial: { prefix: "SL", period: "year", digits: 5, separator: null },
        }),
      ],
    });

    const group = await screen.findByRole("group", { name: "單號" });
    const toggle = within(group).getByRole("switch", {
      name: "第一次送出時給單號",
    });
    expect(toggle).toBeChecked();
    expect(within(group).getByText(/^例:SL-\d{4}-00001$/)).toBeInTheDocument();

    await user.click(toggle);

    await waitFor(() => {
      expect(world.inputs.updateForm).toEqual([
        { key: "shopping_list", serial: null },
      ]);
    });
    expect(await findSnackbarAlert()).toMatchObject({
      text: "已停止給單號,已給的號碼保留。",
      severity: "success",
    });
  });

  it("改不動的表單(abilities.canEdit false):看得到目前的設定,但不能切", async () => {
    renderFormsPage({
      ...defaultDesignOptions(),
      forms: [
        formFragment({
          serial: { prefix: "SL", period: "month", digits: 4, separator: "-" },
          abilities: {
            canEdit: false,
            canAssign: false,
            canSetEnabled: false,
            canFork: true,
          },
        }),
      ],
    });

    const group = await screen.findByRole("group", { name: "單號" });
    const toggle = within(group).getByRole("switch", {
      name: "第一次送出時給單號",
    });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(within(group).getByLabelText("前綴")).toBeDisabled();
  });
});
