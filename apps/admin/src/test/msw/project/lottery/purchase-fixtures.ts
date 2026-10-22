import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
  type LotteryPurchaseOptionsQuery,
  type LotteryPurchaseReceivingFieldsFragment,
  ModuleEngine,
  type ModuleListColumn,
  ModuleListColumnKind,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";
import {
  type MockSubmission,
  field,
  submissionFragment,
} from "../../form-fixtures";
import type { FormRuntimeWorldOptions } from "../../form-runtime-handlers";
import { purchaseAllocations } from "./purchase-allocation-fixtures";

/**
 * 叫貨與進貨 → 進貨單(規格 8.2、8.3;Figma PU-04–PU-07、PU-11)的夾具。模組與 seed
 * `apps/db-migrator/seeds/project/purchasing.purchase.ts` 同形;表單定義與受管表單同形
 * (`seeds/project/revisions/purchase.r2.seed.ts`,不含兌獎)。兩筆送出過的單沿用帳戶管理夾具的
 * 單據 id(`doc-p31` / `doc-p33`),結算區塊讀得到同一份收付。
 */
export const PURCHASE_MODULE_KEY = "purchasing.purchase";
export const PURCHASE_FORM_KEY = "purchase";

export const PURCHASE_ALL_PERMISSIONS = [
  "purchasing.purchase.view",
  "purchasing.purchase.create",
  "purchasing.purchase.edit",
  "purchasing.purchase.delete",
  "purchasing.purchase.settle",
] as const;

