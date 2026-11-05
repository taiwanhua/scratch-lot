import { randomInt, randomUUID } from "node:crypto";

import type { ScenarioTenant } from "../scenario-tenant";
import { publishCustomWorkflow, submitForm } from "../workflow-api";
import {
  assignForms,
  bookIdOf,
  bookTickets,
  createBankAccount,
  createCashPoint,
  createClassADealer,
  createGame,
  createPosition,
  customizeSetting,
  openShift,
  receiveBook,
  splitBook,
} from "./lottery-api";

/**
 * 張數店劇本的前置(`docs/testing/project/scenarios.md`;TEST-11:全部走 api)。
 *
 * 刮刮樂的張只有一條路進系統:進貨單點收。所以每條劇本照開通與進貨的順序鋪:
 * 平台管理員分派受管表單 → 租戶建崗位、遊戲、甲類、帳戶 → 進貨單綁「點收」流程 → 送單 → 點收 → 拆本上檯面 → 開班。
 */

/** 張數店劇本用到的受管表單:進貨單(進貨)、結帳確認(交班)、盤點確認(盤點)。 */
const SCENARIO_FORMS = ["purchase", "checkout_confirm", "stocktake_confirm"];

const POSITIONS = [
  { value: "e2e-counter-a", label: "櫃台A", order: 1 },
  { value: "e2e-counter-b", label: "櫃台B", order: 2 },
];

export const CASH_POINT_A = "A 台";
export const CASH_POINT_B = "B 台";

/** 一本 10 張:#001–#006 拆到 A 台、#007–#010 拆到 B 台(全店重刷一張一張刷,本要小)。 */
export const BOOK_TICKETS = 10;
const TICKET_NOS = Array.from({ length: BOOK_TICKETS }, (_, index) =>
  String(index + 1).padStart(3, "0"),
);
const ON_CASH_POINT_A = TICKET_NOS.slice(0, 6);
const ON_CASH_POINT_B = TICKET_NOS.slice(6);

export const UNIT_PRICE = 200;
const GAME_NAME = "發大財";

export interface LotteryTenant {
  tenant: ScenarioTenant;
  /** 操作者(+tenant):租戶擁有者,也是進貨單的點收人、班的負責人。 */
  token: string;
  dealerId: string;
  accountId: string;
  gameId: string;
  gameCode: string;
  /** 遊戲在畫面上的寫法:「5164 發大財」。 */
  gameLabel: string;
}

export interface LotteryStore {
  orgId: string;
  cashPointA: string;
  cashPointB: string;
  bookId: string;
  bookNo: string;
  /** 正面條碼 = 本號 7 位 + 張號 3 位。 */
  codeOf: (ticketNo: string) => string;
}

function randomDigits(length: number): string {
  return Array.from({ length }, () => String(randomInt(10))).join("");
}

/** 台北當天 0 點(表單的日期欄存的是租戶時區那一天的起點)。 */
function tenantToday(): string {
  const taipeiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = taipeiNow.toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}

/**
 * 表單綁一關的流程,審核者 = +tenant(開通的流程是「店長」條件,`onboarding/form-workflows/`;劇本不驗審核)。
 * `applicant`:申請人就是審核者時照常審核(進貨單、結帳確認)/ 自動通過(盤點確認,送出即完成)。
 */
