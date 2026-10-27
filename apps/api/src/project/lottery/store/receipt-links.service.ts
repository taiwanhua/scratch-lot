import { Injectable, Logger } from "@nestjs/common";

import {
  RECEIPT_LINK_MODULE_KEYS,
  type ReceiptLinkKind,
} from "@repo/domain/project/lottery";

import { ModulesRepository } from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";

export type ReceiptLinks = Record<ReceiptLinkKind, string | null>;

/** 全部 null:單據照印、不印 QR。 */
const NO_ROUTES = Object.fromEntries(
  Object.keys(RECEIPT_LINK_MODULE_KEYS).map((kind) => [kind, null]),
) as ReceiptLinks;

/**
 * 58mm 單據 QR code 連到的頁面路由(規格第 12 章):依**模組樹**組完整路徑(`/` + 祖先的 route 段 + 自己那段,
 * 與 `PermissionResolver` 組 `me.modules[].route` 同一個規則),不依印單的人的權限 —— 店員印的投庫單,
 * 掃 QR 的是有帳戶管理的店長。模組是全域種子資料;模組或祖先停用、沒有 route → null。
 */
@Injectable()
export class ReceiptLinksService {
  private readonly logger = new Logger(ReceiptLinksService.name);

  constructor(private readonly modules: ModulesRepository) {}

  /**
   * 寫入**之後**一起帶回的路由(例:[完成這次點收]):寫入已經完成,讀路由出錯不能讓畫面看到錯誤 →
   * 記 log、回全部 null(單據照印、不印 QR)。
   */
  async routesAfterWrite(operator: OperatorContext): Promise<ReceiptLinks> {
    try {
      return await this.routes(operator);
    } catch (error) {
      this.logger.warn(
        `讀單據 QR 路由失敗,回全部 null:${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...NO_ROUTES };
    }
  }

  async routes(operator: OperatorContext): Promise<ReceiptLinks> {
    const keys = Object.values(RECEIPT_LINK_MODULE_KEYS);
    const targets = await this.modules.findMany(operator, {
      key: { $in: keys },
    });
    const ancestorIds = targets.flatMap((module) => module.ancestors);
    const ancestors =
      ancestorIds.length === 0
        ? []
        : await this.modules.findMany(operator, { _id: { $in: ancestorIds } });
    const byId = new Map(
      [...targets, ...ancestors].map((module) => [String(module._id), module]),
    );
    const routeOf = (key: string): string | null => {
      const module = targets.find((item) => item.key === key);
      if (module?.route === undefined || module.route === "") {
        return null;
      }
      const chain = module.ancestors.map((id) => byId.get(String(id)));
      if (!module.enabled || chain.some((item) => item?.enabled !== true)) {
        return null;
      }
      const segments = chain
        .map((item) => item?.route ?? "")
        .filter((segment) => segment !== "");
      return `/${[...segments, module.route].join("/")}`;
    };
    return {
      cashLedger: routeOf(RECEIPT_LINK_MODULE_KEYS.cashLedger),
      storeView: routeOf(RECEIPT_LINK_MODULE_KEYS.storeView),
      purchaseView: routeOf(RECEIPT_LINK_MODULE_KEYS.purchaseView),
      transferView: routeOf(RECEIPT_LINK_MODULE_KEYS.transferView),
    };
  }
}
