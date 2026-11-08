import { randomUUID } from "node:crypto";

import { type GraphqlResponse, graphql, graphqlOk } from "../graphql";

/**
 * 刮刮樂的前置操作(TEST-11:前置一律走 api)。正本是 `packages/graphql/src/documents/project/`,
 * 這裡只抄 e2e 用到的欄位。
 */

const CREATE_CASH_POINT = `
mutation E2eCreateLotteryCashPoint($input: CreateLotteryCashPointInput!) {
  createLotteryCashPoint(input: $input) { item { id } }
}`;

const CREATE_GAME = `
mutation E2eCreateLotteryGame($input: CreateLotteryGameInput!) {
  createLotteryGame(input: $input) { item { id } }
}`;

const CREATE_DEALER = `
mutation E2eCreateLotteryDealer($input: CreateLotteryDealerInput!) {
  createLotteryDealer(input: $input) { item { id } }
}`;

const CREATE_BANK_ACCOUNT = `
mutation E2eCreateLotteryBankAccount($input: CreateLotteryBankAccountInput!) {
  createLotteryBankAccount(input: $input) { item { id } }
}`;

const RECEIVE_BOOK = `
mutation E2eReceiveLotteryPurchaseBook($input: ReceiveLotteryPurchaseBookInput!) {
  receiveLotteryPurchaseBook(input: $input) { rowId }
}`;

const SPLIT_BOOK = `
mutation E2eSplitLotteryBook($input: SplitLotteryBookInput!) {
  splitLotteryBook(input: $input) { count }
}`;

const OPEN_SHIFT = `
mutation E2eOpenLotteryShift($input: OpenLotteryShiftInput!) {
  openLotteryShift(input: $input) { item { id } }
}`;

const CUSTOMIZE_SETTING = `
mutation E2eCustomizeLotterySetting($input: CustomizeLotterySettingInput!) {
  customizeLotterySetting(input: $input) { settings { orgId } }
}`;

const INVENTORY_BOOKS = `
query E2eLotteryInventoryBooks($input: LotteryInventoryBooksInput!) {
  lotteryInventoryBooks(input: $input) { items { id bookNo } }
}`;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function createCashPoint(
  token: string,
  input: { orgId: string; positionKey: string; name: string; order: number },
): Promise<string> {
  const data = await graphqlOk<{
    createLotteryCashPoint: { item: { id: string } };
  }>(CREATE_CASH_POINT, { input }, token);
  return data.createLotteryCashPoint.item.id;
}

export interface GameInput {
  gameCode: string;
  name: string;
  unitPrice: number;
  ticketsPerBook: number;
}

export async function createGame(
  token: string,
  game: GameInput,
): Promise<string> {
  const claimDeadline = new Date();
  // 兌獎截止日推算上市日(−9 個月)與停售日(−3 個月):往後 8 個月 = 已上市、還沒停售
  claimDeadline.setMonth(claimDeadline.getMonth() + 8);
  const data = await graphqlOk<{
    createLotteryGame: { item: { id: string } };
  }>(
    CREATE_GAME,
    {
      input: {
        ...game,
        defaultRate: 92,
        claimDeadline: claimDeadline.toISOString(),
      },
    },
    token,
  );
  return data.createLotteryGame.item.id;
}

export async function createClassADealer(
  token: string,
  input: { licenseNo: string; name: string; nationalId: string },
): Promise<string> {
  const data = await graphqlOk<{
    createLotteryDealer: { item: { id: string } };
  }>(
    CREATE_DEALER,
    {
      input: {
        ...input,
        type: "A",
        status: "ACTIVE",
        licenseApprovedAt: daysFromNow(-365),
        licenseExpiresAt: daysFromNow(365),
      },
    },
    token,
  );
  return data.createLotteryDealer.item.id;
}