async function publishReviewWorkflow(
  tenant: ScenarioTenant,
  formKey: string,
  stepName: string,
  applicant: true | "review",
): Promise<void> {
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `t${tenant.slug}_${formKey}`,
    name: `${formKey} 流程`,
    bindFormKey: formKey,
    definition: {
      edges: null,
      steps: [
        {
          key: "review",
          name: stepName,
          kind: "review",
          mode: "any",
          skipWhen: null,
          allowReturn: true,
          autoApprove: { applicant },
          assignee: {
            kind: "audience",
            audience: {
              mode: "match",
              filter: {
                op: "AND",
                children: [
                  {
                    field: "user",
                    cond: "in",
                    value: {
                      kind: "static",
                      values: [tenant.tenantAdmin.userId],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
}

/** 這個租戶的刮刮樂主檔與進貨流程。`storeOrgIds` 是會進貨的分店(帳戶的使用組織)。 */
export async function createLotteryTenant(
  tenant: ScenarioTenant,
  storeOrgIds: readonly string[],
): Promise<LotteryTenant> {
  const token = tenant.tenantAdmin.token;
  await assignForms(tenant.rootToken, tenant.tenantOrgId, SCENARIO_FORMS);
  for (const position of POSITIONS) {
    await createPosition(token, position);
  }
  const gameCode = String(randomInt(1000, 10_000));
  const gameId = await createGame(token, {
    gameCode,
    name: GAME_NAME,
    unitPrice: UNIT_PRICE,
    ticketsPerBook: BOOK_TICKETS,
  });
  const dealerId = await createClassADealer(token, {
    licenseNo: randomDigits(8),
    name: "劇本甲類",
    nationalId: "Z900000011",
  });
  const accountId = await createBankAccount(token, {
    accountNo: randomDigits(12),
    orgIds: storeOrgIds,
  });
  await publishReviewWorkflow(tenant, "purchase", "點收", "review");
  await publishReviewWorkflow(tenant, "checkout_confirm", "店長審核", "review");
  await publishReviewWorkflow(tenant, "stocktake_confirm", "店長審核", true);
  return {
    tenant,
    token,
    dealerId,
    accountId,
    gameId,
    gameCode,
    gameLabel: `${gameCode} ${GAME_NAME}`,
  };
}

/** 分店的 A 台、B 台,進一本貨並拆到兩台(分店要已經是這條劇本要的盤點制度:張數店的拆本規則不同)。 */
export async function stockStore(
  lottery: LotteryTenant,
  orgId: string,
): Promise<LotteryStore> {
  const { token, gameId, gameCode, dealerId, accountId } = lottery;
  const cashPointA = await createCashPoint(token, {
    orgId,
    positionKey: "e2e-counter-a",
    name: CASH_POINT_A,
    order: 1,
  });
  const cashPointB = await createCashPoint(token, {
    orgId,
    positionKey: "e2e-counter-b",
    name: CASH_POINT_B,
    order: 2,
  });
  // 本號第一碼是 0:背面編號只有後 6 碼(`matchReceiveScan`)
  const bookNo = `0${randomDigits(6)}`;
  const purchase = await submitForm(token, "purchase", {
    branch: orgId,
    dealer: dealerId,
    self_purchase: true,
    purchase_date: tenantToday(),
    account: accountId,
    lines: [
      {
        rowId: randomUUID(),
        game: gameId,
        book_no: bookNo,
        last_ticket_no: BOOK_TICKETS,
        tickets: BOOK_TICKETS,
        book_price: BOOK_TICKETS * UNIT_PRICE,
        rate: 92,
      },
    ],
  });
  const lastTicketNo = TICKET_NOS.at(-1) ?? "";
  await receiveBook(
    token,
    purchase.id,
    `${gameCode}-1-${bookNo.slice(1)}-${lastTicketNo}-0-0`,
  );
  const bookId = await bookIdOf(token, orgId, bookNo);
  await splitBook(token, {
    orgId,
    bookId,
    assignments: [
      { cashPointId: cashPointA, ticketNos: ON_CASH_POINT_A },
      { cashPointId: cashPointB, ticketNos: ON_CASH_POINT_B },
    ],
  });
  return {
    orgId,
    cashPointA,
    cashPointB,
    bookId,
    bookNo,
    codeOf: (ticketNo) => `${bookNo}${ticketNo}`,
  };
}

/** 南港店設成張數店(自訂一筆)、備好貨,+tenant 開 A 台的班(期初零用金 0,應有現金就是賣的錢)。 */
export async function createCountStore(tenant: ScenarioTenant): Promise<{
  lottery: LotteryTenant;
  store: LotteryStore;
}> {
  const lottery = await createLotteryTenant(tenant, [tenant.nangangOrgId]);
  await customizeSetting(lottery.token, {
    orgId: tenant.nangangOrgId,
    key: "count_mode",
    option: "count",
  });
  const store = await stockStore(lottery, tenant.nangangOrgId);
  await openShift(lottery.token, store.cashPointA);
  return { lottery, store };
}

/** 這本裡某種狀態的張號(依張號排序);`unmatched` 不給 = 不看未對號記號。 */
export async function ticketNosOf(
  lottery: LotteryTenant,
  store: LotteryStore,
  status: string,
  unmatched?: boolean,
): Promise<string[]> {
  const tickets = await bookTickets(lottery.token, store.orgId, store.bookId);
  return tickets
    .filter(
      (ticket) =>
        ticket.status === status &&
        (unmatched === undefined || ticket.unmatched === unmatched),
    )
    .map((ticket) => ticket.ticketNo);
}
