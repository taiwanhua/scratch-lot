import { HttpResponse } from "msw";

import type { FormDefinition } from "@repo/domain/form";
import {
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  FormSubmissionStatus,
  type LotteryStoreCashCorrectionRowFieldsFragment,
  type LotteryStoreSaleReversalRowFieldsFragment,
  type LotteryStoreShiftOptionFieldsFragment,
} from "@repo/graphql";

import { field } from "../../form-fixtures";
import type { FormRuntimeWorldOptions } from "../../form-runtime-handlers";
import { api, type server } from "../../server";

/**
 * 店面管理兩張表單(撤銷售出申請、現金更正單;規格 8.5、8.8)的夾具:定義與受管表單同形
 * (正本 `apps/db-migrator/seeds/project/revisions/sale_reversal.r1.seed.ts`、`cash_correction.r1.seed.ts`)、
 * Figma ST-31a / ST-32a 的列表列、退款班次的選項。元件測試、假 api 與 mock 模式共用。
 */

const shiftRef = (key: string, label: string) =>
  field(key, label, "reference", {
    widget: { kind: "referencePicker" },
    source: { provider: "lottery_shift", labelField: "label" },
  });

const staticOptions = (items: [string, string][]) => ({
  kind: "static" as const,
  items: items.map(([value, label], index) => ({
    value,
    label,
    order: index + 1,
    enabled: true,
  })),
});