const node = (
  key: string,
  name: string,
  order: number,
  route: string,
  overrides: Partial<TestModule> = {},
): TestModule => ({
  id: `m-${key}`,
  key,
  name,
  parentId: `m-${PURCHASE_MODULE_KEY}`,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

/** 進貨單的模組(掛在叫貨與進貨群組底下);`omit` 列的權限 key 拿掉。 */
export const purchaseModules = (omit: readonly string[] = []): TestModule[] => [
  node(PURCHASE_MODULE_KEY, "進貨單", 2, "/purchasing/purchase", {
    parentId: "m-purchasing",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Form,
    icon: "receipt",
    permissions: PURCHASE_ALL_PERMISSIONS.filter((key) => !omit.includes(key)),
  }),
  ...(
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(
      `${PURCHASE_MODULE_KEY}.${page}`,
      name,
      index + 1,
      `/purchasing/purchase/${page}`,
    ),
  ),
];

const reference = (key: string, label: string, provider: string) =>
  field(key, label, "reference", {
    widget: { kind: "referencePicker" },
    source: { provider, labelField: "name" },
  });

export const purchaseDefinition = (): FormDefinition => ({
  fields: [
    reference("branch", "進貨分店", "org"),
    field("requisition", "叫貨單", "text"),
    reference("dealer", "批購甲類", "lottery_dealer"),
    field("self_purchase", "本人批購", "boolean", {
      widget: { kind: "switch" },
    }),
    reference("trustee", "批購受託人", "lottery_dealer_contact"),
    field("purchase_date", "批購日期", "date", {
      widget: { kind: "datePicker" },
    }),
    reference("account", "扣款帳戶", "lottery_bank_account"),
    field("purchase_total", "批購合計", "number", {
      precision: 0,
      widget: { kind: "number" },
    }),
    field("deducted_amount", "扣款金額", "number", {
      precision: 0,
      widget: { kind: "number" },
    }),
    field("note", "備註", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "單據內容",
        rows: [
          {
            cols: [
              { fieldKey: "branch", span: 6 },
              { fieldKey: "self_purchase", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "requisition", span: 6 },
              { fieldKey: "purchase_date", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "dealer", span: 6 },
              { fieldKey: "account", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "purchase_total", span: 6 },
              { fieldKey: "deducted_amount", span: 6 },
            ],
          },
        ],
      },
    ],
  },
  summaryMap: {
    title: "note",
    date: "purchase_date",
    amount: "deducted_amount",
  },
  prefills: [],
});

export const purchaseForm = {
  key: PURCHASE_FORM_KEY,
  name: "進貨單",
  moduleKey: PURCHASE_MODULE_KEY,
  currentVersion: 1,
  tabLabelTemplate: "{{form}} {{date}}",
  allowDraft: true,
  canCreate: true,
};

const LOCKED = {
  canEdit: false,
  canSaveDraft: false,
  canDelete: false,
  canEditField: [],
  canWithdraw: false,
  canVoid: false,
  canCopy: false,
};

const BRANCH = { id: "org-store", name: "中山店" };

const purchase = (
  id: string,
  serialNo: string,
  dealer: string,
  amount: number,
  overrides: Partial<MockSubmission> = {},
): MockSubmission =>
  submissionFragment({
    id,
    serialNo,
    moduleKey: PURCHASE_MODULE_KEY,
    formKey: PURCHASE_FORM_KEY,
    formName: "進貨單",
    status: FormSubmissionStatus.Reviewing,
    values: {
      branch: BRANCH.id,
      requisition: "R-0021",
      dealer: { id: "dealer-a", label: dealer },
      self_purchase: false,
      trustee: { id: "contact-1", label: "林受託" },
      purchase_date: "2026-10-12T16:00:00.000Z",
      account: { id: "acc-1", label: "台灣銀行 ****12345" },
      purchase_total: String(amount),
      deducted_amount: String(amount),
      note: null,
    },
    displayValues: [
      {
        fieldKey: "branch",
        items: [{ value: BRANCH.id, label: BRANCH.name, available: true }],
      },
    ],
    summary: {
      title: null,
      date: "2026-10-12T16:00:00.000Z",
      amount: String(amount),
    },
    createdBy: { id: "user-wang", name: "王小明" },
    abilities: LOCKED,
    currentInstanceId: null,
    ...overrides,
  });

/** Figma PU-04 的四筆:草稿、審核中(點收 4 / 6)、已完成待退、已完成已結清。 */
export const purchaseSubmissions = (): MockSubmission[] => [
  purchase("sub-p34", "P-0034", "林大同 #87654321", 0, {
    status: FormSubmissionStatus.Draft,
    abilities: { ...LOCKED, canEdit: true, canDelete: true },
  }),
  purchase("doc-p33", "P-0033", "林大同 #87654321", 36_800),
  purchase("doc-p31", "P-0031", "陳志明 #12345678", 16_400, {
    status: FormSubmissionStatus.Completed,
  }),
  purchase("sub-p30", "P-0030", "林大同 #87654321", 36_800, {
    status: FormSubmissionStatus.Completed,
  }),
];

/** 列表欄位配置(與 seed 初值同):單號、進貨分店、甲類、批購日、扣款金額 + 狀態。 */
export const purchaseListColumns = (): ModuleListColumn[] => [
  {
    kind: ModuleListColumnKind.Slot,
    key: "serialNo",
    formKey: null,
    width: 110,
    order: 0,
  },
  ...(
    [
      ["branch", 120],
      ["dealer", 160],
      ["purchase_date", 110],
      ["deducted_amount", 110],
    ] as const
  ).map(([key, width], order) => ({
    kind: ModuleListColumnKind.Field,
    key,
    formKey: PURCHASE_FORM_KEY,
    width,
    order: order + 1,
  })),
];

export const PURCHASE_LIST_BUILTIN = {
  form: false,
  status: true,
  createdBy: false,
};

export const purchaseFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [purchaseForm],
  versions: { [`${PURCHASE_FORM_KEY}@1`]: purchaseDefinition() },
  submissions: purchaseSubmissions(),
  listColumns: { [PURCHASE_MODULE_KEY]: purchaseListColumns() },
  listBuiltin: { [PURCHASE_MODULE_KEY]: PURCHASE_LIST_BUILTIN },
  ...overrides,
});

