import { describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import { RECEIPT_LINK_MODULE_KEYS } from "@repo/domain/project/lottery";

import type { ModulesRepository } from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";
import { ReceiptLinksService } from "./receipt-links.service";

interface ModuleRow {
  _id: Types.ObjectId;
  key: string;
  route?: string;
  ancestors: Types.ObjectId[];
  enabled: boolean;
}

/** 只認得 `key: { $in }` 與 `_id: { $in }` 的模組表替身(模組是全域種子資料,不看操作者)。 */
const modulesOf = (rows: ModuleRow[]) =>
  ({
    findMany: (
      _operator: OperatorContext,
      filter: { key?: { $in: string[] }; _id?: { $in: Types.ObjectId[] } },
    ) =>
      Promise.resolve(
        rows.filter(
          (row) =>
            (filter.key === undefined || filter.key.$in.includes(row.key)) &&
            (filter._id === undefined ||
              filter._id.$in.some((id) => id.equals(row._id))),
        ),
      ),
  }) as unknown as ModulesRepository;

const row = (
  key: string,
  route: string | undefined,
  ancestors: ModuleRow[] = [],
  enabled = true,
): ModuleRow => ({
  _id: new Types.ObjectId(),
  key,
  ...(route === undefined ? {} : { route }),
  ancestors: ancestors.map((item) => item._id),
  enabled,
});

/** 店員:沒有帳戶管理、沒有叫貨與進貨(權限只有店面);路由仍要組得出來。 */
const clerk = {
  actorId: new Types.ObjectId(),
  permissions: new Set(["store.view", "api.printing.print"]),
} as unknown as OperatorContext;

describe("58mm 單據 QR code 的頁面路由(依模組樹,不依印單的人的權限)", () => {
  it("店員印的單據:即時現金帳、店面檢視頁、進貨單 / 調貨單檢視頁都組出完整路徑(祖先 route 段累加)", async () => {
    const accounts = row(RECEIPT_LINK_MODULE_KEYS.cashLedger, "accounts");
    const store = row("store", "store");
    const storeView = row(RECEIPT_LINK_MODULE_KEYS.storeView, "view-page", [
      store,
    ]);
    const purchasing = row("purchasing", "purchasing");
    const purchase = row("purchasing.purchase", "purchase", [purchasing]);
    const purchaseView = row(
      RECEIPT_LINK_MODULE_KEYS.purchaseView,
      "view-page",
      [purchasing, purchase],
    );
    const transfer = row("purchasing.transfer", "transfer", [purchasing]);
    const transferView = row(
      RECEIPT_LINK_MODULE_KEYS.transferView,
      "view-page",
      [purchasing, transfer],
    );
    const service = new ReceiptLinksService(
      modulesOf([
        accounts,
        store,
        storeView,
        purchasing,
        purchase,
        purchaseView,
        transfer,
        transferView,
      ]),
    );

    expect(await service.routes(clerk)).toEqual({
      cashLedger: "/accounts",
      storeView: "/store/view-page",
      purchaseView: "/purchasing/purchase/view-page",
      transferView: "/purchasing/transfer/view-page",
    });
  });

  it("模組或祖先停用、沒有 route、模組不存在 → null", async () => {
    const accounts = row(
      RECEIPT_LINK_MODULE_KEYS.cashLedger,
      "accounts",
      [],
      false,
    );
    const store = row("store", "store", [], false);
    const storeView = row(RECEIPT_LINK_MODULE_KEYS.storeView, "view-page", [
      store,
    ]);
    const service = new ReceiptLinksService(
      modulesOf([accounts, store, storeView]),
    );

    expect(await service.routes(clerk)).toEqual({
      cashLedger: null,
      storeView: null,
      purchaseView: null,
      transferView: null,
    });
  });

  it("寫入之後帶回的路由:讀模組出錯 → 不丟錯,回全部 null(單據照印、不印 QR)", async () => {
    const failing = {
      findMany: () => Promise.reject(new Error("modules unavailable")),
    } as unknown as ModulesRepository;
    const service = new ReceiptLinksService(failing);

    await expect(service.routes(clerk)).rejects.toThrow("modules unavailable");
    expect(await service.routesAfterWrite(clerk)).toEqual({
      cashLedger: null,
      storeView: null,
      purchaseView: null,
      transferView: null,
    });
  });
});
