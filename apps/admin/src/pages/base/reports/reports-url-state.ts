import { z } from "zod";

export { reportConditionsSchema } from "@/lib/base/reports/report-conditions";

/**
 * 「輸出報表」頁放進網址的狀態(REACT-14;盤點在 `app/base/url-state-inventory.ts`):
 *
 * - `report`:選的報表 key(空 = 選單第一張)
 * - `conditions`:期間、組織、其他條件(`reportConditionsSchema`)
 * - `preview`:預覽開著沒、顯示第幾個工作表(0 = 全部組織合計)
 */
export const REPORTS_URL_KEYS = ["report", "conditions", "preview"] as const;

export const reportKeySchema = z.string().default("");

export const reportPreviewSchema = z
  .object({ open: z.boolean(), sheet: z.number().int().min(0) })
  .default({ open: false, sheet: 0 });
