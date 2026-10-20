import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  GAME_STATUS,
  MASTER_DATA_MODULE_KEYS,
  MASTER_DATA_PERMISSIONS,
  bookPriceOf,
  isGameStatus,
} from "@repo/domain/project/lottery-master-data";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type LotteryGameDocument,
  LotteryGamesRepository,
} from "../../database/lottery-games/lottery-games.repository";
import { MasterDataAccess, type MasterDataGrant } from "../master-data-access";
import {
  MASTER_DATA_REASONS,
  notFoundError,
  validationError,
} from "../master-data-error";
import {
  type OperatorTenant,
  tenantOfOperator,
  tenantReadContext,
} from "../master-data-tenant";
import type {
  CreateLotteryGameInput,
  DeleteLotteryGameInput,
  LotteryGamesInput,
  UpdateLotteryGameInput,
} from "./dto/lottery-game.input";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./dto/lottery-game.input";
import { isSameValue, requestedGameValues, snapshotOf } from "./game-changes";
import { isGameInUse } from "./game-usage";
import {
  GameFieldErrors,
  checkColor,
  checkDefaultRate,
  checkGameCode,
  checkName,
  checkNote,
  checkStatus,
  checkTicketsPerBook,
  checkUnitPrice,
} from "./game-validation";
import type {
  DeleteLotteryGamePayload,
  LotteryGameModel,
  LotteryGamesPayload,
} from "./models/lottery-game.model";

type GameRecord = Persisted<LotteryGameDocument>;

const AUDIT_TARGET_TYPE = "lottery_game";
const AUDIT = {
  create: "lottery-game.create",
  edit: "lottery-game.edit",
  delete: "lottery-game.delete",
} as const;

/** 有庫存後鎖定的三個欄位。 */
const LOCKED_FIELDS = ["gameCode", "unitPrice", "ticketsPerBook"] as const;

/** MongoDB 唯一索引衝突。 */
const DUPLICATE_KEY_ERROR = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR
  );
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * 遊戲(`master-data` → 遊戲分頁;專案規格 5.1,正本 `docs/modules/project/master-data.md`)。
 *
 * - **範圍**:遊戲是整個租戶共用的主檔,一律釘在操作者所在租戶(`master-data-tenant.ts`);
 *   別租戶的遊戲回 `NOT_FOUND`
 * - **讀取**:要綁 `master-data.games`(遊戲分頁);寫入另由 resolver 守 create / edit / delete
 * - **有庫存**(`isGameInUse`,P15 / P17 / P18 登記)後:代號、面額、張數不能改,不能刪除
 */
@Injectable()
export class LotteryGamesService {
  constructor(
    private readonly games: LotteryGamesRepository,
    private readonly orgs: OrgsRepository,
    private readonly access: MasterDataAccess,
    private readonly audit: AuditService,
  ) {}

  // ---- 讀 ----

