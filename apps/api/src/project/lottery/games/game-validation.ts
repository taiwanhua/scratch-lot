import {
  DEFAULT_RATE_MAX,
  DEFAULT_RATE_MIN,
  GAME_CODE_PATTERN,
  GAME_NAME_MAX_LENGTH,
  GAME_STATUS,
  type GameStatus,
  MASTER_DATA_NOTE_MAX_LENGTH,
  TICKETS_PER_BOOK_MAX,
  TICKETS_PER_BOOK_MIN,
  isGameStatus,
  isValidUnitPrice,
} from "@repo/domain/project/lottery-master-data";
import { isTagPaletteKey } from "@repo/domain/project/tag-palette";

/**
 * 遊戲欄位的驗證(專案規格 5.1):一次收齊所有不合的欄位,由呼叫端丟一個 `VALIDATION_FAILED`。
 * 每支 `check*` 回整理後的值;不合時把欄位名放進 `errors` 並回 null。
 */
export class GameFieldErrors {
  readonly fields: string[] = [];

  add(field: string): null {
    if (!this.fields.includes(field)) {
      this.fields.push(field);
    }
    return null;
  }
}

export function checkGameCode(
  value: string,
  errors: GameFieldErrors,
): string | null {
  const trimmed = value.trim();
  return GAME_CODE_PATTERN.test(trimmed) ? trimmed : errors.add("gameCode");
}

export function checkName(
  value: string,
  errors: GameFieldErrors,
): string | null {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > GAME_NAME_MAX_LENGTH
    ? errors.add("name")
    : trimmed;
}

function checkInteger(
  value: number,
  min: number,
  max: number,
  field: string,
  errors: GameFieldErrors,
): number | null {
  return Number.isInteger(value) && value >= min && value <= max
    ? value
    : errors.add(field);
}

/** 單張金額:正整數、100 的倍數(可輸入的下拉,也可自填;使用者 10/28 定案)。 */
export function checkUnitPrice(
  value: number,
  errors: GameFieldErrors,
): number | null {
  return isValidUnitPrice(value) ? value : errors.add("unitPrice");
}

export function checkTicketsPerBook(
  value: number,
  errors: GameFieldErrors,
): number | null {
  return checkInteger(
    value,
    TICKETS_PER_BOOK_MIN,
    TICKETS_PER_BOOK_MAX,
    "ticketsPerBook",
    errors,
  );
}

export function checkDefaultRate(
  value: number,
  errors: GameFieldErrors,
): number | null {
  return checkInteger(
    value,
    DEFAULT_RATE_MIN,
    DEFAULT_RATE_MAX,
    "defaultRate",
    errors,
  );
}

/** 顏色:只能從色票選;null = 不設定。 */
export function checkColor(
  value: string | null,
  errors: GameFieldErrors,
): string | null {
  if (value === null) {
    return null;
  }
  return isTagPaletteKey(value) ? value : errors.add("color");
}

/** 狀態:缺席 / null 由呼叫端決定預設(新增 = 販售中)。 */
export function checkStatus(
  value: string,
  errors: GameFieldErrors,
): GameStatus {
  if (isGameStatus(value)) {
    return value;
  }
  errors.add("status");
  return GAME_STATUS.onSale;
}

/** 備註:前後空白去掉;空字串 = 不設定(null)。 */
export function checkNote(
  value: string | null,
  errors: GameFieldErrors,
  field = "note",
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  return trimmed.length > MASTER_DATA_NOTE_MAX_LENGTH
    ? errors.add(field)
    : trimmed;
}