export async function createBankAccount(
  token: string,
  input: { accountNo: string; orgIds: readonly string[] },
): Promise<string> {
  const data = await graphqlOk<{
    createLotteryBankAccount: { item: { id: string } };
  }>(
    CREATE_BANK_ACCOUNT,
    {
      input: {
        bankCode: "812",
        branchName: "e2e 分行",
        accountNo: input.accountNo,
        accountName: "e2e 帳戶",
        openingBalance: 1_000_000,
        openingDate: daysFromNow(-30),
        shareOrgs: input.orgIds.map((orgId) => ({
          orgId,
          includeDescendants: false,
        })),
      },
    },
    token,
  );
  return data.createLotteryBankAccount.item.id;
}

export async function receiveBook(
  token: string,
  submissionId: string,
  code: string,
): Promise<void> {
  await graphqlOk(RECEIVE_BOOK, { input: { submissionId, code } }, token);
}

export async function splitBook(
  token: string,
  input: {
    orgId: string;
    bookId: string;
    assignments: readonly { cashPointId: string; ticketNos: string[] }[];
  },
): Promise<void> {
  await graphqlOk(
    SPLIT_BOOK,
    { input: { ...input, skippedTicketNos: [] } },
    token,
  );
}

export async function openShift(
  token: string,
  cashPointId: string,
): Promise<string> {
  const data = await graphqlOk<{ openLotteryShift: { item: { id: string } } }>(
    OPEN_SHIFT,
    { input: { cashPointId, temporaryCover: true } },
    token,
  );
  return data.openLotteryShift.item.id;
}

export async function customizeSetting(
  token: string,
  input: { orgId: string; key: string; option: string },
): Promise<void> {
  await graphqlOk(CUSTOMIZE_SETTING, { input }, token);
}

export async function bookIdOf(
  token: string,
  orgId: string,
  bookNo: string,
): Promise<string> {
  const data = await graphqlOk<{
    lotteryInventoryBooks: { items: { id: string; bookNo: string }[] };
  }>(INVENTORY_BOOKS, { input: { orgId, bookNo } }, token);
  const found = data.lotteryInventoryBooks.items.find(
    (item) => item.bookNo === bookNo,
  );
  if (found === undefined) {
    throw new Error(`庫存找不到本 ${bookNo}`);
  }
  return found.id;
}

const FIELD_CATEGORIES = `
query E2eFieldCategories {
  fieldCategories { items { id key } }
}`;

const CREATE_FIELD = `
mutation E2eCreateField($input: CreateFieldInput!) {
  createField(input: $input) { field { id } }
}`;

/** 建這個租戶自己的崗位選項(收銀點要掛崗位;專案 seed 不內建)。 */
export async function createPosition(
  token: string,
  input: { value: string; label: string; order: number },
): Promise<void> {
  const { fieldCategories } = await graphqlOk<{
    fieldCategories: { items: { id: string; key: string }[] };
  }>(FIELD_CATEGORIES, {}, token);
  const category = fieldCategories.items.find(
    (item) => item.key === "schedule-position",
  );
  if (category === undefined) {
    throw new Error("欄位管理沒有「崗位」類別:update 沒跑專案 seed");
  }
  await graphqlOk(
    CREATE_FIELD,
    { input: { ...input, categoryId: category.id } },
    token,
  );
}

const ASSIGN_FORM = `
mutation E2eAssignForm($input: AssignFormToTenantsInput!) {
  assignFormToTenants(input: $input) { form { key } }
}`;

/** 平台管理員把受管表單分派給租戶(開通時由 demo 指令 / 平台管理員做;租戶看不到沒分派的表單)。 */
export async function assignForms(
  rootToken: string,
  tenantOrgId: string,
  formKeys: readonly string[],
): Promise<void> {
  for (const formKey of formKeys) {
    await graphqlOk(
      ASSIGN_FORM,
      { input: { formKey, tenantOrgIds: [tenantOrgId] } },
      rootToken,
    );
  }
}

const BOOK_CARD = `
query E2eLotteryStoreBookCard($orgId: ID!, $bookId: ID!) {
  lotteryStoreBookCard(orgId: $orgId, bookId: $bookId) {
    item { tickets { ticketNo status unmatched } }
  }
}`;

