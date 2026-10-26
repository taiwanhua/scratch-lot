import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  INVENTORY_PERMISSIONS,
  STOCKTAKE_REASONS,
  STOCKTAKE_STATUS,
  STORE_PERMISSIONS,
  type StocktakeDraft,
  type StocktakeStatus,
  type StocktakeType,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketStatus,
  displayTicketKey,
  parseStocktakeDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { FieldOptionsService } from "../../../fields/field-options.service";
import type { FormGuardResult } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryTicketsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import type {
  StocktakeDiffRow,
  StocktakeLine,
  StocktakeLostReviewLine,
  StocktakeSummary,
  StocktakeUncountedBook,
  StocktakeUnopenedLine,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { type StoreRef, StoreSalesSupport } from "../store/store-sales-support";
import { ticketRefsOf } from "../store/store-sales.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type {
  BackfillLotteryStocktakeSalesInput,
  LotteryStocktakeReviewInput,
} from "./dto/stocktake.input";
import type {
  LotteryStocktakeBackfillModel,
  LotteryStocktakeReviewModel,
} from "./models/stocktake.model";
import {
  alreadyProcessedError,
  forbiddenError,
  notFoundError,
  validationError,
} from "./stocktake-error";
import { type LineEvaluation, StocktakeFacts } from "./stocktake-facts";
import { summaryModelOf } from "./stocktake-query.service";
import { draftOfValues } from "./stocktake-values";

/** 送出盤點的選項(臨時盤點 = 盤點確認申請;交班 / 日結 = 結帳確認申請)。 */
export interface SubmitStocktakeOptions {
  type: StocktakeType;
  /** 帶盤點的那張申請(一張申請一筆盤點單;退回後再送出改寫同一筆)。 */
  submissionId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  /** 送出的人(申請人)。 */
  submittedBy: Types.ObjectId | null;
}

/** 組好的盤點單內容(送出 / 送出前檢查共用)。 */
interface BuiltStocktake {
  lines: StocktakeLine[];
  unopenedLines: StocktakeUnopenedLine[];
  lostReviewLines: StocktakeLostReviewLine[];
  /** 範圍內還沒盤的本(不比對;沒盤完可以送出)。 */
  uncountedBooks: StocktakeUncountedBook[];
  summary: StocktakeSummary;
  stale: string[];
  unhandled: string[];
}

const REF_TYPE = "stocktake";

const block = (code: string, message: string): FormGuardResult => ({
  code,
  message,
});

/**
 * 盤點(專案規格 6.8、8.6、7.4、第 17 章第 1、2、3、6 題;正本 `docs/modules/project/store.md`「盤點」):
 *
 * - `review`:差異核對 / 送出前檢查(每本與 `countedAt` 那一刻比對;已被處理的列為 stale)
 * - `backfill`:[補登售出] **立即生效**(和看板手動標記售出相同):那個收銀點開著的班 → 算那一班;
 *   沒有開著的班 → 記成那個收銀點最近一班的事後更正(`postCloseOf`)。帳本條件更新,兩人同時只一個成功
 * - **給表單掛接點 / 交班、日結的介面**:`checkSubmit`(送出前守門)、`submitStocktakeDraft`(在申請的同一個
 *   交易建立 / 改寫盤點單)、`markStatus`(退回 / 駁回)、`apply`(核准完成時套用庫存變動)
 */
