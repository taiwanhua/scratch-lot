import type { FormDefinition } from "@repo/domain/form";
import {
  FormSubmissionStatus,
  type LotteryWholesaleDetailQuery,
  type LotteryWholesaleFieldsFragment,
  type LotteryWholesaleOptionsQuery,
  ModuleEngine,
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
 * 叫貨與進貨 → 批售單(規格第 21 章;Figma WS-01–WS-05)的夾具。模組與 seed
 * `apps/db-migrator/seeds/project/purchasing.wholesale.ts` 同形。四筆單:草稿、W-0002(從帳戶入帳・審核中)、
 * W-0001(收到錢再核准・審核中,已收 20,000 / 37,200)、W-0004(已完成)。
 */
export const WHOLESALE_MODULE_KEY = "purchasing.wholesale";
export const WHOLESALE_FORM_KEY = "wholesale";

export const WHOLESALE_ALL_PERMISSIONS = [
  "purchasing.wholesale.view",
  "purchasing.wholesale.create",
  "purchasing.wholesale.edit",
  "purchasing.wholesale.delete",
  "purchasing.wholesale.receive",
] as const;

const { storeA } = masterDataOrgs;

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
  parentId: `m-${WHOLESALE_MODULE_KEY}`,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order,
  route,
  icon: null,
  permissions: [],
  ...overrides,
});

/** 批售單的模組(掛在叫貨與進貨群組底下);`omit` 列的權限 key 拿掉。 */
export const wholesaleModules = (
  omit: readonly string[] = [],
): TestModule[] => [
  node(WHOLESALE_MODULE_KEY, "批售單", 4, "/purchasing/wholesale", {
    parentId: "m-purchasing",
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Form,
    icon: "receipt",
    permissions: WHOLESALE_ALL_PERMISSIONS.filter((key) => !omit.includes(key)),
  }),
  ...(
    [
      ["view-page", "詳情"],
      ["create-page", "新增"],
      ["edit-page", "編輯"],
    ] as const
  ).map(([page, name], index) =>
    node(
      `${WHOLESALE_MODULE_KEY}.${page}`,
      name,
      index + 1,
      `/purchasing/wholesale/${page}`,
    ),
  ),
];

const reference = (key: string, label: string, provider: string) =>
  field(key, label, "reference", {
    widget: { kind: "referencePicker" },
    source: { provider, labelField: "name" },
  });

export const wholesaleDefinition = (): FormDefinition => ({
  fields: [
    reference("from_branch", "出貨分店", "org"),
    reference("customer", "批售客戶", "lottery_wholesale_customer"),
    field("wholesale_total", "批售金額", "number", {
      precision: 0,
      widget: { kind: "number" },
    }),
    field("note", "備註", "text"),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "批售單",
        rows: [
          {
            cols: [
              { fieldKey: "from_branch", span: 6 },
              { fieldKey: "customer", span: 6 },
            ],
          },
        ],
      },
    ],
  },
  summaryMap: { title: "note", amount: "wholesale_total" },
  prefills: [],
});

export const wholesaleForm = {
  key: WHOLESALE_FORM_KEY,
  name: "批售單",
  moduleKey: WHOLESALE_MODULE_KEY,
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
const EDITABLE = { ...LOCKED, canEdit: true, canSaveDraft: true };

const line = (rowId: string, bookId: string, bookNo: string, rate: number) => ({
  rowId,
  game: { id: "game-5164", label: "發大財" },
  book: { id: bookId, label: `5164-${bookNo}` },
  tickets: 100,
  book_price: 20_000,
  rate,
  amount: 200 * rate,
});

const GOOD_LUCK = { id: "wholesale-1", label: "好運彩券行 · 0223456789" };
const BIG_FORTUNE = { id: "wholesale-2", label: "大發彩券行 · 0912345678" };
const ACCOUNT = { id: "account-1", label: "台銀 中山分行 ····12345" };

const wholesale = (
  id: string,
  serialNo: string | null,
  values: Record<string, unknown>,
  overrides: Partial<MockSubmission> = {},
): MockSubmission =>
  submissionFragment({
    id,
    serialNo,
    moduleKey: WHOLESALE_MODULE_KEY,
    formKey: WHOLESALE_FORM_KEY,
    formName: "批售單",
    status: FormSubmissionStatus.Reviewing,
    values: {
      from_branch: { id: storeA.id, label: storeA.name },
      customer: GOOD_LUCK,
      payment_mode: "collect_first",
      account: null,
      note: null,
      ...values,
    },
    displayValues: [],
    summary: { title: null, date: null, amount: null },
    createdBy: { id: "user-lee", name: "李小華" },
    abilities: LOCKED,
    currentInstanceId: null,
    ...overrides,
  });

/** W-0005:被退回的單(編輯頁;明細另有一列讀不到內容)。 */
export const returnedWholesale = (): MockSubmission =>
  wholesale(
    "doc-w5",
    "W-0005",
    {
      lines: [
        line("w5-1", "book-w1", "056611", 93),
        line("w5-2", "book-w2", "056612", 92),
        line("w5-lost", "book-gone", "059999", 92),
      ],
    },
    { status: FormSubmissionStatus.Returned, abilities: EDITABLE },
  );

export const wholesaleSubmissions = (): MockSubmission[] => [
  wholesale(
    "sub-w3",
    null,
    { lines: [line("w3-1", "book-w3", "056613", 92)] },
    {
      status: FormSubmissionStatus.Draft,
      abilities: { ...EDITABLE, canDelete: true },
    },
  ),
  wholesale("doc-w2", "W-0002", {
    customer: BIG_FORTUNE,
    payment_mode: "auto_bank",
    account: ACCOUNT,
    lines: [line("w2-1", "book-w20", "056620", 95)],
  }),
  wholesale("doc-w1", "W-0001", {
    lines: [
      line("w1-1", "book-w1", "056611", 93),
      line("w1-2", "book-w2", "056612", 93),
    ],
  }),
  wholesale(
    "doc-w4",
    "W-0004",
    { lines: [line("w4-1", "book-w4", "056614", 93)] },
    { status: FormSubmissionStatus.Completed },
  ),
];

export const wholesaleFormWorld = (
  overrides: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  moduleForms: [wholesaleForm],
  versions: { [`${WHOLESALE_FORM_KEY}@1`]: wholesaleDefinition() },
  submissions: wholesaleSubmissions(),
  ...overrides,
});

