import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  FormSubmissionsRepository,
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryDealersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { type TenantOrg, isVisibleStore } from "./store-orgs";

export type { TenantOrg } from "./store-orgs";

const uniqueIds = (ids: readonly unknown[]): Types.ObjectId[] => [
  ...new Map(
    ids
      .filter((id) => id !== null && id !== undefined)
      .map(String)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => [id, new Types.ObjectId(id)]),
  ).values(),
];

/**
 * 庫存管理顯示用的名稱對照與組織樹(一批列一次查完)。
 *
 * - 組織(所在分店、責任分店、持有分店、分店清單):以租戶為邊界讀 —— 看得到本就看得到它在哪幾家店
 *   (可能是讀者看不到的分店;登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`,用途「反查」)
 * - 使用者名稱(事件的「誰」)、收銀點名稱(別店的張在別店的收銀點):同上,可能是別家分店的人 / 收銀點
 * - 經銷商、單據單號:照操作者自己的範圍讀,看不到的不顯示名稱
 */
@Injectable()
export class InventoryNames {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly dealers: LotteryDealersRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
  ) {}

  /** 操作者當前組織所在租戶的整棵組織樹(沒有租戶 → 空)。 */
  async tenantOrgs(operator: OperatorContext): Promise<TenantOrg[]> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null) {
      return [];
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.orgs.findMany(
      reader,
      { $or: [{ _id: tenantId }, { ancestors: tenantId }] },
      { sort: { name: 1 } },
    );
    return found.map((org) => ({
      id: org._id,
      name: org.name,
      parentId: org.parentId ?? null,
      ancestors: org.ancestors,
    }));
  }

  /**
   * 操作者看得到的**分店**:看得到的店(`isVisibleStore`,沒有下層組織),
   * 再加上 `withData`(有庫存或預計要給本數的組織,例:總部本身也是一家店)。依名稱排序。
   */
  storesOf(
    operator: OperatorContext,
    tenantOrgs: readonly TenantOrg[],
    withData: ReadonlySet<string> = new Set(),
  ): TenantOrg[] {
    return tenantOrgs
      .filter(
        (org) =>
          isVisibleStore(operator, org, tenantOrgs) ||
          (isOrgVisible(operator, org.id) && withData.has(String(org.id))),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  async orgNames(
    operator: OperatorContext,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (unique.length === 0 || tenantId === null) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.orgs.findMany(reader, { _id: { $in: unique } });
    return new Map(found.map((org) => [String(org._id), org.name]));
  }

  async userNames(
    operator: OperatorContext,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (unique.length === 0 || tenantId === null) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.users.findMany(reader, { _id: { $in: unique } });
    return new Map(found.map((user) => [String(user._id), user.name]));
  }

  async cashPointNames(
    operator: OperatorContext,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (unique.length === 0 || tenantId === null) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.cashPoints.findMany(reader, {
      _id: { $in: unique },
    });
    return new Map(found.map((point) => [String(point._id), point.name]));
  }

  /** 經銷商顯示名稱「姓名 #證號」(看不到的不回)。 */
  async dealerNames(
    operator: OperatorContext,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) {
      return new Map();
    }
    const found = await this.dealers.findMany(operator, {
      _id: { $in: unique },
    });
    return new Map(
      found.map((dealer) => [
        String(dealer._id),
        `${dealer.name} #${dealer.licenseNo}`,
      ]),
    );
  }

  /**
   * 單據單號(依事件的 `refId`;看不到或還沒有單號的不回):進貨單、調貨單是表單提交本身;盤點寫的事件
   * (待查、遺失、尋回)`refId` 是盤點單紀錄,單號取它帶的申請(盤點確認申請 / 結帳確認申請)。
   */
  async serialNos(
    operator: OperatorContext,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) {
      return new Map();
    }
    const stocktakes = await this.stocktakes.findMany(
      operator,
      { _id: { $in: unique } },
      { select: "submissionId" },
    );
    const submissionOf = new Map(
      stocktakes.map((record) => [String(record._id), record.submissionId]),
    );
    const found = await this.submissions.findMany(operator, {
      _id: { $in: [...unique, ...submissionOf.values()] },
    });
    const serialOf = new Map(
      found.flatMap((submission) =>
        submission.serialNo
          ? [[String(submission._id), submission.serialNo] as const]
          : [],
      ),
    );
    return new Map(
      unique.flatMap((id) => {
        const submissionId = submissionOf.get(String(id)) ?? id;
        const serialNo = serialOf.get(String(submissionId));
        return serialNo === undefined ? [] : [[String(id), serialNo] as const];
      }),
    );
  }
}