@Injectable()
export class StocktakeService {
  constructor(
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly orgs: OrgsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly workflowTasks: WorkflowTasksRepository,
    private readonly facts: StocktakeFacts,
    private readonly ledger: TicketLedgerService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  // ---- 差異核對 ----

  async review(
    operator: OperatorContext,
    input: LotteryStocktakeReviewInput,
  ): Promise<LotteryStocktakeReviewModel> {
    const grant = await this.access.assertView(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.stocktake}`);
    }
    const parsed = parseStocktakeDraft(input.draft);
    if (!parsed.ok) {
      throw validationError(
        "stocktake draft is invalid",
        ["draft"],
        STOCKTAKE_REASONS.invalid,
      );
    }
    const store = await this.support.mustStore(operator, parsed.draft.orgId);
    const evaluations = await this.facts.evaluate(
      operator,
      store.orgId,
      parsed.draft,
    );
    const built = await this.build(operator, store, parsed.draft, evaluations);
    const points = await this.support.cashPointsOf(operator, store.orgId);
    const games = await this.support.gamesOf(
      operator,
      evaluations.flatMap((item) =>
        item.book === null ? [] : [item.book.gameId],
      ),
    );
    return {
      lines: evaluations.flatMap((item) => {
        if (item.book === null) {
          return [];
        }
        const game = games.get(String(item.book.gameId));
        return [
          {
            bookId: String(item.book._id),
            cashPointId: item.line.cashPointId,
            cashPointName: points.get(item.line.cashPointId)?.name ?? "",
            gameCode: item.book.gameCode,
            gameName: game?.name ?? "",
            bookNo: item.book.bookNo,
            unitPrice: game?.unitPrice ?? 0,
            systemCount: item.systemCount,
            presentCount: item.line.presentTicketNos.length,
            diffs: item.diffs.map((diff) => ({
              ticketId: diff.ticketId,
              ticketNo: diff.ticketNo,
              version: item.ticketById.get(diff.ticketId)?.version ?? 0,
              kind: diff.kind,
              backfilled: diff.backfilled,
            })),
            pendingReversalTicketNos: item.pendingReversalNos,
            staleTicketNos: item.stale,
          },
        ];
      }),
      staleCount: built.stale.length,
      unhandledCount: built.unhandled.length,
      summary: summaryModelOf(
        built.summary,
        grant.has(INVENTORY_PERMISSIONS.showCost),
      ),
    };
  }

  // ---- 補登售出(立即生效) ----

  async backfill(
    operator: OperatorContext,
    input: BackfillLotteryStocktakeSalesInput,
  ): Promise<LotteryStocktakeBackfillModel[]> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.stocktake}`);
    }
    const refs = ticketRefsOf(input.tickets);
    const store = await this.support.mustStore(operator, input.orgId);
    try {
      return await this.transactions.withTransaction((session) =>
        this.writeBackfill(session, operator, store, refs),
      );
    } catch (error) {
      if (
        error instanceof GraphQLError &&
        error.extensions.code === "CONFLICT"
      ) {
        throw alreadyProcessedError(refs.map((ref) => String(ref.id)));
      }
      throw error;
    }
  }

  private async writeBackfill(
    session: ClientSession,
    operator: OperatorContext,
    store: StoreRef,
    refs: readonly { id: Types.ObjectId; version: number }[],
  ): Promise<LotteryStocktakeBackfillModel[]> {
    const now = this.clock.now();
    const found = await this.tickets.findMany(
      operator,
      { _id: { $in: refs.map((ref) => ref.id) }, orgId: store.orgId },
      { session },
    );
    const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
    const games = await this.support.gamesOf(
      operator,
      found.map((ticket) => ticket.gameId),
    );
    const targets = new Map<
      string,
      { shiftId: Types.ObjectId; postClose: boolean }
    >();
    const events: TicketEventInput[] = [];
    const rows: Omit<LotteryStocktakeBackfillModel, "eventId">[] = [];
    for (const ref of refs) {
      const ticket = byId.get(String(ref.id));
      const pointId = ticket?.location.cashPointId ?? null;
      // 不是本店檯面上未售的張(已被處理)→ 已被處理
      if (
        ticket?.version !== ref.version ||
        ticket.status !== TICKET_STATUS.unsold ||
        ticket.location.kind !== TICKET_LOCATION_KIND.counter ||
        pointId === null
      ) {
        throw alreadyProcessedError([String(ref.id)]);
      }
      const game = games.get(String(ticket.gameId));
      if (game === undefined) {
        throw notFoundError(`game not found for ticket ${String(ticket._id)}`);
      }
      const target =
        targets.get(String(pointId)) ??
        (await this.backfillTarget(session, operator, pointId));
      targets.set(String(pointId), target);
      events.push({
        ticketId: ticket._id,
        expectedVersion: ref.version,
        expectedStatuses: [TICKET_STATUS.unsold],
        type: TICKET_EVENT_TYPE.saleStocktake,
        at: now,
        patch: {
          status: TICKET_STATUS.sold,
          sold: { at: now, source: "stocktake" },
        },
        amount: game.unitPrice,
        cashEffect: "increase",
        cashPointId: pointId,
        shiftId: target.shiftId,
        postCloseOf: target.postClose ? target.shiftId : null,
        refType: REF_TYPE,
      });
      rows.push({
        ticketId: String(ticket._id),
        ticketNo: ticket.ticketNo,
        amount: game.unitPrice,
        cashPointId: String(pointId),
        shiftId: String(target.shiftId),
        postClose: target.postClose,
      });
    }
    const results = await this.ledger.applyTicketEvents(
      session,
      { operator },
      events,
    );
    await this.support.publish(store);
    return rows.map((row, index) => ({
      ...row,
      eventId: results[index]?.eventId ?? "",
    }));
  }

  /**
   * 補登售出算到哪一班:那個收銀點開著的班(鎖住抽屜,和投庫 / 售出序列化)→ 那一班;沒有 → 最近一班的事後更正;
   * 從來沒開過班 → 擋下(沒有班可以記)。
   */
  private async backfillTarget(
    session: ClientSession,
    operator: OperatorContext,
    cashPointId: Types.ObjectId,
  ): Promise<{ shiftId: Types.ObjectId; postClose: boolean }> {
    const open = await this.shifts.findOne(
      operator,
      { cashPointId, closedAt: null },
      { session },
    );
    if (open !== null) {
      const locked = await this.support.lockDrawer(operator, open._id);
      if (locked !== null) {
        return { shiftId: open._id, postClose: false };
      }
    }
    const last = await this.shifts.findOne(
      operator,
      { cashPointId },
      { session, sort: { openedAt: -1 } },
    );
    if (last === null) {
      throw validationError(
        "this cash point has never had a shift",
        ["tickets"],
        STOCKTAKE_REASONS.noShift,
      );
    }
    return { shiftId: last._id, postClose: last.closedAt !== null };
  }

  // ---- 掛接點 / 交班、日結的介面 ----

  /**
   * 送出前守門(`beforeSubmit`,只讀):盤點內容讀得懂、分店一致;有 `store.stocktake`(確認遺失另要
   * `store.confirm-lost`,原因必填);每筆差異都已處理、而且還對得到(已被處理 → `STOCKTAKE_DIFF_STALE`)。
   */
  async checkSubmit(
    operator: OperatorContext,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const draft = draftOfValues(values);
    if (draft === null) {
      return block(STOCKTAKE_REASONS.invalid, "stocktake draft is invalid");
    }
    return this.checkDraft(operator, draft);
  }

  /** 交班 / 日結的結帳確認申請也用:盤點內容 → 守門結果。 */
  async checkDraft(
    operator: OperatorContext,
    draft: StocktakeDraft,
  ): Promise<FormGuardResult> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.stocktake)) {
      return block(STOCKTAKE_REASONS.forbidden, "missing store.stocktake");
    }
    const lost = draft.lostReview.filter((item) => item.action === "lost");
    if (lost.length > 0 && !grant.has(STORE_PERMISSIONS.confirmLost)) {
      return block(STOCKTAKE_REASONS.forbidden, "missing store.confirm-lost");
    }
    // 同一組原因只檢查一次(遺失清單常整批同一個原因;不逐張讀選項)
    const reasons = new Map(
      lost.map((item) => {
        const reason = {
          reasonKey: item.reasonKey ?? null,
          reasonNote: item.reasonNote ?? null,
        };
        return [JSON.stringify(reason), reason] as const;
      }),
    );
    for (const reason of reasons.values()) {
      try {
        await this.fieldOptions.assertReason(
          operator,
          LOTTERY_FIELD_CATEGORY_KEYS.lostReason,
          reason,
          LOTTERY_FIELD_CATEGORIES,
        );
      } catch {
        return block(STOCKTAKE_REASONS.invalid, "lost reason is required");
      }
    }
    const storeId = parseId(draft.orgId);
    if (storeId === null) {
      return block(STOCKTAKE_REASONS.invalid, "invalid store");
    }
    const store = await this.support.mustStore(operator, draft.orgId);
    const evaluations = await this.facts.evaluate(operator, store.orgId, draft);
    const built = await this.build(operator, store, draft, evaluations);
    if (built.stale.length > 0) {
      return block(
        STOCKTAKE_REASONS.stale,
        `already processed: ${built.stale.join(", ")}`,
      );
    }
    if (built.unhandled.length > 0) {
      return block(
        STOCKTAKE_REASONS.unhandled,
        `unhandled differences: ${built.unhandled.join(", ")}`,
      );
    }
    return null;
  }

  /**
   * **交班 / 日結的盤點介面**:在申請的同一個交易建立(或退回後改寫)盤點單 = 待核准。再比對一次;
   * 已被處理 / 還有沒處理的差異 → 拋錯(整個送出回復)。系統身分以租戶邊界讀(掛接點沒有操作者的範圍)。
   */
  async submitStocktakeDraft(
    session: ClientSession,
    draft: StocktakeDraft,
    options: SubmitStocktakeOptions,
  ): Promise<void> {
    const storeId = parseId(draft.orgId);
    if (storeId === null) {
      throw validationError(
        "invalid store",
        ["draft"],
        STOCKTAKE_REASONS.invalid,
      );
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      null,
      options.tenantId,
    );
    const store: StoreRef = { orgId: storeId, tenantId: options.tenantId };
    const evaluations = await this.facts.evaluate(
      reader,
      storeId,
      draft,
      session,
    );
    const built = await this.build(reader, store, draft, evaluations, session);
    if (built.stale.length > 0 || built.unhandled.length > 0) {
      throw validationError(
        "stocktake differences changed",
        ["draft"],
        built.stale.length > 0
          ? STOCKTAKE_REASONS.stale
          : STOCKTAKE_REASONS.unhandled,
        { ticketNos: [...built.stale, ...built.unhandled] },
      );
    }
    // 退回後再送出改寫同一筆:`orgId` 不在 `$set` 裡(一般更新不得變更所屬組織;分店本來就不會換)
    const content = {
      type: options.type,
      status: STOCKTAKE_STATUS.pending,
      scopeCashPointId: parseId(draft.scopeCashPointId ?? ""),
      startedAt: new Date(draft.startedAt),
      submittedBy: options.submittedBy,
      submittedAt: this.clock.now(),
      confirmedAt: null,
      confirmedBy: null,
      lines: built.lines,
      unopenedLines: built.unopenedLines,
      lostReviewLines: built.lostReviewLines,
      uncountedBooks: built.uncountedBooks,
      summary: built.summary,
    };
    const existing = await this.stocktakes.findOne(
      reader,
      { submissionId: options.submissionId },
      { session },
    );
    if (existing === null) {
      await this.stocktakes.create(
        reader,
        {
          ...content,
          orgId: storeId,
          submissionId: options.submissionId,
          version: 0,
        },
        { session },
      );
      return;
    }
    await this.stocktakes.findOneAndUpdate(
      reader,
      { _id: existing._id, version: existing.version },
      { $set: content, $inc: { version: 1 } },
      { session },
    );
  }

  /** 盤點確認申請送出(`submitted`):讀申請的盤點內容,在同一個交易建立盤點單(臨時盤點)。 */
  async submitFromSubmission(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findById(reader, submissionId, {
      session,
    });
    const draft = submission === null ? null : draftOfValues(submission.values);
    if (submission === null || draft === null) {
      throw validationError(
        "stocktake draft is invalid",
        ["draft"],
        STOCKTAKE_REASONS.invalid,
      );
    }
    await this.submitStocktakeDraft(session, draft, {
      type: "adhoc",
      submissionId,
      tenantId,
      submittedBy: submission.createdBy ?? null,
    });
  }

  /** 退回(→ 已退回,打開時帶入原內容)/ 駁回(→ 已駁回;補登的售出不退)。 */
  async markStatus(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
    status: Exclude<StocktakeStatus, "pending" | "confirmed">,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    await this.stocktakes.findOneAndUpdate(
      reader,
      { submissionId, status: STOCKTAKE_STATUS.pending },
      { $set: { status }, $inc: { version: 1 } },
      { session },
    );
  }

  /**
   * 核准完成:套用庫存變動(依時間順序,各張以目前的版本條件更新;已不是要的狀態 → 略過):
   * 差異 [待查]、未拆的本不在 → 待查(責任分店 = 本店);待查清單 確認遺失 → 遺失、找到了 → 尋回(回到本店庫存);
   * 標記異常只做記號。盤點單 → 已確認。
   */
  async apply(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const record = await this.stocktakes.findOne(
      reader,
      { submissionId, status: STOCKTAKE_STATUS.pending },
      { session },
    );
    if (record === null || tenantId === null) {
      return;
    }
    const investigateLines = record.lines.flatMap((line) =>
      line.diffs
        .filter((diff) => diff.action === "investigate")
        .map((diff) => ({ ticketId: diff.ticketId, after: line.countedAt })),
    );
    const investigate = investigateLines.map((entry) => entry.ticketId);
    const absentBooks = record.unopenedLines
      .filter((line) => !line.present)
      .map((line) => line.bookId);
    const unopened =
      absentBooks.length === 0
        ? []
        : await this.tickets.findMany(
            reader,
            {
              bookId: { $in: absentBooks },
              orgId: record.orgId,
              status: TICKET_STATUS.unsold,
              "location.kind": TICKET_LOCATION_KIND.stock,
            },
            { session },
          );
    const lost = record.lostReviewLines.filter(
      (line) => line.action === "lost",
    );
    const found = record.lostReviewLines.filter(
      (line) => line.action === "found",
    );
    const ids = [
      ...investigate,
      ...unopened.map((ticket) => ticket._id),
      ...lost.map((line) => line.ticketId),
      ...found.map((line) => line.ticketId),
    ];
    const current = await this.tickets.findMany(
      reader,
      { _id: { $in: ids } },
      { session },
    );
    const byId = new Map(current.map((ticket) => [String(ticket._id), ticket]));
    // 盤點之後被別的盤點或操作動過的張不套用(舊盤點晚完成不覆蓋新的結果)
    const changed = await this.facts.changedAfter(
      reader,
      [
        ...investigateLines,
        ...[
          ...unopened.map((ticket) => ticket._id),
          ...lost.map((line) => line.ticketId),
          ...found.map((line) => line.ticketId),
        ].map((ticketId) => ({ ticketId, after: record.startedAt })),
      ],
      { session },
    );
    const at = this.clock.now();
    const events: TicketEventInput[] = [];
    const push = (
      ticketId: Types.ObjectId,
      expected: readonly TicketStatus[],
      build: Pick<
        TicketEventInput,
        "type" | "patch" | "reasonKey" | "reasonNote"
      >,
    ) => {
      const ticket = byId.get(String(ticketId));
      if (
        ticket?.lockedBy !== null ||
        changed.has(String(ticketId)) ||
        !expected.includes(ticket.status) ||
        events.some((event) => event.ticketId.equals(ticketId))
      ) {
        return;
      }
      events.push({
        ticketId,
        expectedVersion: ticket.version,
        expectedStatuses: [...expected],
        at,
        refType: REF_TYPE,
        refId: record._id,
        ...build,
      });
    };
    for (const ticketId of [
      ...investigate,
      ...unopened.map((ticket) => ticket._id),
    ]) {
      push(ticketId, [TICKET_STATUS.unsold], {
        type: TICKET_EVENT_TYPE.investigate,
        patch: {
          status: TICKET_STATUS.investigating,
          responsibleOrgId: record.orgId,
        },
      });
    }
    for (const line of lost) {
      push(line.ticketId, [TICKET_STATUS.investigating], {
        type: TICKET_EVENT_TYPE.lose,
        patch: { status: TICKET_STATUS.lost },
        reasonKey: line.reasonKey,
        reasonNote: line.reasonNote,
      });
    }
    for (const line of found) {
      push(line.ticketId, [TICKET_STATUS.investigating, TICKET_STATUS.lost], {
        type: TICKET_EVENT_TYPE.recover,
        patch: {
          status: TICKET_STATUS.unsold,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          responsibleOrgId: null,
        },
      });
    }
    await this.ledger.applyTicketEvents(
      session,
      { operator: null, crossStoreTenantId: tenantId },
      events,
    );
    await this.stocktakes.findOneAndUpdate(
      reader,
      { _id: record._id, version: record.version },
      {
        $set: {
          status: STOCKTAKE_STATUS.confirmed,
          confirmedAt: at,
          confirmedBy: await this.approverOf(tenantId, submissionId, session),
        },
        $inc: { version: 1 },
      },
      { session },
    );
  }

  /**
   * 核准的人:這張申請目前的流程實例裡已核准的任務,依決定時間取最後一筆的審核者;
   * 沒有(申請人是審核者、自動通過沒有留任務)= 申請人。
   */
  private async approverOf(
    tenantId: Types.ObjectId,
    submissionId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId | null> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findById(reader, submissionId, {
      session,
    });
    const instanceId = submission?.currentInstanceId ?? null;
    const [last] =
      instanceId === null
        ? []
        : await this.workflowTasks.findMany(
            tenantId,
            { instanceId, status: "approved" },
            { sort: { decidedAt: -1 }, limit: 1 },
          );
    return last?.assigneeId ?? submission?.createdBy ?? null;
  }

  // ---- 組盤點單 ----

  private async build(
    reader: OperatorContext,
    store: StoreRef,
    draft: StocktakeDraft,
    evaluations: readonly LineEvaluation[],
    session?: ClientSession,
  ): Promise<BuiltStocktake> {
    const options = session === undefined ? {} : { session };
    const games = await this.support.gamesOf(
      reader,
      evaluations.flatMap((item) =>
        item.book === null ? [] : [item.book.gameId],
      ),
    );
    const stale: string[] = [];
    const unhandled: string[] = [];
    const lines: StocktakeLine[] = [];
    const postCloseOf = await this.postCloseShifts(
      reader,
      evaluations,
      options,
    );
    for (const item of evaluations) {
      if (item.book === null || item.cashPointId === null) {
        stale.push(...item.line.diffs.map((diff) => diff.ticketNo));
        continue;
      }
      const game = games.get(String(item.book.gameId));
      stale.push(...item.stale.map((no) => `${item.book?.bookNo ?? ""}#${no}`));
      unhandled.push(
        ...item.unhandled.map((no) => `${item.book?.bookNo ?? ""}#${no}`),
      );
      const actionOf = new Map(
        item.line.diffs.map((diff) => [diff.ticketNo, diff]),
      );
      const diffs: StocktakeDiffRow[] = item.diffs.flatMap((diff) => {
        const chosen = actionOf.get(diff.ticketNo);
        if (chosen === undefined) {
          return [];
        }
        return [
          {
            ticketId: new Types.ObjectId(diff.ticketId),
            ticketNo: diff.ticketNo,
            kind: diff.kind,
            action: chosen.action,
            eventId:
              chosen.action === "sale_backfill"
                ? (chosen.eventId ?? null)
                : null,
            postClose:
              chosen.action === "sale_backfill" &&
              typeof chosen.eventId === "string" &&
              postCloseOf.has(chosen.eventId),
            amount:
              chosen.action === "sale_backfill" ? (game?.unitPrice ?? 0) : 0,
          },
        ];
      });
      lines.push({
        bookId: item.book._id,
        gameCode: item.book.gameCode,
        gameName: game?.name ?? "",
        bookNo: item.book.bookNo,
        cashPointId: item.cashPointId,
        countedAt: new Date(item.line.countedAt),
        method: item.line.method,
        systemCount: item.systemCount,
        presentTicketNos: [...item.line.presentTicketNos],
        diffs,
      });
    }
    const unopenedLines = await this.unopenedLinesOf(
      reader,
      store,
      draft,
      options,
    );
    const lostReviewLines = await this.lostReviewLinesOf(
      reader,
      store,
      draft,
      options,
    );
    const uncountedBooks = await this.uncountedBooksOf(
      reader,
      store,
      draft,
      lines,
      options,
    );
    const all = lines.flatMap((line) => line.diffs);
    const backfilled = all.filter((diff) => diff.action === "sale_backfill");
    const lostLines = lostReviewLines.filter((line) => line.action === "lost");
    return {
      lines,
      unopenedLines,
      lostReviewLines,
      uncountedBooks,
      stale,
      unhandled,
      summary: {
        uncountedCount: uncountedBooks.length,
        books: lines.length,
        backfillCount: backfilled.length,
        backfillAmount: backfilled.reduce((sum, diff) => sum + diff.amount, 0),
        newInvestigate:
          all.filter((diff) => diff.action === "investigate").length +
          unopenedLines
            .filter((line) => !line.present)
            .reduce((sum, line) => sum + line.ticketCount, 0),
        flagged: all.filter((diff) => diff.action === "flag").length,
        confirmLost: lostLines.length,
        confirmLostCost: Math.round(
          lostLines.reduce((sum, line) => sum + line.unitCost, 0),
        ),
      },
    };
  }

  /**
   * 送出時盤點範圍內還沒盤的本(使用者 2026-10-21 定案:沒盤完可以送出,盤點單記下沒盤的本):範圍 = 單一收銀點
   * 或全店啟用中的收銀點,檯面上還有未售的張的本(和盤點頁列的本相同;售完的不必盤),扣掉盤點內容裡已盤的
   * 本 × 收銀點。不比對、不記差異;退回後再送出時重算。依收銀點順序、遊戲、本號排。
   */
  private async uncountedBooksOf(
    reader: OperatorContext,
    store: StoreRef,
    draft: StocktakeDraft,
    lines: readonly StocktakeLine[],
    options: { session?: ClientSession },
  ): Promise<StocktakeUncountedBook[]> {
    const scopeId = parseId(draft.scopeCashPointId ?? "");
    const allPoints = await this.support.cashPointsOf(reader, store.orgId);
    const points = [...allPoints.values()]
      .filter((point) => scopeId === null || point._id.equals(scopeId))
      .toSorted((a, b) => a.order - b.order);
    if (points.length === 0) {
      return [];
    }
    const rows = await this.tickets.aggregate(
      reader,
      [
        {
          $match: {
            orgId: store.orgId,
            status: TICKET_STATUS.unsold,
            "location.kind": TICKET_LOCATION_KIND.counter,
            "location.cashPointId": { $in: points.map((point) => point._id) },
          },
        },
        {
          $group: {
            _id: { bookId: "$bookId", cashPointId: "$location.cashPointId" },
          },
        },
      ],
      options,
    );
    const counted = new Set(
      lines.map((line) => `${String(line.bookId)}:${String(line.cashPointId)}`),
    );
    const pending = rows.flatMap((row) => {
      const key = row._id as {
        bookId: Types.ObjectId;
        cashPointId: Types.ObjectId;
      };
      return counted.has(`${String(key.bookId)}:${String(key.cashPointId)}`)
        ? []
        : [key];
    });
    if (pending.length === 0) {
      return [];
    }
    const books = await this.facts.booksOf(
      reader,
      pending.map((key) => key.bookId),
      options,
    );
    const games = await this.support.gamesOf(
      reader,
      [...books.values()].map((book) => book.gameId),
    );
    const order = new Map(
      points.map((point, index) => [String(point._id), index]),
    );
    return pending
      .flatMap((key) => {
        const book = books.get(String(key.bookId));
        return book === undefined
          ? []
          : [
              {
                bookId: book._id,
                gameCode: book.gameCode,
                gameName: games.get(String(book.gameId))?.name ?? "",
                bookNo: book.bookNo,
                cashPointId: key.cashPointId,
              },
            ];
      })
      .toSorted(
        (a, b) =>
          (order.get(String(a.cashPointId)) ?? 0) -
            (order.get(String(b.cashPointId)) ?? 0) ||
          a.gameCode.localeCompare(b.gameCode) ||
          a.bookNo.localeCompare(b.bookNo),
      );
  }

  /** 補登售出的事件中,記成事後更正的那幾筆(事件 id)。 */
  private async postCloseShifts(
    reader: OperatorContext,
    evaluations: readonly LineEvaluation[],
    options: { session?: ClientSession },
  ): Promise<Set<string>> {
    const ids = evaluations.flatMap((item) =>
      item.line.diffs.flatMap((diff) =>
        typeof diff.eventId === "string" ? [diff.eventId] : [],
      ),
    );
    if (ids.length === 0) {
      return new Set();
    }
    const events = await this.facts.eventsByIds(reader, ids, options);
    return new Set(
      events
        .filter((event) => event.postCloseOf !== null)
        .map((event) => event.eventId),
    );
  }

  private async unopenedLinesOf(
    reader: OperatorContext,
    store: StoreRef,
    draft: StocktakeDraft,
    options: { session?: ClientSession },
  ): Promise<StocktakeUnopenedLine[]> {
    const bookIds = draft.unopened.flatMap((item) => {
      const bookId = parseId(item.bookId);
      return bookId === null ? [] : [bookId];
    });
    const books = await this.facts.booksOf(reader, bookIds, options);
    if (books.size === 0) {
      return [];
    }
    // 每本在本店庫存的未售張數:一次讀完再數(不逐本 count)
    const unsold = await this.tickets.findMany(
      reader,
      {
        bookId: { $in: [...books.values()].map((book) => book._id) },
        orgId: store.orgId,
        status: TICKET_STATUS.unsold,
        "location.kind": TICKET_LOCATION_KIND.stock,
      },
      { ...options, select: "bookId" },
    );
    const countOf = new Map<string, number>();
    for (const ticket of unsold) {
      const key = String(ticket.bookId);
      countOf.set(key, (countOf.get(key) ?? 0) + 1);
    }
    const games = await this.support.gamesOf(
      reader,
      [...books.values()].map((book) => book.gameId),
    );
    const lines: StocktakeUnopenedLine[] = [];
    for (const item of draft.unopened) {
      const bookId = parseId(item.bookId);
      const book = bookId === null ? undefined : books.get(String(bookId));
      if (book === undefined) {
        continue;
      }
      lines.push({
        bookId: book._id,
        gameCode: book.gameCode,
        gameName: games.get(String(book.gameId))?.name ?? "",
        bookNo: book.bookNo,
        ticketCount: countOf.get(String(book._id)) ?? 0,
        present: item.present,
      });
    }
    return lines;
  }

  private async lostReviewLinesOf(
    reader: OperatorContext,
    store: StoreRef,
    draft: StocktakeDraft,
    options: { session?: ClientSession },
  ): Promise<StocktakeLostReviewLine[]> {
    const ids = draft.lostReview.flatMap((item) => {
      const id = parseId(item.ticketId);
      return id === null ? [] : [id];
    });
    if (ids.length === 0) {
      return [];
    }
    const found = await this.tickets.findMany(
      reader,
      { _id: { $in: ids }, orgId: store.orgId },
      options,
    );
    const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
    const books = await this.facts.booksOf(
      reader,
      found.map((ticket) => ticket.bookId),
      options,
    );
    const options_ = await this.lostReasonLabels(reader);
    return draft.lostReview.flatMap((item) => {
      const ticket = byId.get(item.ticketId);
      if (ticket === undefined) {
        return [];
      }
      const book = books.get(String(ticket.bookId));
      return [
        {
          ticketId: ticket._id,
          bookId: ticket.bookId,
          label: displayTicketKey(
            book?.gameCode ?? "",
            ticket.bookNo,
            ticket.ticketNo,
          ),
          action: item.action,
          reasonKey: item.action === "lost" ? (item.reasonKey ?? null) : null,
          reasonLabel:
            item.action === "lost" && item.reasonKey != null
              ? (options_.get(item.reasonKey) ?? item.reasonKey)
              : null,
          reasonNote: item.action === "lost" ? (item.reasonNote ?? null) : null,
          unitCost: ticket.unitCost,
        },
      ];
    });
  }

  /** 遺失原因的名稱(快照進盤點單;讀不到時存代碼)。 */
  private async lostReasonLabels(
    reader: OperatorContext,
  ): Promise<Map<string, string>> {
    try {
      const options = await this.fieldOptions.optionsOf(
        reader,
        LOTTERY_FIELD_CATEGORY_KEYS.lostReason,
        LOTTERY_FIELD_CATEGORIES,
      );
      return new Map(options.map((option) => [option.value, option.label]));
    } catch {
      return new Map();
    }
  }
}
