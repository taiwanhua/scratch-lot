import { type AdminError, parseAdminError } from "@/lib/base/errors";

import type { FieldManagerErrorCode } from "./field-manager-types";

/**
 * 本頁會收到的業務錯誤碼(GQL-04;正本 `docs/modules/field-manager.md`「api 介面」)。
 * 認不出來的一律當 `UNEXPECTED`,文案在 `admin.fieldManager.errors.*`。
 */
const FIELD_MANAGER_ERROR_CODES = [
  "FIELD_VALUE_DUPLICATE",
  "FIELD_CATEGORY_KEY_DUPLICATE",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
] as const;

/**
 * `FORBIDDEN` 依 `extensions.reason` 再分一層(#264):`NOT_OWNER` 是「別的組織加的選項」,
 * 與種子選項的全域開關是兩回事,文案不同 —— 所以它在本頁被當成獨立的一碼。
 * 類別作業同理:`SYSTEM_CATEGORY`(系統類別不可停用)、`ROOT_ONLY`(類別只能在根組織管理)。
 */
const REFINED_FORBIDDEN_REASONS = [
  "NOT_OWNER",
  "SYSTEM_CATEGORY",
  "ROOT_ONLY",
] as const;

type RefinedForbiddenReason = (typeof REFINED_FORBIDDEN_REASONS)[number];

const isRefinedReason = (reason: unknown): reason is RefinedForbiddenReason =>
  (REFINED_FORBIDDEN_REASONS as readonly unknown[]).includes(reason);

/** 共用形狀(`lib/base/errors.ts`);本頁只看 `code`(細分的 reason 已折進 `code`)。 */
export type FieldManagerError = AdminError<FieldManagerErrorCode, never>;

export const fieldManagerErrorOf = (error: unknown): FieldManagerError =>
  parseAdminError<Exclude<FieldManagerErrorCode, "UNEXPECTED">, never>(error, {
    codes: FIELD_MANAGER_ERROR_CODES,
    refine: (code, reason) =>
      code === "FORBIDDEN" && isRefinedReason(reason) ? reason : undefined,
  });
