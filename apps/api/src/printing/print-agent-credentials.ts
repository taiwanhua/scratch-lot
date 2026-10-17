import { createHash, randomBytes, randomInt } from "node:crypto";

import { Types } from "mongoose";

import {
  PRINT_PAIRING_CODE_ALPHABET,
  PRINT_PAIRING_CODE_LENGTH,
} from "@repo/domain/printing";

import type { OperatorContext } from "../database/operator-context";

/** 代理程式金鑰的前綴(在 log / 設定檔裡一眼認得出是什麼)。 */
const AGENT_KEY_PREFIX = "pa_";

/**
 * 金鑰與配對碼的雜湊(SHA-256,hex)。兩者都是伺服器產生的高熵亂數(金鑰 256 位元;
 * 配對碼 8 碼 × 32 字元 = 40 位元且只活 10 分鐘),不是人選的密碼,所以不需要慢雜湊。
 */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 新的長期代理程式金鑰(只回給代理程式一次;資料庫只存 `hashSecret`)。 */
export function generateAgentKey(): string {
  return `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** 新的 8 碼配對碼(字元集去掉易混淆的 0 O 1 I)。 */
export function generatePairingCode(): string {
  let code = "";
  for (let index = 0; index < PRINT_PAIRING_CODE_LENGTH; index += 1) {
    code += PRINT_PAIRING_CODE_ALPHABET.charAt(
      randomInt(PRINT_PAIRING_CODE_ALPHABET.length),
    );
  }
  return code;
}

/**
 * 內部讀取用的上下文(可見全部):只用在「還不知道是誰」的查找 ——
 * 以金鑰 / 配對碼雜湊找代理程式、排程掃描逾時的工作。找到之後的讀寫一律改用 `agentOperator`。
 */
export function internalReader(): OperatorContext {
  return {
    actorId: null,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

/**
 * 代理程式身分的上下文:沒有登入主體(`actorId` null),**可見範圍只有自己的分店** ——
 * 資料層的租戶過濾因此保證它讀寫不到別的分店的印表機與工作(「金鑰只能領自己分店的工作」)。
 */
export function agentOperator(orgId: Types.ObjectId): OperatorContext {
  return {
    actorId: null,
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [],
    memberOrgIds: [],
    roleIds: [],
  };
}

/** 字串是不是合法的 ObjectId(`Types.ObjectId.isValid` 對 12 字元字串也回 true,這裡只收 24 碼 hex)。 */
export function parseObjectId(value: unknown): Types.ObjectId | null {
  return typeof value === "string" && /^[\da-f]{24}$/i.test(value)
    ? new Types.ObjectId(value)
    : null;
}
