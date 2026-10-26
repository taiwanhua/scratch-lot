import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
  type LotteryTransferOptionsQuery,
  type LotteryTransferReceivingFieldsFragment,
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
import { masterDataOrgs } from "./master-data-fixtures";

/**
 * 叫貨與進貨 → 調貨單(規格 8.4、第 9 章;Figma PU-08–PU-10)的夾具。模組與 seed
 * `apps/db-migrator/seeds/project/purchasing.transfer.ts` 同形;表單定義與受管表單同形
 * (`seeds/project/revisions/transfer.r3.seed.ts`)。四筆單:草稿 T-0009、第一關出貨確認 T-0008
 * (中山店 → 新竹店,沿用帳戶管理夾具的單據 id `doc-t8`)、第二關點收 T-0010(新竹店 → 中山店)、已完成 T-0007。
 */
export const TRANSFER_MODULE_KEY = "purchasing.transfer";
export const TRANSFER_FORM_KEY = "transfer";

export const TRANSFER_ALL_PERMISSIONS = [
  "purchasing.transfer.view",
  "purchasing.transfer.create",
  "purchasing.transfer.edit",
  "purchasing.transfer.delete",
  "purchasing.transfer.partial-tickets",
  "purchasing.transfer.pay",
  "purchasing.transfer.receive",
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
  parentId: `m-${TRANSFER_MODULE_KEY}`,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

/** 調貨單的模組(掛在叫貨與進貨群組底下);`omit` 列的權限 key 拿掉。 */
export const transferModules = (omit: readonly string[] = []): TestModule[] => [
  node(TRANSFER_MODULE_KEY, "調貨單", 3, "/purchasing/transfer", {
    parentId: "m-purchasing",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Form,
    icon: "receipt",
    permissions: TRANSFER_ALL_PERMISSIONS.filter((key) => !omit.includes(key)),
  }),
  ...(
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(
      `${TRANSFER_MODULE_KEY}.${page}`,
      name,
      index + 1,
      `/purchasing/transfer/${page}`,
    ),
  ),
];

const reference = (key: string, label: string, provider: string) =>
  field(key, label, "reference", {
    widget: { kind: "referencePicker" },
    source: { provider, labelField: "name" },
  });

export const transferDefinition = (): FormDefinition => ({
  fields: [
    reference("from_branch", "出貨分店", "org"),
    reference("to_branch", "收貨分店", "org"),
    field("requisition", "叫貨單", "text"),
    field("transfer_total", "調貨金額", "number", {
      precision: 0,
      widget: { kind: "number" },
    }),
    field("note", "備註", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "調貨單",
        rows: [
          {
            cols: [
              { fieldKey: "from_branch", span: 6 },
              { fieldKey: "to_branch", span: 6 },
            ],
          },
          {
            cols: [
              { fieldKey: "requisition", span: 6 },
              { fieldKey: "transfer_total", span: 6 },
            ],
          },
        ],
      },
    ],
  },
  summaryMap: { title: "note", amount: "transfer_total" },
  prefills: [],
});