export const saleReversalDefinition = (): FormDefinition => ({
  fields: [
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("reason", "原因", "select", {
      widget: { kind: "dropdown" },
      options: {
        kind: "fieldCategory",
        key: LOTTERY_FIELD_CATEGORY_KEYS.saleReversalReason,
      },
      rules: { required: true },
    }),
    field("refund", "退款給客人", "select", {
      widget: { kind: "radio" },
      options: staticOptions([
        ["yes", "是"],
        ["no", "否"],
      ]),
      rules: { required: true },
    }),
    {
      ...shiftRef("refund_shift", "退款班次"),
      visibleWhen: { "==": [{ var: "refund" }, "yes"] },
    },
    field("note", "說明", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "撤銷售出申請",
        rows: [
          {
            cols: [
              { fieldKey: "branch", span: 6 },
              { fieldKey: "reason", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "refund", span: 6 },
              { fieldKey: "refund_shift", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "note", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "note" },
  prefills: [],
});

export const cashCorrectionDefinition = (): FormDefinition => ({
  fields: [
    field("branch", "分店", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("direction", "方向", "select", {
      widget: { kind: "radio" },
      options: staticOptions([
        ["increase", "現金增加"],
        ["decrease", "現金減少"],
      ]),
      rules: { required: true },
    }),
    field("amount", "金額", "number", {
      precision: 0,
      widget: { kind: "number" },
      rules: { required: true, min: 1 },
    }),
    field("place", "位置", "select", {
      widget: { kind: "radio" },
      options: staticOptions([
        ["drawer", "某一班的抽屜"],
        ["vault", "小金庫"],
      ]),
      rules: { required: true },
      help: "關店後發現的錢一律選小金庫",
    }),
    {
      ...shiftRef("shift", "班次"),
      visibleWhen: { "==": [{ var: "place" }, "drawer"] },
      rules: { required: true },
    },
    shiftRef("attributed_shift", "歸屬班次(選填)"),
    field("reason", "原因類別", "select", {
      widget: { kind: "dropdown" },
      options: {
        kind: "fieldCategory",
        key: LOTTERY_FIELD_CATEGORY_KEYS.cashCorrectionReason,
      },
      rules: { required: true },
    }),
    field("note", "說明", "text", { rules: { required: true } }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "現金更正單",
        rows: [
          { cols: [{ fieldKey: "branch", span: 6 }] },
          {
            cols: [
              { fieldKey: "direction", span: 6 },
              { fieldKey: "amount", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "place", span: 6 },
              { fieldKey: "shift", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "attributed_shift", span: 6 },
              { fieldKey: "reason", span: 6 },
            ],
          },
          { cols: [{ fieldKey: "note", span: 12 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "note" },
  prefills: [],
});

/** 兩張表單都沒有草稿(表單設定「允許存草稿」關;規格 8 共通「草稿」)。 */
const storeForm = (key: string, name: string, canCreate: boolean) => ({
  key,
  name,
  moduleKey: STORE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: false,
  canCreate,
});

export interface StoreFormsWorldOptions {
  /** 登入者能不能新增(B9b `store.create-<formKey>`;預設都能)。 */
  canCreateSaleReversal?: boolean;
  canCreateCashCorrection?: boolean;
}

/** 表單執行端的假 api 選項(兩張表單的定義;沒有提交,列表走專用的查詢)。 */
export const storeFormsRuntime = ({
  canCreateSaleReversal = true,
  canCreateCashCorrection = true,
}: StoreFormsWorldOptions = {}): FormRuntimeWorldOptions => ({
  moduleForms: [
    storeForm(SALE_REVERSAL_FORM_KEY, "撤銷售出申請", canCreateSaleReversal),
    storeForm(CASH_CORRECTION_FORM_KEY, "現金更正單", canCreateCashCorrection),
  ],
  versions: {
    [`${SALE_REVERSAL_FORM_KEY}@1`]: saleReversalDefinition(),
    [`${CASH_CORRECTION_FORM_KEY}@1`]: cashCorrectionDefinition(),
  },
  // 現金更正單(表單引擎的新增頁)的「原因類別」下拉
  fieldOptions: {
    reason: [
      {
        __typename: "FormFieldOption",
        value: "customer-top-up",
        label: "客人補付",
      },
      {
        __typename: "FormFieldOption",
        value: "counterfeit",
        label: "假鈔",
      },
      {
        __typename: "FormFieldOption",
        value: "other",
        label: "其他",
      },
    ],
  },
});

/** Figma ST-31a 的兩列。 */
export const sampleSaleReversals =
  (): LotteryStoreSaleReversalRowFieldsFragment[] => [
    {
      __typename: "LotteryStoreSaleReversalRow",
      id: "sub-reversal-8",
      serialNo: "R-0008",
      status: FormSubmissionStatus.Reviewing,
      ticketGroups: ["5164 #031–032"],
      ticketCount: 2,
      reasonLabel: "客人退貨",
      refund: true,
      refundAmount: 400,
      refundShiftLabel: "店內櫃台 · 李小華 10/16 13:00",
      submittedAt: "2026-10-16T06:10:00.000Z",
    },
    {
      __typename: "LotteryStoreSaleReversalRow",
      id: "sub-reversal-7",
      serialNo: "R-0007",
      status: FormSubmissionStatus.Completed,
      ticketGroups: ["5201 #010"],
      ticketCount: 1,
      reasonLabel: "盤點錯誤",
      refund: false,
      refundAmount: 0,
      refundShiftLabel: null,
      submittedAt: "2026-10-15T02:00:00.000Z",
    },
  ];

/** Figma ST-32a 的兩列。 */
export const sampleCashCorrections =
  (): LotteryStoreCashCorrectionRowFieldsFragment[] => [
    {
      __typename: "LotteryStoreCashCorrectionRow",
      id: "sub-correction-12",
      serialNo: "X-0012",
      status: FormSubmissionStatus.Reviewing,
      direction: "increase",
      amount: 500,
      place: "drawer",
      placeShiftLabel: "店內櫃台 · 王小明 10/16 08:02",
      attributedShiftLabel: null,
      reasonLabel: "客人補付",
      submittedAt: "2026-10-16T06:20:00.000Z",
    },
    {
      __typename: "LotteryStoreCashCorrectionRow",
      id: "sub-correction-11",
      serialNo: "X-0011",
      status: FormSubmissionStatus.Completed,
      direction: "decrease",
      amount: 1000,
      place: "vault",
      placeShiftLabel: null,
      attributedShiftLabel: "店外攤位 · 陳美玲 10/12 14:00",
      reasonLabel: "假鈔",
      submittedAt: "2026-10-13T01:00:00.000Z",
    },
  ];

/** 退款班次的選項:王小明開著的店內櫃台(目前的班)+ 前一天已結帳的店外攤位。 */
export const sampleShiftOptions =
  (): LotteryStoreShiftOptionFieldsFragment[] => [
    {
      __typename: "LotteryStoreShiftOption",
      id: "shift-counter",
      label: "店內櫃台 · 王小明 10/16 08:02",
      openedAt: "2026-10-16T00:02:00.000Z",
      open: true,
      mine: true,
    },
    {
      __typename: "LotteryStoreShiftOption",
      id: "shift-outdoor-1015",
      label: "店外攤位 · 陳美玲 10/15 14:00",
      openedAt: "2026-10-15T06:00:00.000Z",
      open: false,
      mine: false,
    },
  ];

export interface StoreFormsWorld {
  handlers: Parameters<typeof server.use>;
  runtime: FormRuntimeWorldOptions;
}

/** 兩個分頁的列表、退款班次的選項(不論哪家店都回這份)與表單執行端的選項。 */
export const storeFormsWorld = (
  options: StoreFormsWorldOptions = {},
): StoreFormsWorld => ({
  runtime: storeFormsRuntime(options),
  handlers: [
    api.query("LotteryStoreSaleReversals", () =>
      HttpResponse.json({
        data: {
          lotteryStoreSaleReversals: { items: sampleSaleReversals() },
        },
      }),
    ),
    api.query("LotteryStoreCashCorrections", () =>
      HttpResponse.json({
        data: {
          lotteryStoreCashCorrections: { items: sampleCashCorrections() },
        },
      }),
    ),
    api.query("LotteryStoreShiftOptions", () =>
      HttpResponse.json({
        data: { lotteryStoreShiftOptions: { items: sampleShiftOptions() } },
      }),
    ),
  ],
});
