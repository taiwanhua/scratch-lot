import { purchaseWorkflow } from "./purchase";
import { requisitionWorkflow } from "./requisition";
import { supportRequestWorkflow } from "./support-request";
import type { FormWorkflowSpec } from "./types";

/**
 * 開通時建立的流程,一張表單一列(規格 2.1;開通清單「表單代號與流程」)。
 * 表單票在本目錄新增自己的一檔,在這裡加一行;不改別人的。
 */
export const FORM_WORKFLOWS: readonly FormWorkflowSpec[] = [
  // 排班作業:支援需求單(規格 14.10)
  supportRequestWorkflow,
  // 叫貨、採購單:叫貨單(規格 8.1)
  requisitionWorkflow,
  // 叫貨與進貨:進貨單(規格 8.2)
  purchaseWorkflow,
];
