import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";

import {
  ATTENDANCE_PERMISSIONS,
  MAKEUP_PREFILL_KEYS,
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
} from "./attendance-keys";

/** 補打卡新增頁帶入的值(規格 14.8 入口:日期、分店、類型、對應排班;本人可以改)。 */
export interface MakeupPunchPrefill {
  /** `YYYY-MM-DD` */
  date?: string;
  orgId?: string;
  type?: "in" | "out";
  entryId?: string;
}

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
    if (prefill.date !== undefined) {
      params.set(MAKEUP_PREFILL_KEYS.date, prefill.date);
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
