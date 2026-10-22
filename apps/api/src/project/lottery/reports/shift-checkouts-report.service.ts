import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { CHECKOUT_TYPE } from "@repo/domain/project/lottery";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { OperatorContext } from "../../../database/operator-context";
import { FieldOptionsService } from "../../../fields/field-options.service";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { ScheduleEntryLookup } from "../../schedule/integration/entry-lookup";
import { StoreShiftViews } from "../store/shift-views";
import type {
  LotteryReportRangeInput,
  LotteryShiftCheckoutsReportInput,
} from "./dto/reports.input";
import type {
  LotteryReportCashPointModel,
  LotteryShiftCheckoutRowModel,
  LotteryShiftCheckoutsReportModel,
} from "./models/shift-checkouts-report.model";
import { PostCloseCorrections } from "./post-close-corrections";
import { ReportScopes, SHIFT_CHECKOUTS_RANGE } from "./report-scope";

/** 任務快照的崗位、執行任務名稱要讀的排班類別(底座 `FieldOptionsService` 的白名單)。 */
const SCHEDULE_LABEL_CATEGORIES: readonly string[] = [
  SCHEDULE_FIELD_CATEGORY_KEYS.position,
  SCHEDULE_FIELD_CATEGORY_KEYS.task,
];

/**
 * 班次結帳歷史報表(專案規格 11.3、14.9;正本 `docs/modules/project/reports.md`「班次結帳歷史報表」):
 * 期間內送出交班結帳的班(條件:分店、收銀點、只看有差額),一班一列。負責人 = 開班的人;協同從排班取得
 * (`ScheduleEntryLookup.helpersOfDemands`,依開班時的任務快照那筆人力需求);事後更正 = 那一班的全部事後更正淨額。
 */
