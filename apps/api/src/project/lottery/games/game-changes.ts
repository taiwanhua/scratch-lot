import type { LotteryGame } from "../../database/lottery-games/lottery-game.schema";
import type { UpdateLotteryGameInput } from "./dto/lottery-game.input";
import {
  type GameFieldErrors,
  checkColor,
  checkDefaultRate,
  checkGameCode,
  checkName,
  checkNote,
  checkStatus,
  checkTicketsPerBook,
  checkUnitPrice,
} from "./game-validation";

/** 編輯時看得到的欄位快照(比對「有沒有改」與稽核的 before 都用它)。 */
export type GameSnapshot = Record<string, unknown>;

export function snapshotOf(game: LotteryGame): GameSnapshot {
  return {
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
  };
}

/** 兩個值一樣嗎(日期比時點、ObjectId 比字串;都經 JSON 形式比)。 */
export function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * 編輯 input → 要寫的值(GQL-06:缺席 = 不動;必填欄位送 null 視同缺席;選填欄位送 null = 清空)。
 * 不合的欄位放進 `errors`。
 */
export function requestedGameValues(
  input: UpdateLotteryGameInput,
  errors: GameFieldErrors,
): GameSnapshot {
  const next: GameSnapshot = {};
  if (input.gameCode != null) {
    next.gameCode = checkGameCode(input.gameCode, errors);
  }
  if (input.name != null) {
    next.name = checkName(input.name, errors);
  }
  if (input.unitPrice != null) {
    next.unitPrice = checkUnitPrice(input.unitPrice, errors);
  }
  if (input.ticketsPerBook != null) {
    next.ticketsPerBook = checkTicketsPerBook(input.ticketsPerBook, errors);
  }
  if (input.defaultRate != null) {
    next.defaultRate = checkDefaultRate(input.defaultRate, errors);
  }
  if (input.status != null) {
    next.status = checkStatus(input.status, errors);
  }
  if (input.color !== undefined) {
    next.color = checkColor(input.color, errors);
  }
  if (input.note !== undefined) {
    next.note = checkNote(input.note, errors);
  }
  for (const key of [
    "launchedAt",
    "discontinuedAt",
    "claimDeadline",
  ] as const) {
    if (input[key] !== undefined) {
      next[key] = input[key];
    }
  }
  return next;
}
