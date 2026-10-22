import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { Types } from "mongoose";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import {
  PermissionResolver,
  holdsPermission,
} from "../../../permission/permission-resolver";
import {
  type ReportRangeInput,
  type ReportRangeRule,
  assertReportRange,
} from "../../reports/report-range";
import { PeriodLock } from "../accounts/period-lock";

/** 報表模組的頁內權限(seed 正本 `apps/db-migrator/seeds/project/reports.ts`)。 */
export const REPORTS_PERMISSIONS = {
  operations: "reports.operations",
  shiftCheckouts: "reports.shift-checkouts",
  showCost: "reports.show-cost",
} as const;

/** 兩張報表的範圍限制(與 admin `report-registrations.ts` 的 `conditions` 同一組值)。 */
export const OPERATIONS_RANGE: ReportRangeRule = {
  allowed: ["day", "week", "month"],
  maxOrgs: 50,
};
export const SHIFT_CHECKOUTS_RANGE: ReportRangeRule = {
  allowed: ["day", "week", "month"],
  maxOrgs: 20,
};

/** 一次報表查詢的範圍:選的分店(照輸入順序、去重)、租戶、讀取身分。 */
export interface ReportScope {
  tenantId: Types.ObjectId;
  /** 租戶邊界的讀取身分:分店都已確認在操作者的可見範圍內,條件一律釘這些分店 */
  reader: OperatorContext;
  storeIds: Types.ObjectId[];
  from: Date;
  to: Date;
  timezone: string;
  /** 最後一個已關帳月份;沒關過 = null */
  lastClosed: { month: string; periodEnd: Date } | null;
  /** 操作者有沒有 `reports.show-cost` */
  canShowCost: boolean;
}

const notFound = (message: string): GraphQLError =>
  new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });

/**
 * 報表的範圍與讀取身分(專案規格 11.4;正本 `docs/modules/project/reports.md`「營運報表、班次結帳歷史報表」):
 *
 * 1. `assertReportRange`:期間類型、分店數、起訖長度(超過 → `RANGE_TOO_LARGE`)
 * 2. 每家分店都要在操作者的**可見範圍**內、而且同一個租戶(看不到 → `NOT_FOUND`)
 * 3. 之後的讀取用**租戶邊界上下文**、條件一律釘這些分店:報表要把同一家店的張數事件、現金流水、銀行交易、
 *    調貨點收(另一邊可能是別家店記的)放在一起算,不受各表的資料共用宣告影響(登記在
 *    `project/database/tenant-boundary-callers.ts`,用途「反查」)
 */
@Injectable()
export class ReportScopes {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly permissions: PermissionResolver,
    private readonly periodLock: PeriodLock,
  ) {}

  async scopeOf(
    operator: OperatorContext,
    input: ReportRangeInput,
    rule: ReportRangeRule,
  ): Promise<ReportScope> {
    assertReportRange(input, rule);
    const ids = [...new Set(input.orgIds)];
    const storeIds: Types.ObjectId[] = [];
    let tenantId: Types.ObjectId | null = null;
    for (const text of ids) {
      const id = Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null;
      const org =
        id === null || !isOrgVisible(operator, id)
          ? null
          : await this.orgs.findById(operator, id, { select: "ancestors" });
      const orgTenant =
        org === null
          ? null
          : tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
      if (
        id === null ||
        orgTenant === null ||
        (tenantId !== null && !tenantId.equals(orgTenant))
      ) {
        throw notFound(`store not found: ${text}`);
      }
      tenantId = orgTenant;
      storeIds.push(id);
    }
    if (tenantId === null) {
      throw notFound("store not found");
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const [timezone, lastClosed, canShowCost] = await Promise.all([
      tenantTimezoneOf(this.orgs, reader, tenantId),
      this.periodLock.lastClosed(tenantId),
      this.holds(operator, REPORTS_PERMISSIONS.showCost),
    ]);
    return {
      tenantId,
      reader,
      storeIds,
      from: new Date(input.from),
      to: new Date(input.to),
      timezone,
      lastClosed,
      canShowCost,
    };
  }

  private async holds(
    operator: OperatorContext,
    key: string,
  ): Promise<boolean> {
    if (operator.actorId === null) {
      return false;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return holdsPermission(resolution, key);
  }
}
