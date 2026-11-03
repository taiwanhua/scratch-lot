import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";

import { transferOptions } from "@/test/msw/project/lottery/transfer-option-fixtures";
import { api, server } from "@/test/msw/server";

import { renderTransferPage } from "../transfer-test-support";

const CREATE = "/purchasing/transfer/create-page/transfer";

/** 出貨店的選項:能不能點格子、盤點制度(張數店規格 7.4)。 */
const optionsWith = (gridPick: boolean, countMode: string) =>
  api.query("LotteryTransferOptions", () =>
    HttpResponse.json({
      data: {
        lotteryTransferOptions: { ...transferOptions(), gridPick, countMode },
      },
    }),
  );

/**
 * 調貨單的張數店規則與刷到不能調的提示(張數店規格 7.4;Figma CS-30、PU-09-2a / 2b;驗收 16.5 T1–T3):
 * 張數店或關掉「調貨單可點格子選張」→ 格子只能看、只能刷或手輸;刷到不能調的張當下寫原因、不加進已選;
 * 送出被擋時逐列寫出哪幾張、現在是什麼狀態。拆過的本 056527:#001–011、#032、#048 已售(店內櫃台 10:12)。
 */
describe("調貨單:張數店與刷到不能調的張", () => {
  it("T1:張數店的出貨店 → 上方提示只能刷或手輸、格子只能看(不能點選、沒有連號快選)", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: `${CREATE}?to=org-store-b` });
    server.use(optionsWith(false, "count"));
    expect(
      await screen.findByText("這家店是張數盤點,請刷條碼或手輸張號選張。"),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "刷條碼或手輸張號加入" }),
      "5164-1-056527-020-0-6{Enter}",
    );
    const grid = await screen.findByRole("group", { name: "張數格子" });
    expect(
      within(grid).getByRole("button", { name: "#020 已選" }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: "#021 未售" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("textbox", { name: "連號快選的起號" }),
    ).toBeNull();
  });

  it("SET3:編號店關掉「調貨單可點格子選張」→ 同樣只能刷或手輸,提示寫設定", async () => {
    renderTransferPage({ path: `${CREATE}?to=org-store-b` });
    server.use(optionsWith(false, "numbered"));
    expect(
      await screen.findByText("這家店設定為只能刷條碼或手輸張號選張。"),
    ).toBeInTheDocument();
  });

  it("T2:刷到已售的張 → 輸入框下方當下寫原因與處理方式,不加進已選", async () => {
    const user = userEvent.setup();
    renderTransferPage({ path: `${CREATE}?to=org-store-b` });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼或手輸張號加入",
    });
    await user.type(scan, "5164-1-056527-005-0-6{Enter}");
    expect(
      await screen.findByText(
        /^#005 已售\(店內櫃台 .+ 賣出\):沒真的賣出請當下撤銷或送撤銷售出申請$/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "張數格子" })).toBeNull();
  });

  it("T3:送出被擋(TRANSFER_TICKETS_UNAVAILABLE)→ 重新拿格子資料,逐列寫出哪幾張、現在是什麼狀態", async () => {
    const user = userEvent.setup();
    renderTransferPage({
      path: `${CREATE}?to=org-store-b`,
      forms: {
        failures: {
          CreateAndSubmitFormSubmission: {
            // 守門擋下:通用碼 FORBIDDEN + 專案錯誤碼
            code: "FORBIDDEN",
            extensions: { reason: "TRANSFER_TICKETS_UNAVAILABLE" },
          },
        },
      },
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼或手輸張號加入",
    });
    await user.type(scan, "5164-1-056527-020-0-6{Enter}");
    await user.click(
      await screen.findByRole("button", { name: "加入選取(1 張)" }),
    );
    await screen.findByRole("table", { name: /^調貨明細/ });
    // 送出前這張被別人賣掉了
    server.use(
      api.query("LotteryTransferBookTickets", () =>
        HttpResponse.json({
          data: {
            lotteryTransferBookTickets: Array.from(
              { length: 100 },
              (_, index) => ({
                __typename: "LotteryTransferTicketCell" as const,
                ticketNo: String(index + 1).padStart(3, "0"),
                state: index === 19 ? "counter" : "available",
                unmatched: false,
                matchable: false,
                soldCashPointName: null,
                soldAt: null,
                cashPointName: index === 19 ? "店內櫃台" : null,
                lockedSerialNo: null,
              }),
            ),
          },
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "5164 發大財 · 056527:#020 現在是「在檯面上」,不能調。請先收回到庫存,或從這一列移除後再送出。",
        ),
      ).toBeInTheDocument();
    });
  });
});