export const transferForm = {
  key: TRANSFER_FORM_KEY,
  name: "調貨單",
  moduleKey: TRANSFER_MODULE_KEY,
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

const { storeA, storeB } = masterDataOrgs;

const transfer = (
  id: string,
  serialNo: string,
  from: { id: string; name: string },
  to: { id: string; name: string },
  amount: number,
  overrides: Partial<MockSubmission> = {},
): MockSubmission =>
  submissionFragment({
    id,
    serialNo,
    moduleKey: TRANSFER_MODULE_KEY,
    formKey: TRANSFER_FORM_KEY,
    formName: "調貨單",
    status: FormSubmissionStatus.Reviewing,
    values: {
      from_branch: { id: from.id, label: from.name },
      to_branch: { id: to.id, label: to.name },
      requisition: "R-0022",
      transfer_total: String(amount),
      note: null,
    },
    displayValues: [
      {
        fieldKey: "from_branch",
        items: [{ value: from.id, label: from.name, available: true }],
      },
      {
        fieldKey: "to_branch",
        items: [{ value: to.id, label: to.name, available: true }],
      },
    ],
    summary: { title: null, date: null, amount: String(amount) },
    createdBy: { id: "user-wang", name: "王小明" },
    abilities: LOCKED,
    currentInstanceId: null,
    ...overrides,
  });

/** Figma PU-08 的筆數:草稿、在途(第一關出貨確認)、點收中、已完成。 */
export const transferSubmissions = (): MockSubmission[] => [
  transfer("sub-t9", "T-0009", storeA, storeB, 18_400, {
    status: FormSubmissionStatus.Draft,
    abilities: {
      ...LOCKED,
      canEdit: true,
      canSaveDraft: true,
      canDelete: true,
    },
    values: {
      from_branch: { id: storeA.id, label: storeA.name },
      to_branch: { id: storeB.id, label: storeB.name },
      requisition: "R-0022",
      transfer_total: "18400",
      note: null,
      lines: [
        {
          rowId: "row-1",
          game: { id: "game-5164", label: "發大財" },
          book: { id: "book-6501", label: "5164-056501" },
          mode: "whole",
          ticket_nos: "001-100",
          tickets: 100,
          amount: 20_000,
          rate: 92,
        },
      ],
    },
  }),
  transfer("doc-t8", "T-0008", storeA, storeB, 1840),
  transfer("doc-t10", "T-0010", storeB, storeA, 19_504),
  transfer("sub-t7", "T-0007", storeB, storeA, 36_800, {
    status: FormSubmissionStatus.Completed,
  }),
];

/** 列表欄位配置(與 seed 初值同):單號、出貨店、收貨店、調貨金額 + 狀態。 */
export const transferListColumns = (): ModuleListColumn[] => [
  {
    kind: ModuleListColumnKind.Slot,
    key: "serialNo",
    formKey: null,
    width: 110,
    order: 0,
  },
  ...(
    [
      ["from_branch", 120],
      ["to_branch", 120],
      ["transfer_total", 110],
    ] as const
  ).map(([key, width], order) => ({
    kind: ModuleListColumnKind.Field,
    key,
    formKey: TRANSFER_FORM_KEY,
    width,
    order: order + 1,
  })),
];

export const TRANSFER_LIST_BUILTIN = {
  form: false,
  status: true,
  createdBy: false,
};

export const transferFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [transferForm],
  versions: { [`${TRANSFER_FORM_KEY}@1`]: transferDefinition() },
  submissions: transferSubmissions(),
  listColumns: { [TRANSFER_MODULE_KEY]: transferListColumns() },
  listBuiltin: { [TRANSFER_MODULE_KEY]: TRANSFER_LIST_BUILTIN },
  ...overrides,
});

const book = (
  bookId: string,
  gameCode: string,
  gameName: string,
  bookNo: string,
  unitPrice: number,
  isWhole: boolean,
  availableCount = 100,
  lastTicketNo = availableCount,
) => ({
  __typename: "LotteryTransferBook" as const,
  bookId,
  gameId: `game-${gameCode}`,
  gameCode,
  gameName,
  bookNo,
  unitPrice,
  bookPrice: unitPrice * 100,
  rate: 92,
  isWhole,
  availableCount,
  lastTicketNo,
});

/** 新增頁的選項(出貨分店不論是哪一家都回同一份)。 */
export const transferOptions =
  (): LotteryTransferOptionsQuery["lotteryTransferOptions"] => ({
    __typename: "LotteryTransferOptions",
    books: [
      book("book-56527", "5164", "發大財", "0056527", 200, false, 88),
      book("book-1233", "5201", "金好運", "0001233", 100, true),
      book("book-1234", "5201", "金好運", "0001234", 100, true),
    ],
    requisitions: [
      {
        __typename: "LotteryTransferRequisition",
        id: "req-22",
        serialNo: "R-0022",
        books: 2,
      },
    ],
    // 收貨店 5201:預計 3、已給 2、在途 1 → 再調 1 整本就超過(只警告)
    allocations: [
      {
        __typename: "LotteryTransferAllocation",
        gameId: "game-5201",
        plannedBooks: 3,
        givenBooks: 2,
        inTransitBooks: 1,
      },
    ],
  });