@Injectable()
export class ShiftCheckoutsReportService {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly postClose: PostCloseCorrections,
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly views: StoreShiftViews,
    private readonly entryLookup: ScheduleEntryLookup,
    private readonly fieldOptions: FieldOptionsService,
  ) {}

  /** 條件的收銀點下拉:選的分店的收銀點(依分店、排序值、名稱)。 */
  async cashPointsOf(
    operator: OperatorContext,
    input: LotteryReportRangeInput,
  ): Promise<LotteryReportCashPointModel[]> {
    const scope = await this.scopes.scopeOf(
      operator,
      input,
      SHIFT_CHECKOUTS_RANGE,
    );
    const points = await this.cashPoints.findMany(
      scope.reader,
      { orgId: { $in: scope.storeIds } },
      { select: "orgId name order" },
    );
    const storeIndex = (orgId: Types.ObjectId) =>
      scope.storeIds.findIndex((id) => id.equals(orgId));
    return points
      .toSorted(
        (a, b) =>
          storeIndex(a.orgId) - storeIndex(b.orgId) ||
          a.order - b.order ||
          a.name.localeCompare(b.name, "zh-Hant"),
      )
      .map((point) => ({
        id: String(point._id),
        orgId: String(point.orgId),
        name: point.name,
      }));
  }

  async report(
    operator: OperatorContext,
    input: LotteryShiftCheckoutsReportInput,
  ): Promise<LotteryShiftCheckoutsReportModel> {
    const scope = await this.scopes.scopeOf(
      operator,
      input,
      SHIFT_CHECKOUTS_RANGE,
    );
    const cashPointId =
      input.cashPointId != null && Types.ObjectId.isValid(input.cashPointId)
        ? new Types.ObjectId(input.cashPointId)
        : null;
    const records = await this.checkouts.findMany(
      scope.reader,
      {
        orgId: { $in: scope.storeIds },
        type: CHECKOUT_TYPE.shift,
        submittedAt: { $gte: scope.from, $lt: scope.to },
        ...(cashPointId === null ? {} : { cashPointId }),
        ...(input.onlyWithDifference === true
          ? { difference: { $ne: 0 } }
          : {}),
      },
      { sort: { submittedAt: 1, _id: 1 } },
    );
    if (records.length === 0) {
      return { rows: [] };
    }
    const shiftIds = records.flatMap((row) =>
      row.shiftId === null ? [] : [row.shiftId],
    );
    const [shifts, points, stocktakes, corrections, labels] = await Promise.all(
      [
        this.shifts.findMany(scope.reader, { _id: { $in: shiftIds } }),
        this.cashPoints.findMany(
          scope.reader,
          { orgId: { $in: scope.storeIds } },
          { select: "name" },
        ),
        this.stocktakes.findMany(
          scope.reader,
          {
            _id: {
              $in: records.flatMap((row) =>
                row.stocktakeId === null ? [] : [row.stocktakeId],
              ),
            },
          },
          { select: "summary" },
        ),
        this.postClose.rowsOf(scope.reader, { shiftIds }),
        this.scheduleLabels(operator),
      ],
    );
    const shiftById = new Map(shifts.map((row) => [String(row._id), row]));
    const pointName = new Map(points.map((row) => [String(row._id), row.name]));
    const uncounted = new Map(
      stocktakes.map((row) => [String(row._id), row.summary.uncountedCount]),
    );
    const postCloseOf = new Map<string, number>();
    for (const row of corrections) {
      postCloseOf.set(
        row.shiftId,
        (postCloseOf.get(row.shiftId) ?? 0) + row.amount,
      );
    }
    const helpers = await this.entryLookup.helpersOfDemands(scope.reader, {
      tenantId: scope.tenantId,
      demandIds: shifts.flatMap((row) =>
        row.scheduleTaskSnapshot === null
          ? []
          : [row.scheduleTaskSnapshot.demandId],
      ),
    });
    const names = await this.views.userNames(operator, scope.tenantId, [
      ...shifts.map((row) => row.openedBy),
      ...[...helpers.values()].flat().map((id) => new Types.ObjectId(id)),
    ]);
    const storeIndex = (orgId: Types.ObjectId) =>
      scope.storeIds.findIndex((id) => id.equals(orgId));
    return {
      rows: records
        .toSorted(
          (a, b) =>
            storeIndex(a.orgId) - storeIndex(b.orgId) ||
            a.submittedAt.getTime() - b.submittedAt.getTime(),
        )
        .map((record): LotteryShiftCheckoutRowModel => {
          const shift = shiftById.get(String(record.shiftId));
          const snapshot = shift?.scheduleTaskSnapshot ?? null;
          const helperIds =
            snapshot === null ? [] : (helpers.get(snapshot.demandId) ?? []);
          return {
            checkoutId: String(record._id),
            orgId: String(record.orgId),
            cashPointId: String(record.cashPointId),
            cashPointName: pointName.get(String(record.cashPointId)) ?? "",
            openedAt: shift?.openedAt ?? record.submittedAt,
            submittedAt: record.submittedAt,
            leader:
              shift === undefined
                ? ""
                : (names.get(String(shift.openedBy)) ?? ""),
            helpers: helperIds
              .filter(
                (id) => shift === undefined || id !== String(shift.openedBy),
              )
              .map((id) => names.get(id) ?? ""),
            taskRole: snapshot?.role ?? null,
            taskPosition:
              snapshot === null
                ? null
                : (labels.positions.get(snapshot.positionKey) ??
                  snapshot.positionKey),
            taskName:
              snapshot === null
                ? null
                : (labels.tasks.get(snapshot.taskKey) ?? snapshot.taskKey),
            expected: record.expected,
            counted: record.counted,
            difference: record.difference,
            diffReason: reasonText(record.diffReason, record.diffReasonNote),
            postClose: postCloseOf.get(String(record.shiftId)) ?? 0,
            stocktakeMode: record.stocktakeMode,
            skipReason: reasonText(record.skipReason, record.skipReasonNote),
            uncountedBooks:
              record.stocktakeId === null
                ? 0
                : (uncounted.get(String(record.stocktakeId)) ?? 0),
            status: record.status,
          };
        }),
    };
  }

  /** 崗位、執行任務的名稱(欄位管理;停用的選項找不到 → 顯示代碼)。 */
  private async scheduleLabels(operator: OperatorContext): Promise<{
    positions: Map<string, string>;
    tasks: Map<string, string>;
  }> {
    const labelsOf = async (category: string) => {
      const options = await this.fieldOptions.optionsOf(
        operator,
        category,
        SCHEDULE_LABEL_CATEGORIES,
      );
      return new Map<string, string>(
        options.map((option) => [option.value, option.label]),
      );
    };
    const [positions, tasks] = await Promise.all([
      labelsOf(SCHEDULE_FIELD_CATEGORY_KEYS.position),
      labelsOf(SCHEDULE_FIELD_CATEGORY_KEYS.task),
    ]);
    return { positions, tasks };
  }
}

const reasonText = (
  reason: string | null,
  note: string | null,
): string | null => {
  if (reason === null) {
    return null;
  }
  return note === null || note === "" ? reason : `${reason}(${note})`;
};