  async list(
    operator: OperatorContext,
    input: LotteryGamesInput,
  ): Promise<LotteryGamesPayload> {
    const grant = await this.access.assertModule(
      operator,
      MASTER_DATA_MODULE_KEYS.games,
    );
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const tenant = await tenantOfOperator(operator, this.orgs);
    if (tenant === null) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const keyword = input.keyword?.trim();
    const filter = {
      tenantId: tenant.tenantId,
      ...(isGameStatus(input.status) ? { status: input.status } : {}),
      ...(input.unitPrice === undefined || input.unitPrice === null
        ? {}
        : { unitPrice: input.unitPrice }),
      ...(keyword
        ? {
            $or: [
              { gameCode: { $regex: escapeRegex(keyword), $options: "i" } },
              { name: { $regex: escapeRegex(keyword), $options: "i" } },
            ],
          }
        : {}),
    };
    const reader = tenantReadContext(operator);
    const totalCount = await this.games.count(reader, filter);
    const documents = await this.games.findMany(reader, filter, {
      sort: { gameCode: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    const items = await Promise.all(
      documents.map((document) => this.toModel(document, grant)),
    );
    return { items, totalCount, page, pageSize };
  }

  async findOne(
    operator: OperatorContext,
    id: string,
  ): Promise<LotteryGameModel> {
    const grant = await this.access.assertModule(
      operator,
      MASTER_DATA_MODULE_KEYS.games,
    );
    const { game } = await this.mustFind(operator, id);
    return this.toModel(game, grant);
  }

  // ---- 寫 ----

  async create(
    operator: OperatorContext,
    input: CreateLotteryGameInput,
  ): Promise<LotteryGameModel> {
    const tenant = await this.mustTenant(operator);
    const errors = new GameFieldErrors();
    const gameCode = checkGameCode(input.gameCode, errors);
    const name = checkName(input.name, errors);
    const unitPrice = checkUnitPrice(input.unitPrice, errors);
    const ticketsPerBook = checkTicketsPerBook(input.ticketsPerBook, errors);
    const defaultRate = checkDefaultRate(input.defaultRate, errors);
    const color = checkColor(input.color ?? null, errors);
    const status = checkStatus(input.status ?? GAME_STATUS.onSale, errors);
    const note = checkNote(input.note ?? null, errors);
    if (
      errors.fields.length > 0 ||
      gameCode === null ||
      name === null ||
      unitPrice === null ||
      ticketsPerBook === null ||
      defaultRate === null
    ) {
      throw validationError("lottery game input is invalid", errors.fields);
    }
    await this.assertCodeAvailable(operator, tenant, gameCode, null);
    const data = {
      gameCode,
      name,
      unitPrice,
      ticketsPerBook,
      bookPrice: bookPriceOf(unitPrice, ticketsPerBook),
      defaultRate,
      color,
      status,
      launchedAt: input.launchedAt ?? null,
      discontinuedAt: input.discontinuedAt ?? null,
      claimDeadline: input.claimDeadline ?? null,
      note,
    };
    const created = await this.saving(gameCode, () =>
      this.games.create(tenantReadContext(operator), {
        ...data,
        orgId: tenant.ownerOrgId,
      }),
    );
    await this.audit.record(operator, {
      action: AUDIT.create,
      targetType: AUDIT_TARGET_TYPE,
      targetId: created._id,
      after: data,
    });
    return this.toModel(created, await this.access.grantOf(operator));
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryGameInput,
  ): Promise<LotteryGameModel> {
    const { game, tenant } = await this.mustFind(operator, input.id);
    const errors = new GameFieldErrors();
    const next = requestedGameValues(input, errors);
    if (errors.fields.length > 0) {
      throw validationError("lottery game input is invalid", errors.fields);
    }
    const current = snapshotOf(game);
    const changed = Object.keys(next).filter(
      (key) => !isSameValue(next[key], current[key]),
    );
    const lockedChanges = LOCKED_FIELDS.filter((key) => changed.includes(key));
    if (
      lockedChanges.length > 0 &&
      (await isGameInUse(tenant.tenantId, game._id))
    ) {
      throw validationError(
        `lottery game is in use: ${lockedChanges.join(", ")} are locked`,
        [...lockedChanges],
        MASTER_DATA_REASONS.gameInUse,
      );
    }
    if (changed.includes("gameCode")) {
      await this.assertCodeAvailable(
        operator,
        tenant,
        next.gameCode as string,
        game._id,
      );
    }
    if (changed.length === 0) {
      return this.toModel(game, await this.access.grantOf(operator));
    }

    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const key of changed) {
      set[key] = next[key];
      before[key] = current[key] ?? null;
    }
    if (changed.includes("unitPrice") || changed.includes("ticketsPerBook")) {
      set.bookPrice = bookPriceOf(
        (set.unitPrice as number | undefined) ?? game.unitPrice,
        (set.ticketsPerBook as number | undefined) ?? game.ticketsPerBook,
      );
      before.bookPrice = game.bookPrice;
    }
    const updated = await this.saving(
      (set.gameCode as string | undefined) ?? game.gameCode,
      () =>
        this.games.updateById(tenantReadContext(operator), game._id, {
          $set: set,
        }),
    );
    if (!updated) {
      throw notFoundError(`lottery game not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.edit,
      targetType: AUDIT_TARGET_TYPE,
      targetId: updated._id,
      before,
      after: set,
    });
    return this.toModel(updated, await this.access.grantOf(operator));
  }

  /** 刪除:軟刪除;只有從未被本、叫貨單、進貨單引用的遊戲可以刪(否則只能停售)。 */
  async remove(
    operator: OperatorContext,
    input: DeleteLotteryGameInput,
  ): Promise<DeleteLotteryGamePayload> {
    const { game, tenant } = await this.mustFind(operator, input.id);
    if (await isGameInUse(tenant.tenantId, game._id)) {
      throw validationError(
        "lottery game is in use and cannot be deleted",
        ["id"],
        MASTER_DATA_REASONS.gameInUse,
      );
    }
    const deleted = await this.games.softDeleteById(
      tenantReadContext(operator),
      game._id,
    );
    if (!deleted) {
      throw notFoundError(`lottery game not found: ${input.id}`);
    }
    await this.audit.record(operator, {
      action: AUDIT.delete,
      targetType: AUDIT_TARGET_TYPE,
      targetId: deleted._id,
      before: { gameCode: game.gameCode, name: game.name },
    });
    return { success: true, deletedId: String(deleted._id) };
  }

  // ---- 內部 ----

  /** 寫入撞到代號唯一索引(兩個請求同時送出同一個代號)時,與事前檢查回同一個錯誤。 */
  private async saving<T>(
    gameCode: string,
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      throw validationError(
        `game code already exists: ${gameCode}`,
        ["gameCode"],
        MASTER_DATA_REASONS.gameCodeDuplicate,
      );
    }
  }

  private async mustTenant(operator: OperatorContext): Promise<OperatorTenant> {
    const tenant = await tenantOfOperator(operator, this.orgs);
    if (tenant === null) {
      throw notFoundError("operator has no current org");
    }
    return tenant;
  }

  /** 操作者租戶裡的那一筆;別租戶、已刪除、id 不合法一律 `NOT_FOUND`。 */
  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<{ game: GameRecord; tenant: OperatorTenant }> {
    const tenant = await this.mustTenant(operator);
    const game = Types.ObjectId.isValid(id)
      ? await this.games.findOne(tenantReadContext(operator), {
          _id: new Types.ObjectId(id),
          tenantId: tenant.tenantId,
        })
      : null;
    if (!game) {
      throw notFoundError(`lottery game not found: ${id}`);
    }
    return { game, tenant };
  }

  private async assertCodeAvailable(
    operator: OperatorContext,
    tenant: OperatorTenant,
    gameCode: string,
    selfId: Types.ObjectId | null,
  ): Promise<void> {
    const duplicate = await this.games.findOne(tenantReadContext(operator), {
      tenantId: tenant.tenantId,
      gameCode,
      ...(selfId === null ? {} : { _id: { $ne: selfId } }),
    });
    if (duplicate) {
      throw validationError(
        `game code already exists: ${gameCode}`,
        ["gameCode"],
        MASTER_DATA_REASONS.gameCodeDuplicate,
      );
    }
  }

  private async toModel(
    game: GameRecord,
    grant: MasterDataGrant,
  ): Promise<LotteryGameModel> {
    const inUse = await isGameInUse(game.tenantId, game._id);
    return {
      id: String(game._id),
      gameCode: game.gameCode,
      name: game.name,
      unitPrice: game.unitPrice,
      ticketsPerBook: game.ticketsPerBook,
      bookPrice: game.bookPrice,
      defaultRate: game.defaultRate,
      color: game.color ?? null,
      status: game.status,
      launchedAt: game.launchedAt ?? null,
      discontinuedAt: game.discontinuedAt ?? null,
      claimDeadline: game.claimDeadline ?? null,
      note: game.note ?? null,
      inUse,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      abilities: {
        canEdit: grant.has(MASTER_DATA_PERMISSIONS.gamesEdit),
        canDelete: grant.has(MASTER_DATA_PERMISSIONS.gamesDelete) && !inUse,
      },
    };
  }
}
