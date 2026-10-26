import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { Types } from "mongoose";

import {
  INVENTORY_PERMISSIONS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketStatus,
  formatTicketNo,
  requiredSkipCountOf,
  skipCorrectionDiffOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import {
  type LotteryTicketDocument,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { parseId } from "../accounts/accounts-util";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { tenantOfOperator } from "../master-data-tenant";
import {
  INVENTORY_REASONS,
  crossStoreForbiddenError,
  notFoundError,
  ticketConflictError,
  validationError,
} from "../tickets/inventory-error";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type {
  CorrectLotterySkippedTicketsInput,
  LotteryTicketVersionInput,
  RecoverLotteryTicketsInput,
  ScrapLotteryTicketsInput,
} from "./dto/lottery-inventory.input";
import { InventoryAccess } from "./inventory-access";
import { InventoryNames } from "./inventory-names";
import { InventoryViewService } from "./inventory-view.service";
import type { LotteryInventoryActionPayload } from "./models/lottery-inventory.model";
import { isVisibleStore } from "./store-orgs";

type TicketRecord = Persisted<LotteryTicketDocument>;

/** 這幾張的狀態不能做這件事(`extensions.ticketIds` 列出不合的張)。 */
function statusNotAllowedError(
  message: string,
  ticketIds: readonly string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      reason: INVENTORY_REASONS.ticketStatusNotAllowed,
      fields: ["tickets"],
      ticketIds,
    },
  });
}

/** 輸入的張(去重、id 合法);空 → `VALIDATION_FAILED`。 */
function ticketRefsOf(
  tickets: readonly LotteryTicketVersionInput[],
): { id: Types.ObjectId; version: number }[] {
  const unique = new Map<string, { id: Types.ObjectId; version: number }>();
  for (const ticket of tickets) {
    if (!Types.ObjectId.isValid(ticket.ticketId)) {
      throw validationError("張的 id 不合法", ["tickets"]);
    }
    unique.set(ticket.ticketId, {
      id: new Types.ObjectId(ticket.ticketId),
      version: ticket.version,
    });
  }
  if (unique.size === 0) {
    throw validationError("請選擇張", ["tickets"]);
  }
  return [...unique.values()];
}

/**
 * 庫存管理的寫入(專案規格 7.3、7.4;正本 `docs/modules/project/inventory.md`):更正跳號、尋回、報廢。
 * 張的狀態與事件一律經帳本(`TicketLedgerService`),在同一個交易;權限由 resolver 的
 * `@RequirePermission` 守,這裡檢查業務規則與原因(欄位管理的原因類別,選「其他」說明必填)。
 */
