import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  PURCHASE_FIELD_KEYS,
  PURCHASE_FORM_KEY,
  PURCHASE_MODULE_KEY,
  purchaseHeaderOf,
  purchaseLinesOf,
} from "@repo/domain/project/lottery";
import { GAME_STATUS } from "@repo/domain/project/lottery-master-data";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import {
  LotteryDealerContactsRepository,
  LotteryDealersRepository,
  LotteryRelationshipsRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import { LotteryPurchaseReceiptsRepository } from "../../database/lottery-purchases/lottery-purchase-receipts.repository";
import { LotteryRequisitionLinesRepository } from "../../database/lottery-requisitions/lottery-requisition-lines.repository";
import { tenantOfOperator } from "../master-data-tenant";
import { inTransitBooksOf } from "../requisition/in-transit";
import {
  SettlementLedger,
  outstandingOf,
} from "../settlement/settlement-ledger";
import { settlementDocumentOf } from "../settlement/settlement-registry";
import { SettlementService } from "../settlement/settlement.service";
import { LotteryAllocationsService } from "../tickets/allocations.service";
import type {
  LotteryDealerPurchaseModel,
  LotteryPurchaseOptionsModel,
  LotteryPurchaseProgressModel,
  LotteryPurchaseRequisitionModel,
} from "./models/purchase.model";
import { notFoundError } from "./purchase-error";
import { PURCHASE_LIVE_STATUSES, toObjectId } from "./purchase-rules.service";

const DEALER_CONTACT = "lottery_dealer_lottery_dealer_contact";

function byLabel(left: { label: string }, right: { label: string }): number {
  return left.label.localeCompare(right.label, "zh-Hant");
}

function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

/**
 * 進貨單的讀取(專案規格 8.2;正本 `docs/modules/project/purchasing.md`「api 介面」):
 *
 * - `optionsOf`:新增頁的選項(營業中的甲類、受託人、扣款帳戶、這家店待購買的叫貨單、販售中的遊戲、
 *   每個遊戲的預計要給本數 / 已給 / 在途)
 * - `progressOf`:列表的點收進度(8/10)與結算(待付 / 待退)
 * - `dealerPurchasesOf`:甲類詳情「批購紀錄」分頁(有效進貨單)
 *
 * 範圍照操作者的可見範圍;權限由 resolver 守。
 */
@Injectable()
export class PurchaseQueryService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly dealers: LotteryDealersRepository,
    private readonly contacts: LotteryDealerContactsRepository,
    private readonly relationships: LotteryRelationshipsRepository,
    private readonly requisitionLines: LotteryRequisitionLinesRepository,
    private readonly receipts: LotteryPurchaseReceiptsRepository,
    private readonly settlement: SettlementService,
    private readonly ledger: SettlementLedger,
    private readonly allocations: LotteryAllocationsService,
  ) {}

  async optionsOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    editingId: Types.ObjectId | null = null,
  ): Promise<LotteryPurchaseOptionsModel> {
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (tenantId === null || !isOrgVisible(operator, orgId)) {
      throw notFoundError("分店不存在");
    }
    const [dealers, accounts, requisitions, games] = await Promise.all([
      this.dealers.findMany(
        operator,
        { type: "a", status: "active" },
        { select: "name licenseNo" },
      ),
      this.settlement.usableAccountsOf(operator, tenantId, orgId),
      this.requisitionsOf(operator, orgId, editingId),
      this.games.findMany(
        operator,
        { status: GAME_STATUS.onSale },
        {
          select:
            "gameCode name unitPrice ticketsPerBook bookPrice defaultRate",
        },
      ),
    ]);
    const dealerOptions = dealers
      .map((dealer) => ({
        id: String(dealer._id),
        label: `${dealer.name} · ${dealer.licenseNo}`,
      }))
      .toSorted(byLabel);
    const gameIds = games.map((game) => game._id);
    const [inTransit, statuses] = await Promise.all([
      inTransitBooksOf({ tenantId, orgId }),
      gameIds.length === 0
        ? Promise.resolve([])
        : this.allocations.allocationStatuses(operator, orgId, gameIds),
    ]);
    return {
      // 超過預計要給本數只警告(規格 7.6)
      allocations: statuses.map((status) => ({
        gameId: status.gameId,
        plannedBooks: status.plannedBooks,
        givenBooks: status.givenBooks,
        inTransitBooks: inTransit.get(status.gameId) ?? 0,
      })),
      dealers: dealerOptions,
      trustees: await this.trusteesOf(
        tenantId,
        dealers.map((dealer) => dealer._id),
      ),
      accounts,
      requisitions,
      games: games
        .map((game) => ({
          id: String(game._id),
          gameCode: game.gameCode,
          name: game.name,
          unitPrice: game.unitPrice,
          ticketsPerBook: game.ticketsPerBook,
          bookPrice: game.bookPrice,
          defaultRate: game.defaultRate,
        }))
        .toSorted((left, right) =>
          left.gameCode.localeCompare(right.gameCode, "zh-Hant"),
        ),
    };
  }

  async progressOf(
    operator: OperatorContext,
    purchaseIds: readonly string[],
  ): Promise<LotteryPurchaseProgressModel[]> {
    const ids = purchaseIds.flatMap((id) => {
      const objectId = toObjectId(id);
      return objectId === null ? [] : [objectId];
    });
    const tenantId = tenantOfOperator(operator)?.tenantId ?? null;
    if (ids.length === 0 || tenantId === null) {
      return [];
    }
    const submissions = await this.submissions.findMany(operator, {
      _id: { $in: ids },
      moduleKey: PURCHASE_MODULE_KEY,
      formKey: PURCHASE_FORM_KEY,
    });
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const receipts = await this.receipts.findMany(
      reader,
      { submissionId: { $in: submissions.map((row) => row._id) } },
      { select: "submissionId rowId" },
    );
    const received = new Set(
      receipts.map((row) => `${String(row.submissionId)}:${row.rowId}`),
    );
    const registration = settlementDocumentOf(PURCHASE_MODULE_KEY);
    const snapshots =
      registration === undefined
        ? []
        : await this.ledger.snapshotsOf(operator, registration, submissions);
    const dueOf = new Map(
      snapshots.map((snapshot) => [
        String(snapshot.submission._id),
        outstandingOf(snapshot)[0] ?? null,
      ]),
    );
    return submissions.map((submission) => {
      const key = String(submission._id);
      const lines = purchaseLinesOf(submission.values);
      const due = dueOf.get(key) ?? null;
      return {
        purchaseId: key,
        receivedCount: lines.filter((line) =>
          received.has(`${key}:${line.rowId}`),
        ).length,
        totalCount: lines.length,
        settlementKind: due?.kind ?? null,
        settlementAmount: due?.amount ?? 0,
        inSettlement: dueOf.has(key),
      };
    });
  }

  async dealerPurchasesOf(
    operator: OperatorContext,
    dealerIdText: string,
  ): Promise<LotteryDealerPurchaseModel[]> {
    const dealerId = toObjectId(dealerIdText);
    const dealer =
      dealerId === null
        ? null
        : await this.dealers.findOne(operator, { _id: dealerId, type: "a" });
    if (dealer === null) {
      throw notFoundError("甲類不存在");
    }
    const rows = await this.submissions.findMany(
      operator,
      {
        moduleKey: PURCHASE_MODULE_KEY,
        formKey: PURCHASE_FORM_KEY,
        status: { $in: [...PURCHASE_LIVE_STATUSES] },
        [`values.${PURCHASE_FIELD_KEYS.dealer}.id`]: String(dealer._id),
      },
      { select: "values serialNo status" },
    );
    return rows
      .map((row) => {
        const values = row.values as Record<string, unknown>;
        const header = purchaseHeaderOf(values);
        const lines = purchaseLinesOf(values);
        return {
          purchaseId: String(row._id),
          serialNo: row.serialNo ?? null,
          branchName: labelOf(values[PURCHASE_FIELD_KEYS.branch]),
          purchaseDate: header.purchaseDate,
          selfPurchase: header.selfPurchase,
          trusteeName: header.selfPurchase
            ? null
            : labelOf(values[PURCHASE_FIELD_KEYS.trustee]) || null,
          books: lines.length,
          purchaseTotal: lines.reduce((sum, line) => sum + line.amount, 0),
          status: row.status,
        };
      })
      .toSorted(
        (left, right) =>
          (right.purchaseDate?.getTime() ?? 0) -
          (left.purchaseDate?.getTime() ?? 0),
      );
  }

  // ---- 內部 ----

  /**
   * 這家店待購買的叫貨單(有效、未被引用的副本列,依叫貨單分組);編輯中的進貨單(`editingId`)
   * 另含它自己已引用的那張(退回修改時叫貨單仍是「已進貨」,要能照原樣帶入)。
   */
  private async requisitionsOf(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    editingId: Types.ObjectId | null,
  ): Promise<LotteryPurchaseRequisitionModel[]> {
    const rows = await this.requisitionLines.findMany(
      operator,
      {
        orgId,
        voidedAt: null,
        ...(editingId === null
          ? { referencedBy: null }
          : {
              $or: [
                { referencedBy: null },
                { "referencedBy.submissionId": editingId },
              ],
            }),
      },
      {
        select: "requisitionId serialNo gameId books completedAt",
        sort: { completedAt: -1, _id: 1 },
      },
    );
    const byRequisition = new Map<string, LotteryPurchaseRequisitionModel>();
    for (const row of rows) {
      const key = String(row.requisitionId);
      const group = byRequisition.get(key) ?? {
        id: key,
        serialNo: row.serialNo,
        lines: [],
      };
      group.lines.push({ gameId: String(row.gameId), books: row.books });
      byRequisition.set(key, group);
    }
    return [...byRequisition.values()];
  }

  /** 甲類啟用中的受託人(關聯在租戶內;關係人可能是別的組織建的)。 */
  private async trusteesOf(
    tenantId: Types.ObjectId,
    dealerIds: readonly Types.ObjectId[],
  ) {
    if (dealerIds.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const links = await this.relationships.findMany(
      reader,
      {
        tenantId,
        type: DEALER_CONTACT,
        firstId: { $in: [...dealerIds] },
        "meta.role": "trustee",
      },
      { select: "firstId secondId" },
    );
    if (links.length === 0) {
      return [];
    }
    const contacts = await this.contacts.findMany(
      reader,
      {
        _id: { $in: links.map((link) => link.secondId) },
        status: "active",
        roles: "trustee",
      },
      { select: "name" },
    );
    const nameOf = new Map(
      contacts.map((contact) => [String(contact._id), contact.name]),
    );
    return links.flatMap((link) => {
      const name = nameOf.get(String(link.secondId));
      return name === undefined
        ? []
        : [
            {
              dealerId: String(link.firstId),
              id: String(link.secondId),
              label: name,
            },
          ];
    });
  }
}