const row = (
  overrides: Partial<LotteryWholesaleFieldsFragment> &
    Pick<LotteryWholesaleFieldsFragment, "id">,
): LotteryWholesaleFieldsFragment => ({
  __typename: "LotteryWholesale",
  serialNo: null,
  fromBranchName: storeA.name,
  customerName: "好運彩券行",
  paymentMode: "collect_first",
  books: 1,
  amount: 18_400,
  received: 0,
  settlementKind: null,
  settlementAmount: 0,
  inSettlement: false,
  status: FormSubmissionStatus.Reviewing,
  blocked: false,
  canDelete: false,
  ...overrides,
});

/** 列表的四列(Figma WS-01 + 一張已完成)。 */
export const wholesaleRows = (): LotteryWholesaleFieldsFragment[] => [
  row({
    id: "sub-w3",
    status: FormSubmissionStatus.Draft,
    canDelete: true,
  }),
  row({
    id: "doc-w2",
    serialNo: "W-0002",
    customerName: "大發彩券行",
    paymentMode: "auto_bank",
    amount: 19_000,
  }),
  row({
    id: "doc-w1",
    serialNo: "W-0001",
    books: 2,
    amount: 37_200,
    received: 20_000,
    settlementKind: "to_receive",
    settlementAmount: 17_200,
    inSettlement: true,
  }),
  row({
    id: "doc-w4",
    serialNo: "W-0004",
    amount: 18_600,
    received: 18_600,
    inSettlement: true,
    status: FormSubmissionStatus.Completed,
  }),
];

type Detail = LotteryWholesaleDetailQuery["lotteryWholesaleDetail"];

/** 檢視頁的內容(由提交的明細組出;`book-gone` 讀不到 → 不在裡面)。 */
export const wholesaleDetail = (
  id: string,
  submissions: readonly MockSubmission[],
): Detail | null => {
  const submission = submissions.find((one) => one.id === id);
  const listed = wholesaleRows().find((one) => one.id === id);
  if (submission === undefined) {
    return null;
  }
  const values = submission.values as {
    payment_mode: string;
    account: { label: string } | null;
    lines: ReturnType<typeof line>[];
  };
  return {
    __typename: "LotteryWholesaleDetail",
    submissionId: id,
    fromBranchName: storeA.name,
    customerName: listed?.customerName ?? "好運彩券行",
    paymentMode: values.payment_mode,
    accountLabel: values.account?.label ?? null,
    amount: values.lines.reduce((sum, one) => sum + one.amount, 0),
    received: listed?.received ?? 0,
    shippedAt: null,
    rows: values.lines
      .filter((one) => one.book.id !== "book-gone")
      .map((one) => ({
        __typename: "LotteryWholesaleRow",
        rowId: one.rowId,
        bookId: one.book.id,
        gameId: one.game.id,
        gameCode: "5164",
        gameName: "發大財",
        bookNo: `0${one.book.label.slice(5)}`,
        unitPrice: 200,
        defaultRate: 92,
        tickets: one.tickets,
        bookPrice: one.book_price,
        rate: one.rate,
        amount: one.amount,
        state: null,
      })),
  };
};

type Options = LotteryWholesaleOptionsQuery["lotteryWholesaleOptions"];

const optionBook = (
  bookId: string,
  bookNo: string,
  cost: number | null,
  overrides: Partial<Options["books"][number]> = {},
): Options["books"][number] => ({
  __typename: "LotteryWholesaleBook",
  bookId,
  gameId: "game-5164",
  gameCode: "5164",
  gameName: "發大財",
  bookNo: `0${bookNo}`,
  unitPrice: 200,
  tickets: 100,
  bookPrice: 20_000,
  defaultRate: 92,
  cost,
  ...overrides,
});

/** 新增頁的選項(Figma WS-02d);`showCost` = 有 `inventory.show-cost`。 */
export const wholesaleOptions = (showCost = false): Options => {
  const cost = (value: number) => (showCost ? value : null);
  return {
    __typename: "LotteryWholesaleOptions",
    books: [
      optionBook("book-w1", "056611", cost(18_400)),
      optionBook("book-w2", "056612", cost(18_000)),
      optionBook("book-w3", "056613", cost(18_400)),
      optionBook("book-g1", "060120", cost(9200), {
        gameId: "game-5201",
        gameCode: "5201",
        gameName: "金好運",
        unitPrice: 100,
        bookPrice: 10_000,
      }),
    ],
    customers: [GOOD_LUCK, BIG_FORTUNE].map((customer) => ({
      __typename: "LotteryWholesaleOption",
      ...customer,
    })),
    accounts: [{ __typename: "LotteryWholesaleOption", ...ACCOUNT }],
  };
};
