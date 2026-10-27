import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";

import {
  ATTENDANCE_PERMISSIONS,
  MAKEUP_PREFILL_KEYS,
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
} from "./attendance-keys";

/** 補打卡新增頁帶入的值(規格 14.8 入口:補打卡時間、分店、類型、對應排班;本人可以改)。 */
export interface MakeupPunchPrefill {
  /** 補打卡時間(ISO 時點) */
  at?: string;
  orgId?: string;
  type?: "in" | "out";
  entryId?: string;
}

/**
 * 缺卡的那一班 → 帶入值:類型 = 缺的第一張(缺上班卡就是上班),補打卡時間 = 那張卡的排班時間
 * (上班 = 排班上班時點、下班 = 排班下班時點;跨午夜的班下班落在隔天),分店與對應排班 = 這一班。
 */
export const makeupPrefillOf = (entry: {
  entryId: string;
  orgId: string;
  startAt: string;
  endAt: string;
  missing: readonly string[];
}): MakeupPunchPrefill => {
  const type = entry.missing.includes("in") ? "in" : "out";
  return {
    at: type === "in" ? entry.startAt : entry.endAt,
    orgId: entry.orgId,
    type,
    entryId: entry.entryId,
  };
};

/**
 * 補打卡新增頁的網址(帶入值放網址參數);沒有 `schedule.attendance.create` 或沒綁新增頁 → null(不顯示入口)。
 */
export const useMakeupPunchHref = ():
  ((prefill?: MakeupPunchPrefill) => string) | null => {
  const access = useFormModuleAccess(MAKEUP_PUNCH_MODULE_KEY);
  const { hasPermission } = usePermissions();
  const route = access.createRoute;
  if (route === null || !hasPermission(ATTENDANCE_PERMISSIONS.create)) {
    return null;
  }
  return (prefill = {}) => {
    const params = new URLSearchParams();
    if (prefill.at !== undefined) {
      params.set(MAKEUP_PREFILL_KEYS.at, prefill.at);
    }
    if (prefill.orgId !== undefined) {
      params.set(MAKEUP_PREFILL_KEYS.org, prefill.orgId);
    }
    if (prefill.type !== undefined) {
      params.set(MAKEUP_PREFILL_KEYS.type, prefill.type);
    }
    if (prefill.entryId !== undefined) {
      params.set(MAKEUP_PREFILL_KEYS.entry, prefill.entryId);
    }
    const query = params.toString();
    const suffix = query === "" ? "" : `?${query}`;
    return `${route}/${MAKEUP_PUNCH_FORM_KEY}${suffix}`;
  };
};
