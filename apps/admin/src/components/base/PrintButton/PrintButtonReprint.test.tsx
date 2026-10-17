import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  findPrintButton,
  renderPrintButton,
} from "./print-button-test-support";

/**
 * 補印對話框(底座規格第 6 章「列印按鈕元件」補印表的畫面列,每列一個測試;
 * API 列見 `apps/api/src/printing/print-jobs.test.ts`)。
 */

type Actor = ReturnType<typeof renderPrintButton>["user"];

const openReprintDialog = async (user: Actor) => {
  await user.click(await findPrintButton("補印"));
  return screen.findByRole("dialog", { name: "補印" });
};

const chooseReason = async (user: Actor, label: string) => {
  await user.click(await screen.findByRole("combobox", { name: /補印原因/ }));
  await user.click(await screen.findByRole("option", { name: label }));
};

describe("補印對話框", () => {
  it("按 [補印] → 開對話框:補印原因(遺失 / 破損 / 其他)、說明;[送出] [取消]", async () => {
    const { user } = renderPrintButton({ printedCount: 1 });

    const dialog = await openReprintDialog(user);

    expect(
      within(dialog).getByRole("combobox", { name: /補印原因/ }),
    ).toBeVisible();
    expect(within(dialog).getByRole("textbox", { name: "說明" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "送出" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeVisible();
    await user.click(
      within(dialog).getByRole("combobox", { name: /補印原因/ }),
    );
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "遺失",
      "破損",
      "其他",
    ]);
  });

  it("沒選原因就送出 → 擋下,原因欄顯示必填錯誤;不呼叫 API", async () => {
    const { user, world, renderImage } = renderPrintButton({ printedCount: 1 });
    const dialog = await openReprintDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    expect(within(dialog).getByText("請選擇補印原因")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "補印" })).toBeVisible();
    expect(renderImage).not.toHaveBeenCalled();
    expect(world.created).toEqual([]);
  });

  it("選「其他」、說明空白就送出 → 擋下,說明欄顯示必填錯誤;不呼叫 API", async () => {
    const { user, world } = renderPrintButton({ printedCount: 1 });
    const dialog = await openReprintDialog(user);
    await chooseReason(user, "其他");
    await user.type(
      within(dialog).getByRole("textbox", { name: /說明/ }),
      "  ",
    );

    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    expect(within(dialog).getByText("選「其他」時請填寫說明")).toBeVisible();
    expect(world.created).toEqual([]);
  });

  it("選「遺失」送出 → 建立補印工作(原因 lost、沒填說明寫 null);補印標示印第 N+1 次、補印人", async () => {
    const { user, world, renderImage } = renderPrintButton({ printedCount: 2 });
    const dialog = await openReprintDialog(user);
    await chooseReason(user, "遺失");

    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.created).toEqual([
        expect.objectContaining({
          isReprint: true,
          reprintReason: "lost",
          reprintNote: null,
        }),
      ]);
    });
    expect(screen.queryByRole("dialog", { name: "補印" })).toBeNull();
    expect(renderImage).toHaveBeenCalledWith({
      printNo: 3,
      reason: "lost",
      reasonLabel: "遺失",
      note: null,
      reprintedAt: expect.any(String),
      reprintedBy: "小華",
    });
  });

  it("選「破損」並填說明 → 說明照送", async () => {
    const { user, world } = renderPrintButton({ printedCount: 1 });
    const dialog = await openReprintDialog(user);
    await chooseReason(user, "破損");
    await user.type(
      within(dialog).getByRole("textbox", { name: "說明" }),
      "被咖啡潑到",
    );

    await user.click(within(dialog).getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.created).toEqual([
        expect.objectContaining({
          reprintReason: "damaged",
          reprintNote: "被咖啡潑到",
        }),
      ]);
    });
  });

  it("按 [取消] → 關閉對話框,不建立工作", async () => {
    const { user, world } = renderPrintButton({ printedCount: 1 });
    const dialog = await openReprintDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "補印" })).toBeNull();
    });
    expect(world.created).toEqual([]);
  });

  it("補印原因清單是空的 → 原因欄提示「尚未設定補印原因」", async () => {
    const { user } = renderPrintButton({ printedCount: 1, reasons: [] });

    const dialog = await openReprintDialog(user);

    expect(
      await within(dialog).findByText("尚未設定補印原因,請洽管理員新增"),
    ).toBeVisible();
  });

  it("第一次列印(非補印)→ 不開對話框,不帶補印標示", async () => {
    const { user, world, renderImage } = renderPrintButton();

    await user.click(await findPrintButton("列印"));

    await waitFor(() => {
      expect(world.created).toHaveLength(1);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(renderImage).toHaveBeenCalledWith(null);
  });
});
