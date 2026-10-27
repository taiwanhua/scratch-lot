import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";

import { TRANSFER_WRONG_STORE_CODE } from "@/test/msw/project/lottery/transfer-handlers";
import { transferSettlement } from "@/test/msw/project/lottery/transfer-settlement-fixtures";
import { api, server } from "@/test/msw/server";

import { renderTransferPage } from "../transfer-test-support";

/**
 * 調貨單的替換檢視頁(規格 8.4;Figma PU-10a 出貨確認、PU-10b 點收與結算):出貨確認清單、點收區塊、
 * 送錯分店、結算區塊(兩邊)。
 */
describe("調貨單檢視頁", () => {
  it("第一關出貨確認:關卡標籤、出貨店 → 收貨店、出貨確認清單(方式、張號、批購金額)", async () => {
    renderTransferPage({ path: "/purchasing/transfer/view-page/doc-t8" });
    expect(await screen.findByText("第一關 出貨確認")).toBeInTheDocument();
    expect(
      screen.getByText(/中山店 → 新竹店 · 叫貨單 R-0022 · 調貨金額 1,840/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "出貨確認清單" }),
    ).toBeInTheDocument();
    const [table] = screen.getAllByRole("table");
    expect(within(table).getByText("選張")).toBeInTheDocument();
    expect(within(table).getByText("#090–099")).toBeInTheDocument();
    expect(within(table).getByText("1,840")).toBeInTheDocument();
  });

  it("第二關點收:刷選張那一列的一張 → 只點收那一張;送錯分店 → 擋下並提示是哪一家店的哪一張調貨單,[通知總部更正] 通知建立者", async () => {
    const user = userEvent.setup();
    const { transferFake } = renderTransferPage({
      path: "/purchasing/transfer/view-page/doc-t10",
    });
    expect(await screen.findByText("第二關 點收")).toBeInTheDocument();
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0060112050{Enter}");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "完成這次點收(1 本)" }),
      ).toBeEnabled();
    });
    expect(transferFake.scanned).toEqual(["0060112050"]);
    // 點收區塊的欄名用調貨單的詞(張號、金額)
    expect(
      screen.getAllByRole("columnheader", { name: "張號" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("columnheader", { name: "最後張號" })).toBeNull();
    await user.type(scan, `${TRANSFER_WRONG_STORE_CODE}{Enter}`);
    const dialog = await screen.findByRole("dialog", {
      name: "這本不是送到這家店",
    });
    expect(
      within(dialog).getByText(
        "這本屬於送往「台中店」的調貨單 #T-0011,請交給送貨人帶到台中店,本店不用點收。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "通知總部更正" }),
    );
    await waitFor(() => {
      expect(transferFake.notified).toEqual([TRANSFER_WRONG_STORE_CODE]);
    });
  });

  it("選張的列逐張點收:刷一張 → 展開格子、列顯示「部分點收 1 / 12」;同張再刷 →「這張已經點收」;選格子 [點收選取的 N 張];提示還有哪幾張沒點收;[其餘全部到齊…] 確認句列出剩下的張", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: "/purchasing/transfer/view-page/doc-t10" });
    expect(await screen.findByText("未點收 0 / 12")).toBeInTheDocument();
    const scan = await screen.findByRole("textbox", { name: "刷條碼點收" });
    await user.type(scan, "0060112050{Enter}");
    expect(await screen.findByText("部分點收 1 / 12")).toBeInTheDocument();
    // 那一列自動展開格子:#050 已點收、其他未點收
    const grid = await screen.findByRole("group", { name: "張數格子" });
    expect(
      within(grid).getByRole("button", { name: "#050 已點收" }),
    ).toBeDisabled();
    expect(
      within(grid).getByRole("button", { name: "#045 未點收" }),
    ).toBeEnabled();
    // 還有 11 張沒點收:列出哪幾張,請退回由出貨店移除
    expect(
      screen.getByText(
        "還有 11 張沒點收(060112 #045–049、#051–056),請退回由出貨店移除沒到的張",
      ),
    ).toBeInTheDocument();
    await user.clear(scan);
    await user.type(scan, "0060112050{Enter}");
    expect(await screen.findByText("這張已經點收")).toBeInTheDocument();
    // 點選格子 → [點收選取的 2 張]
    await user.click(within(grid).getByRole("button", { name: "#045 未點收" }));
    await user.click(within(grid).getByRole("button", { name: "#046 未點收" }));
    await user.click(screen.getByRole("button", { name: "點收選取的 2 張" }));
    expect(await screen.findByText("部分點收 3 / 12")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "其餘全部到齊…" }));
    const dialog = await screen.findByRole("dialog", { name: "其餘全部到齊" });
    expect(
      within(dialog).getByText("確認 #047–049、#051–056 這 9 張都到了?"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "都到了,點收" }),
    );
    await waitFor(() => {
      expect(screen.queryByText(/部分點收/)).toBeNull();
    });
    expect(screen.queryByText(/還有 \d+ 張沒點收/)).toBeNull();
  });

  it("結算區塊:調貨金額、收貨店已付、出貨店已收與「N 待出貨店入帳」", async () => {
    renderTransferPage({ path: "/purchasing/transfer/view-page/doc-t10" });
    expect(
      await screen.findByRole("heading", { name: "結算" }),
    ).toBeInTheDocument();
    expect(screen.getByText("調貨金額")).toBeInTheDocument();
    expect(screen.getByText(/待出貨店入帳/)).toBeInTheDocument();
  });

  it("收貨店從小金庫付現超過小金庫應有 → 視窗留著、顯示小金庫應有不足(同出庫的提示)", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: "/purchasing/transfer/view-page/doc-t10" });
    const base = transferSettlement("doc-t10");
    if (base === null) throw new Error("缺 T-0010 的收付夾具");
    const [receiver, shipper] = base.sides;
    const unpaid = {
      ...base,
      sides: [
        {
          ...receiver,
          buttons: receiver.buttons.map((button) => ({
            ...button,
            defaultAmount: button.button === "out" ? 1000 : 0,
            canUse: button.button === "out",
          })),
        },
        shipper,
      ],
      records: [],
    };
    server.use(
      api.query("LotterySettlement", () =>
        HttpResponse.json({ data: { lotterySettlement: { item: unpaid } } }),
      ),
      api.mutation("RecordLotterySettlement", () =>
        HttpResponse.json({
          errors: [
            {
              message: "amount exceeds the vault's expected cash",
              extensions: {
                code: "VALIDATION_FAILED",
                fields: ["amount"],
                reason: "AMOUNT_EXCEEDS_VAULT",
              },
            },
          ],
        }),
      ),
    );

    const [payButton] = await screen.findAllByRole("button", { name: "付款" });
    await user.click(payButton);
    const dialog = await screen.findByRole("dialog", { name: "付款" });
    await user.click(
      within(dialog).getByRole("combobox", { name: "付款方式" }),
    );
    await user.click(await screen.findByRole("option", { name: "現金" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /經手人/ }),
      "王小明(送貨人)",
    );
    await user.click(within(dialog).getByRole("button", { name: "確認" }));

    expect(
      await within(dialog).findByText(
        "小金庫應有不足,請先用現金更正單登記小金庫實際的錢",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "付款" })).toBeInTheDocument();
    // REACT-18:原因寫在金額欄正下方,上方提示只放通用句
    expect(
      within(dialog).getByRole("textbox", { name: /金額/ }),
    ).toHaveAccessibleDescription(
      "小金庫應有不足,請先用現金更正單登記小金庫實際的錢",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "有欄位不正確,請檢查標示的欄位",
    );
  });

  it("沖正收付:原因沒填 → 原因欄下寫格式要求(REACT-18)", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: "/purchasing/transfer/view-page/doc-t10" });
    await user.click(await screen.findByRole("button", { name: "沖正" }));
    const dialog = await screen.findByRole("dialog", { name: "沖正" });
    await user.click(within(dialog).getByRole("button", { name: "沖正" }));
    expect(
      within(dialog).getByRole("textbox", { name: /原因/ }),
    ).toHaveAccessibleDescription("必填,最多 200 個字");
  });
});