/** 新增頁的選項(進貨分店不論是哪一家都回同一份)。 */
export const purchaseOptions =
  (): LotteryPurchaseOptionsQuery["lotteryPurchaseOptions"] => ({
    __typename: "LotteryPurchaseOptions",
    dealers: [
      {
        __typename: "LotteryPurchaseOption",
        id: "dealer-a",
        label: "林大同 · 87654321",
      },
      {
        __typename: "LotteryPurchaseOption",
        id: "dealer-b",
        label: "陳志明 · 12345678",
      },
    ],
    trustees: [
      {
        __typename: "LotteryPurchaseTrustee",
        dealerId: "dealer-a",
        id: "contact-1",
        label: "林受託",
      },
    ],
    accounts: [
      {
        __typename: "LotteryPurchaseOption",
        id: "acc-1",
        label: "台灣銀行 中山分行 ****12345",
      },
    ],
    requisitions: [
      {
        __typename: "LotteryPurchaseRequisition",
        id: "sub-req-0042",
        serialNo: "R-0042",
        lines: [
          {
            __typename: "LotteryPurchaseRequisitionLine",
            gameId: "game-5164",
            books: 2,
          },
          {
            __typename: "LotteryPurchaseRequisitionLine",
            gameId: "game-5201",
            books: 2,
          },
          {
            __typename: "LotteryPurchaseRequisitionLine",
            gameId: "game-5150",
            books: 1,
          },
        ],
      },
    ],
    games: [
      {
        __typename: "LotteryPurchaseGame",
        id: "game-5150",
        gameCode: "5150",
        name: "好運旺旺",
        unitPrice: 500,
        ticketsPerBook: 50,
        bookPrice: 25_000,
        defaultRate: 92,
      },
      {
        __typename: "LotteryPurchaseGame",
        id: "game-5164",
        gameCode: "5164",
        name: "發大財",
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
      },
      {
        __typename: "LotteryPurchaseGame",
        id: "game-5201",
        gameCode: "5201",
        name: "金好運",
        unitPrice: 100,
        ticketsPerBook: 100,
        bookPrice: 10_000,
        defaultRate: 92,
      },
    ],
    allocations: purchaseAllocations(),
  });

const receivingRow = (
  rowId: string,
  bookNo: string,
  lastTicketNo: number,
  bookPrice: number,
  received: boolean,
) => ({
  __typename: "LotteryPurchaseReceivingRow" as const,
  rowId,
  bookNo,
  lastTicketNo,
  tickets: 100,
  bookPrice,
  rate: 92,
  amount: Math.round((bookPrice * 92) / 100),
  received,
  receivedAt: received ? "2026-10-13T01:40:00.000Z" : null,
  batchId: null,
});

/** Figma PU-06:5164 叫貨 5、已刷 4;5201 叫貨 1、已刷 1(審核中那一筆)。 */
export const purchaseReceiving = (
  submissionId = "doc-p33",
): LotteryPurchaseReceivingFieldsFragment => ({
  __typename: "LotteryPurchaseReceiving",
  submissionId,
  canReceive: true,
  receivedCount: 5,
  totalCount: 6,
  groups: [
    {
      __typename: "LotteryPurchaseReceivingGroup",
      gameId: "game-5164",
      gameCode: "5164",
      gameName: "發大財",
      unitPrice: 200,
      requestedBooks: 5,
      receivedBooks: 4,
      subtotal: 92_368,
      rows: [
        receivingRow("row-1", "0056527", 99, 20_000, true),
        receivingRow("row-2", "0056528", 99, 20_000, true),
        receivingRow("row-3", "0056529", 99, 20_000, true),
        receivingRow("row-4", "0056530", 101, 20_400, true),
        receivingRow("row-5", "0056531", 99, 20_000, false),
      ],
    },
    {
      __typename: "LotteryPurchaseReceivingGroup",
      gameId: "game-5201",
      gameCode: "5201",
      gameName: "金好運",
      unitPrice: 100,
      requestedBooks: 1,
      receivedBooks: 1,
      subtotal: 9200,
      rows: [receivingRow("row-6", "0001233", 99, 10_000, true)],
    },
  ],
  batches: [],
});
