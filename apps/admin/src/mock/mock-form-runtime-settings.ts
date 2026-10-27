import { LEAVE_FORM_KEY } from "@/test/msw/workflow-fixtures";

import { MOCK_DEMO_FORM_LIST_COLUMNS } from "./mock-form-serial";

/**
 * mock 模式表單執行端的表單層設定:
 * - 列表欄(`MOCK_DEMO_FORM_LIST_COLUMNS`)
 * - 作廢原因:病假單設了作廢原因類別,作廢對話框是「作廢原因」下拉(選「其他」要填說明);其他表單沒設 → 自由填寫理由
 */
export const MOCK_FORM_RUNTIME_SETTINGS = {
  listColumns: MOCK_DEMO_FORM_LIST_COLUMNS,
  voidReasonOptions: {
    [LEAVE_FORM_KEY]: {
      categoryKey: "void-reason",
      items: [
        { value: "wrong-date", label: "日期填錯" },
        { value: "duplicate", label: "重複申請" },
        { value: "other", label: "其他" },
      ],
    },
  },
};