export interface CardTicket {
  ticketNo: string;
  status: string;
  unmatched: boolean;
}

/** 一本每張的狀態(畫面上的動作做完後,用來斷言張的最終狀態)。 */
export async function bookTickets(
  token: string,
  orgId: string,
  bookId: string,
): Promise<CardTicket[]> {
  const data = await graphqlOk<{
    lotteryStoreBookCard: { item: { tickets: CardTicket[] } };
  }>(BOOK_CARD, { orgId, bookId }, token);
  return data.lotteryStoreBookCard.item.tickets;
}

const SUBMIT_FORM = `
mutation E2eCreateAndSubmit($input: CreateAndSubmitFormSubmissionInput!) {
  createAndSubmitFormSubmission(input: $input) { submission { id status } }
}`;

/**
 * 臨時盤點單一收銀點:這一組 `gameId` 數到 `presentCount` 張,少的 `investigateCount` 張記 [待查]
 *(`stocktake_confirm` 的 `draft` 形狀正本是 `@repo/domain/project/lottery` 的 `StocktakeDraft`;
 * 審核者就是申請人時自動通過,送出即完成,系統照挑張順序挑張記待查·未對號)。
 */
export async function submitCountStocktake(
  token: string,
  input: {
    orgId: string;
    cashPointId: string;
    scopeLabel: string;
    gameId: string;
    presentCount: number;
    investigateCount: number;
  },
): Promise<string> {
  const now = new Date().toISOString();
  const draft = {
    version: 1,
    orgId: input.orgId,
    scopeCashPointId: input.cashPointId,
    startedAt: now,
    lines: [],
    unopened: [],
    lostReview: [],
    countMode: "count",
    purpose: "normal",
    countLines: [
      {
        gameId: input.gameId,
        cashPointId: input.cashPointId,
        countedAt: now,
        presentCount: input.presentCount,
        recounts: [],
        saleCount: 0,
        saleRefIds: [],
        investigateCount: input.investigateCount,
        flagged: false,
      },
    ],
  };
  const data = await graphqlOk<{
    createAndSubmitFormSubmission: { submission: { id: string } };
  }>(
    SUBMIT_FORM,
    {
      input: {
        formKey: "stocktake_confirm",
        clientRequestId: `e2e-stocktake-${randomUUID()}`,
        values: {
          branch: input.orgId,
          scope_label: input.scopeLabel,
          totals: "",
          draft: JSON.stringify(draft),
        },
      },
    },
    token,
  );
  return data.createAndSubmitFormSubmission.submission.id;
}

const MOVE_BY_COUNT = `
mutation E2eMoveByCount($input: MoveLotteryTicketsByCountInput!) {
  moveLotteryTicketsByCount(input: $input) { count }
}`;

/** [依張數移櫃](回原始結果:劇本要斷言 `MOVE_PAUSED`)。 */
export function moveByCountRaw(
  token: string,
  input: {
    orgId: string;
    gameId: string;
    fromCashPointId: string;
    toCashPointId: string;
    count: number;
  },
): Promise<GraphqlResponse<unknown>> {
  return graphql(MOVE_BY_COUNT, { input }, token);
}

const SELL_BY_COUNT = `
mutation E2eSellByCount($input: SellLotteryTicketsByCountInput!) {
  sellLotteryTicketsByCount(input: $input) { items { refId count } }
}`;

/** [依張數標記售出](原因「太忙沒刷」;要那台開著自己的班)。 */
export async function sellByCount(
  token: string,
  input: { orgId: string; cashPointId: string; gameId: string; count: number },
): Promise<void> {
  await graphqlOk(
    SELL_BY_COUNT,
    {
      input: {
        orgId: input.orgId,
        localCashPointId: input.cashPointId,
        lines: [{ gameId: input.gameId, count: input.count }],
        reasonKey: "too-busy",
      },
    },
    token,
  );
}