/** 拆過的那本的格子:#001–011、#032、#048 已售,其餘可以調。 */
export const transferBookTickets = () =>
  Array.from({ length: 100 }, (_, index) => {
    const ticketNo = String(index + 1).padStart(3, "0");
    const isSold = index < 11 || ticketNo === "032" || ticketNo === "048";
    return {
      __typename: "LotteryTransferTicketCell" as const,
      ticketNo,
      state: isSold ? "sold" : "available",
    };
  });

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

const row = (
  rowId: string,
  overrides: Partial<LotteryTransferReceivingFieldsFragment["rows"][number]>,
): LotteryTransferReceivingFieldsFragment["rows"][number] => ({
  __typename: "LotteryTransferRow",
  rowId,
  bookId: `book-${rowId}`,
  gameCode: "5164",
  gameName: "發大財",
  bookNo: "0056527",
  mode: "partial",
  ticketNos: [],
  tickets: 0,
  amount: 0,
  rate: 92,
  purchaseAmount: 0,
  shipped: false,
  received: false,
  receivedAt: null,
  shippedAt: null,
  batchId: null,
  receivedTicketNos: [],
  ...overrides,
});

/** 檢視頁:T-0008 第一關出貨確認(中山店 → 新竹店;PU-10a)、T-0010 第二關點收(新竹店 → 中山店;PU-10b)。 */
export const transferReceiving = (
  submissionId: string,
): LotteryTransferReceivingFieldsFragment =>
  submissionId === "doc-t10"
    ? {
        __typename: "LotteryTransferReceiving",
        submissionId,
        fromBranchName: storeB.name,
        toBranchName: storeA.name,
        transferAmount: 19_504,
        canReceive: true,
        receivedCount: 1,
        totalCount: 2,
        rows: [
          row("t10-1", {
            bookNo: "0056530",
            mode: "whole",
            ticketNos: range(1, 100),
            tickets: 100,
            amount: 20_000,
            purchaseAmount: 18_400,
            shipped: true,
            shippedAt: "2026-10-16T01:10:00.000Z",
            received: true,
            receivedAt: "2026-10-16T07:20:00.000Z",
            batchId: "tbatch-1",
            receivedTicketNos: range(1, 100),
          }),
          row("t10-2", {
            gameCode: "5201",
            gameName: "金好運",
            bookNo: "0060112",
            ticketNos: range(45, 56),
            tickets: 12,
            amount: 1200,
            purchaseAmount: 1104,
            shipped: true,
            shippedAt: "2026-10-16T01:10:00.000Z",
          }),
        ],
        batches: [
          {
            batchId: "tbatch-1",
            no: 1,
            completedAt: "2026-10-16T07:25:00.000Z",
            rowIds: ["t10-1"],
          },
        ],
      }
    : {
        __typename: "LotteryTransferReceiving",
        submissionId,
        fromBranchName: storeA.name,
        toBranchName: storeB.name,
        transferAmount: 1840,
        canReceive: false,
        receivedCount: 0,
        totalCount: 1,
        rows: [
          row("t8-1", {
            ticketNos: range(90, 99),
            tickets: 10,
            amount: 2000,
            purchaseAmount: 1840,
          }),
        ],
        batches: [],
      };

/** 編輯頁的測試資料(`transfer-edit-fixtures.ts`)共用 */
export {
  LOCKED as TRANSFER_LOCKED_ABILITIES,
  range as transferTicketRange,
  row as transferReceivingRow,
  transfer as transferSubmission,
};