@Injectable()
export class InventoryActionsService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly orgs: OrgsRepository,
    private readonly ledger: TicketLedgerService,
    private readonly view: InventoryViewService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly access: InventoryAccess,
    private readonly names: InventoryNames,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * 更正跳號(`inventory.mark-skipped`):改完的跳號張數要等於待標註張數(迄號 − 標準張數);
   * 寫「取消跳號」(原本是跳號、改完不是 → 未售)與「跳號」(新標的,要是未售);原因必填。
   */
  async correctSkips(
    operator: OperatorContext,
    input: CorrectLotterySkippedTicketsInput,
  ): Promise<LotteryInventoryActionPayload> {
    const book = await this.view.mustBook(operator, input.bookId);
    const lastTicketNo = Number(book.lastTicketNo);
    const required = requiredSkipCountOf(lastTicketNo, book.standardTickets);
    if (book.skippedTicketNos.length === 0) {
      throw validationError(
        "這本沒有跳號",
        ["ticketNos"],
        INVENTORY_REASONS.noSkippedTickets,
      );
    }
    const next = [...new Set(input.ticketNos)];
    const inRange = (no: string) =>
      /^\d{3}$/.test(no) && Number(no) >= 1 && Number(no) <= lastTicketNo;
    if (next.length !== required || !next.every((no) => inRange(no))) {
      throw validationError(
        `跳號要剛好 ${String(required)} 張`,
        ["ticketNos"],
        INVENTORY_REASONS.skipCountMismatch,
      );
    }
    const diff = skipCorrectionDiffOf(
      book.skippedTicketNos,
      next.map((no) => formatTicketNo(Number(no))),
    );
    if (diff.skip.length === 0 && diff.unskip.length === 0) {
      throw validationError(
        "跳號沒有更動",
        ["ticketNos"],
        INVENTORY_REASONS.skipUnchanged,
      );
    }
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason,
      input,
      LOTTERY_FIELD_CATEGORIES,
    );
    const whole = await this.view.wholeBookReader(operator, book);
    await this.transactions.withTransaction(async (session) => {
      // 讀整本(反查),再擋所在分店不在操作者範圍內的張(別店的張只能看)
      const found = await this.tickets.findMany(
        whole,
        { bookId: book._id, ticketNo: { $in: [...diff.skip, ...diff.unskip] } },
        { session },
      );
      this.assertOperable(operator, found);
      const byNo = new Map(found.map((ticket) => [ticket.ticketNo, ticket]));
      const missing = [...diff.skip, ...diff.unskip].filter(
        (no) => !byNo.has(no),
      );
      if (missing.length > 0) {
        throw notFoundError("有幾張不在這本");
      }
      const pick = (nos: readonly string[]) =>
        nos.flatMap((no) => {
          const ticket = byNo.get(no);
          return ticket ? [ticket] : [];
        });
      const toSkip = pick(diff.skip);
      const toUnskip = pick(diff.unskip);
      this.assertStatuses(toSkip, [TICKET_STATUS.unsold], "新標的跳號要是未售");
      this.assertStatuses(
        toUnskip,
        [TICKET_STATUS.skipped],
        "要取消的不是跳號",
      );
      const at = new Date();
      await this.ledger.applyTicketEvents(session, { operator }, [
        ...toUnskip.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.skipped],
          type: TICKET_EVENT_TYPE.unskip,
          at,
          patch: { status: TICKET_STATUS.unsold },
          ...reason,
        })),
        ...toSkip.map((ticket) => ({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.unsold],
          type: TICKET_EVENT_TYPE.skip,
          at,
          patch: { status: TICKET_STATUS.skipped },
          ...reason,
        })),
      ]);
    });
    return { count: diff.skip.length + diff.unskip.length, lossCost: null };
  }

  /**
   * 尋回(`inventory.recover`):待查 / 遺失的張回到庫存,清掉責任分店。兩種入口:
   *
   * - **刷到實體**(給 `orgId`;店面看板刷到、展開卡片):回到 `orgId` 這家店(刷到的那家店;要是操作者
   *   看得到的**店**,`isVisibleStore`;不是店 → `VALIDATION_FAILED` `RECOVER_TARGET_NOT_STORE`)。
   *   張可能還在別的分店:以帳本的跨店寫入(只准把張移進自己看得到的店)。
   * - **從清單選**(不給 `orgId`;本的詳情、待查·遺失分頁):**不換店**,每張回到自己所在分店的庫存;
   *   張的所在分店要在操作者的可見範圍內,否則 `FORBIDDEN` `CROSS_STORE_NOT_ALLOWED`。
   */
  async recover(
    operator: OperatorContext,
    input: RecoverLotteryTicketsInput,
  ): Promise<LotteryInventoryActionPayload> {
    const refs = ticketRefsOf(input.tickets);
    const target =
      input.orgId == null
        ? null
        : await this.recoverTargetOf(operator, input.orgId);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null) {
      throw notFoundError("找不到所在租戶");
    }
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.recoverReason,
      input,
      LOTTERY_FIELD_CATEGORIES,
    );
    const missingStatuses: TicketStatus[] = [
      TICKET_STATUS.investigating,
      TICKET_STATUS.lost,
    ];
    await this.transactions.withTransaction(async (session) => {
      // 張可能在別的分店(反查整個租戶);從清單選的再擋別店的張
      const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
      const found = await this.tickets.findMany(
        reader,
        { _id: { $in: refs.map((item) => item.id) } },
        { session },
      );
      this.assertFound(refs, found);
      if (target === null) {
        this.assertOperable(operator, found);
      }
      this.assertStatuses(found, missingStatuses, "只有待查或遺失的張能尋回");
      const at = new Date();
      const recovered = refs.map((item) => ({
        ticketId: item.id,
        expectedVersion: item.version,
        expectedStatuses: missingStatuses,
        type: TICKET_EVENT_TYPE.recover,
        at,
        patch: {
          status: TICKET_STATUS.unsold,
          location: { kind: TICKET_LOCATION_KIND.stock, cashPointId: null },
          responsibleOrgId: null,
        },
        ...reason,
      }));
      await (target === null
        ? this.ledger.applyTicketEvents(session, { operator }, recovered)
        : this.ledger.applyTicketEvents(
            session,
            { operator, crossStoreTenantId: tenantId },
            recovered.map((event) => ({
              ...event,
              patch: { ...event.patch, orgId: target },
            })),
          ));
    });
    return { count: refs.length, lossCost: null };
  }

  /** 刷到實體的尋回要回到的店:看得到、而且是店(沒有下層組織)。 */
  private async recoverTargetOf(
    operator: OperatorContext,
    id: string,
  ): Promise<Types.ObjectId> {
    const orgId = parseId(id);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      throw notFoundError("分店不存在");
    }
    // 回到的要是店(規格 7.4「回到刷到的那家店」):沒有下層組織;最上層組織、區域不行
    const tenantOrgs = await this.names.tenantOrgs(operator);
    const target = tenantOrgs.find((org) => org.id.equals(orgId));
    if (target === undefined) {
      throw notFoundError("分店不存在");
    }
    if (!isVisibleStore(operator, target, tenantOrgs)) {
      throw validationError(
        "尋回要回到一家店",
        ["orgId"],
        INVENTORY_REASONS.recoverTargetNotStore,
      );
    }
    return orgId;
  }

  /**
   * 報廢(`inventory.scrap`):只能報未售的張(破損、污損、受潮);張的所在分店要在操作者的可見範圍內
   * (別店的張 → `FORBIDDEN` `CROSS_STORE_NOT_ALLOWED`),帳本照操作者自己的範圍寫。
   * 回損失 = 這幾張的單張成本加總(批購成本,四捨五入到元;要 `inventory.show-cost`)。
   */
  async scrap(
    operator: OperatorContext,
    input: ScrapLotteryTicketsInput,
  ): Promise<LotteryInventoryActionPayload> {
    const refs = ticketRefsOf(input.tickets);
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.scrapReason,
      input,
      LOTTERY_FIELD_CATEGORIES,
    );
    const grant = await this.access.grantOf(operator);
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null) {
      throw notFoundError("找不到所在租戶");
    }
    let loss = 0;
    await this.transactions.withTransaction(async (session) => {
      // 反查整個租戶,才分得出「別店的張」(CROSS_STORE_NOT_ALLOWED)與「已被處理」
      const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
      const found = await this.tickets.findMany(
        reader,
        { _id: { $in: refs.map((item) => item.id) } },
        { session },
      );
      this.assertFound(refs, found);
      this.assertOperable(operator, found);
      this.assertStatuses(found, [TICKET_STATUS.unsold], "只能報廢未售的張");
      const unitCostOf = new Map(
        found.map((ticket) => [String(ticket._id), ticket.unitCost]),
      );
      const at = new Date();
      await this.ledger.applyTicketEvents(
        session,
        { operator },
        refs.map((item) => ({
          ticketId: item.id,
          expectedVersion: item.version,
          expectedStatuses: [TICKET_STATUS.unsold],
          type: TICKET_EVENT_TYPE.scrap,
          at,
          // 報表的報廢損失讀這個快照(批購成本)
          cost: unitCostOf.get(String(item.id)) ?? 0,
          patch: { status: TICKET_STATUS.scrapped },
          ...reason,
        })),
      );
      loss = found.reduce((sum, ticket) => sum + ticket.unitCost, 0);
    });
    return {
      count: refs.length,
      lossCost: grant.has(INVENTORY_PERMISSIONS.showCost)
        ? Math.round(loss)
        : null,
    };
  }

  /**
   * 能不能操作某一張 = 它的所在分店在操作者的可見範圍內(底座可見範圍;不另寫總部特例)。
   * 別店的張(例:調貨後留在出貨店的張)→ `FORBIDDEN` `CROSS_STORE_NOT_ALLOWED`(`ticketIds` 列出)。
   */
  private assertOperable(
    operator: OperatorContext,
    tickets: readonly TicketRecord[],
  ): void {
    const outside = tickets
      .filter((ticket) => !isOrgVisible(operator, ticket.orgId))
      .map((ticket) => String(ticket._id));
    if (outside.length > 0) {
      throw crossStoreForbiddenError(outside);
    }
  }

  /** 租戶裡讀不到(不存在或已刪除)的張 → `CONFLICT`「已被處理」(與帳本同一個碼)。 */
  private assertFound(
    refs: readonly { id: Types.ObjectId }[],
    found: readonly TicketRecord[],
  ): void {
    const ids = new Set(found.map((ticket) => String(ticket._id)));
    const missing = refs
      .map((item) => String(item.id))
      .filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw ticketConflictError(missing);
    }
  }

  private assertStatuses(
    tickets: readonly TicketRecord[],
    allowed: readonly TicketStatus[],
    message: string,
  ): void {
    const wrong = tickets
      .filter((ticket) => !allowed.includes(ticket.status))
      .map((ticket) => String(ticket._id));
    if (wrong.length > 0) {
      throw statusNotAllowedError(message, wrong);
    }
  }
}
