import { z } from "zod";

export { reportConditionsSchema } from "@/lib/project/reports/report-conditions";

/**
 * 「輸出報表」頁放進網址的狀態(REACT-14;盤點在 `app/project/url-state-inventory.ts`):
 *
 * - `report`:選的報表 key(空 = 選單第一張)
 * - `conditions`:期間、分店、其他條件(`reportConditionsSchema`)
 * - `preview`:預覽開著沒、顯示第幾個工作表(0 = 全部分店合計)
 */
export const REPORTS_URL_KEYS = ["report", "conditions", "preview"] as const;

export const reportKeySchema = z.string().default("");

export const reportPreviewSchema = z
  .object({ open: z.boolean(), sheet: z.number().int().min(0) })
  .default({ open: false, sheet: 0 });
