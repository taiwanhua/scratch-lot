import { Args, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { RequireTenant } from "../../tenant-scope/require-tenant.decorator";
import {
  LotteryOperationsReportInput,
  LotteryReportRangeInput,
  LotteryShiftCheckoutsReportInput,
} from "./dto/reports.input";
import {
  LotteryOperationsReportModel,
  LotteryReportPeriodsModel,
} from "./models/operations-report.model";
import {
  LotteryReportCashPointModel,
  LotteryShiftCheckoutsReportModel,
} from "./models/shift-checkouts-report.model";
import { OperationsReportService } from "./operations-report.service";
import { REPORTS_PERMISSIONS } from "./report-scope";
import { ShiftCheckoutsReportService } from "./shift-checkouts-report.service";

/**
 * 輸出報表的兩張報表(專案規格第 11 章;正本 `docs/modules/project/reports.md`「營運報表、班次結帳歷史報表」):
 * 每張報表一條頁內權限守門(`reports.operations` / `reports.shift-checkouts`);成本與毛利另看
 * `reports.show-cost`(service 內判斷,沒有就回 null)。唯讀,不寫稽核。根組織要先切進租戶(`@RequireTenant()`)。
 */
@RequireTenant()
@Resolver()
export class LotteryReportsResolver {
  constructor(
    private readonly operations: OperationsReportService,
    private readonly shiftCheckouts: ShiftCheckoutsReportService,
  ) {}

  @RequirePermission(REPORTS_PERMISSIONS.operations)
  @Query(() => LotteryOperationsReportModel, {
    name: "lotteryOperationsReport",
  })
  lotteryOperationsReport(
    @Args("input") input: LotteryOperationsReportInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryOperationsReportModel> {
    return this.operations.report(operator, input);
  }

  /** 條件畫面:對齊日結的逐店實際期間(RE-01)、已關帳到哪(RE-03 月份格子)。 */
  @RequirePermission(REPORTS_PERMISSIONS.operations)
  @Query(() => LotteryReportPeriodsModel, {
    name: "lotteryOperationsReportPeriods",
  })
  lotteryOperationsReportPeriods(
    @Args("input") input: LotteryOperationsReportInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryReportPeriodsModel> {
    return this.operations.periodsOf(operator, input);
  }

  @RequirePermission(REPORTS_PERMISSIONS.shiftCheckouts)
  @Query(() => LotteryShiftCheckoutsReportModel, {
    name: "lotteryShiftCheckoutsReport",
  })
  lotteryShiftCheckoutsReport(
    @Args("input") input: LotteryShiftCheckoutsReportInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryShiftCheckoutsReportModel> {
    return this.shiftCheckouts.report(operator, input);
  }

  /** 條件的收銀點下拉(選的分店的收銀點)。 */
  @RequirePermission(REPORTS_PERMISSIONS.shiftCheckouts)
  @Query(() => [LotteryReportCashPointModel], {
    name: "lotteryShiftCheckoutsReportCashPoints",
  })
  lotteryShiftCheckoutsReportCashPoints(
    @Args("input") input: LotteryReportRangeInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<LotteryReportCashPointModel[]> {
    return this.shiftCheckouts.cashPointsOf(operator, input);
  }
}
