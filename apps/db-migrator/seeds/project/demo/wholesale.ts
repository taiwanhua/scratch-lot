import { randomUUID } from "node:crypto";

import {
  WHOLESALE_FIELD_KEYS as KEYS,
  WHOLESALE_FORM_KEY,
  WHOLESALE_PAYMENT_MODE,
} from "@repo/domain/project/lottery";

import { type OnboardingStep, requireBranchId } from "../onboarding/context";

/** 一位示範批售客戶(經銷商管理 → 批售客戶,規格 21.2;`createLotteryWholesaleCustomer` 的 input)。 */
export interface DemoWholesaleCustomer {
  /** 重跑時以證號找回(已存在就不動) */
  licenseNo: string;
  storeName: string;
  contactName: string;
  phone: string;
  address: string;
  /** 共用給哪些分店(總部建的客戶要給分店開批售單,就共用給那些分店;規格 21.2) */
  sharedWith: readonly string[];
}

/** 證號、電話、地址是虛構的示範值(格式合法),不是真實資料。 */
export const DEMO_WHOLESALE_CUSTOMERS: readonly DemoWholesaleCustomer[] = [
  {
    licenseNo: "90000031",
    storeName: "示範客戶 好運彩券行",
    contactName: "林示範",
    phone: "0223000031",
    address: "台北市示範路 31 號",
    sharedWith: ["中山店", "信義店"],
  },
];

/** 一張示範批售單(規格 21.3;一列一整本)。 */
export interface DemoWholesale {
  /** 出貨分店 */
  branch: string;
  /** 批售客戶的證號(須在 `DEMO_WHOLESALE_CUSTOMERS` 內) */
  customerLicenseNo: string;
  /** 入帳帳戶(銀行代碼 + 帳號,須在 `DEMO_BANK_ACCOUNTS` 內、使用組織含出貨分店) */
  account: { bankCode: string; accountNo: string };
  /** 要批售的未拆本(遊戲代號 + 本號);出貨分店沒有這一本可批售時略過 */
  books: readonly { gameCode: string; bookNo: string }[];
  /** 批購金額率(整數 %) */
  rate: number;
  note: string;
}

/**
 * 示範批售單:中山店賣一本未拆的 5164 發大財給「示範客戶 好運彩券行」,收款方式「從帳戶入帳」、帳戶 A、
 * 批購金額率 93(整本 20,000 → 批售金額 18,600)。用「從帳戶入帳」:核准時同一個交易出貨並自動記一筆
 * 銀行「批售收入」= 批售金額,完成後結清,帳本與收付一致,不必另外記收款。
 */
export const DEMO_WHOLESALES: readonly DemoWholesale[] = [
  {
    branch: "中山店",
    customerLicenseNo: "90000031",
    account: { bankCode: "812", accountNo: "000123456789" },
    books: [{ gameCode: "5164", bookNo: "0071202" }],
    rate: 93,
    note: "示範批售單",
  },
];

const CUSTOMERS = /* GraphQL */ `
  query DemoWholesaleCustomers($input: LotteryWholesaleCustomersInput!) {
    lotteryWholesaleCustomers(input: $input) {
      items {
        id
        licenseNo
      }
    }
  }
`;

const CREATE_CUSTOMER = /* GraphQL */ `
  mutation DemoCreateWholesaleCustomer(
    $input: CreateLotteryWholesaleCustomerInput!
  ) {
    createLotteryWholesaleCustomer(input: $input) {
      item {
        id
      }
    }
  }
`;

const WHOLESALES = /* GraphQL */ `
  query DemoWholesales($input: LotteryWholesalesInput!) {
    lotteryWholesales(input: $input) {
      items {
        id
        serialNo
        status
      }
    }
  }
`;

const OPTIONS = /* GraphQL */ `
  query DemoWholesaleOptions($fromOrgId: ID!) {
    lotteryWholesaleOptions(fromOrgId: $fromOrgId) {
      books {
        bookId
        gameId
        gameCode
        bookNo
        tickets
        bookPrice
      }
    }
  }
`;

const BANK_ACCOUNTS = /* GraphQL */ `
  query DemoWholesaleBankAccounts($input: LotteryBankAccountsInput!) {
    lotteryBankAccounts(input: $input) {
      items {
        id
        bankCode
        accountNo
      }
    }
  }
`;

const SUBMIT = /* GraphQL */ `
  mutation DemoSubmitWholesale($input: CreateAndSubmitFormSubmissionInput!) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        id
        status
        serialNo
      }
    }
  }
`;

/** 已經送過(沒被駁回、作廢)的批售單:重跑不再送一張。 */
const SETTLED_ELSEWHERE = new Set(["VOIDED", "REJECTED"]);

type Client = Parameters<OnboardingStep["run"]>[0]["client"];

/** 找回或建立客戶;回 證號 → id。 */
async function ensureCustomers(
  client: Client,
  state: Parameters<OnboardingStep["run"]>[0]["state"],
  lines: string[],
): Promise<Map<string, string>> {
  const idOf = new Map<string, string>();
  for (const customer of DEMO_WHOLESALE_CUSTOMERS) {
    const { lotteryWholesaleCustomers } = await client.request<{
      lotteryWholesaleCustomers: {
        items: { id: string; licenseNo: string | null }[];
      };
    }>(CUSTOMERS, { input: { keyword: customer.licenseNo, pageSize: 100 } });
    const found = lotteryWholesaleCustomers.items.find(
      (item) => item.licenseNo === customer.licenseNo,
    );
    if (found !== undefined) {
      idOf.set(customer.licenseNo, found.id);
      lines.push(`批售客戶「${customer.storeName}」已存在`);
      continue;
    }
    const { sharedWith, ...input } = customer;
    const { createLotteryWholesaleCustomer } = await client.request<{
      createLotteryWholesaleCustomer: { item: { id: string } };
    }>(CREATE_CUSTOMER, {
      input: {
        ...input,
        shareOrgs: sharedWith.map((branch) => ({
          orgId: requireBranchId(state, branch),
          includeDescendants: false,
        })),
      },
    });
    idOf.set(customer.licenseNo, createLotteryWholesaleCustomer.item.id);
    lines.push(
      `建立批售客戶「${customer.storeName}」:共用給 ${sharedWith.join("、")}`,
    );
  }
  return idOf;
}

/**
 * **示範資料專用**的一步:批售客戶與一張批售單(規格 21.8「示範資料」)。批售客戶不在開通清單裡
 * (開通清單寫「不用預先建」),所以不放進 `onboarding/steps.ts`。只用經銷商管理與表單引擎既有的 GraphQL。
 *
 * 批售單由租戶管理員送出,流程照開通時綁的「出貨確認」(出貨分店的店長),**要那家店的店長在申請中心核准**
 * 後才出貨並完成(同小金庫起始現金:示範帳號首登要改密碼,指令不代替店長核准)。所以排在「流程」與
 * 「銀行帳戶」之後。出貨分店沒有指定的那一本可以批售(還沒有庫存,或已經拆過、被鎖)就略過並提示;
 * 這位客戶已經有一張沒被駁回、作廢的批售單就不再送。
 */
export const demoWholesaleStep: OnboardingStep = {
  key: "demo-wholesale",
  title: "示範批售客戶與批售單",
  run: async ({ client, state }) => {
    const lines: string[] = [];
    const customerIdOf = await ensureCustomers(client, state, lines);
    const { lotteryBankAccounts } = await client.request<{
      lotteryBankAccounts: {
        items: { id: string; bankCode: string; accountNo: string }[];
      };
    }>(BANK_ACCOUNTS, { input: { pageSize: 100 } });
    for (const wholesale of DEMO_WHOLESALES) {
      const customerId = customerIdOf.get(wholesale.customerLicenseNo);
      if (customerId === undefined) {
        throw new Error(
          `找不到批售客戶 ${wholesale.customerLicenseNo}(示範批售客戶要先建)`,
        );
      }
      const { lotteryWholesales } = await client.request<{
        lotteryWholesales: {
          items: { serialNo: string | null; status: string }[];
        };
      }>(WHOLESALES, { input: { customerId, pageSize: 100 } });
      const existing = lotteryWholesales.items.find(
        (item) => !SETTLED_ELSEWHERE.has(item.status),
      );
      if (existing !== undefined) {
        lines.push(
          `「${wholesale.branch}」已有示範批售單 ${existing.serialNo ?? "(草稿)"}`,
        );
        continue;
      }
      const account = lotteryBankAccounts.items.find(
        (item) =>
          item.bankCode === wholesale.account.bankCode &&
          item.accountNo === wholesale.account.accountNo,
      );
      if (account === undefined) {
        throw new Error(
          `找不到帳戶 ${wholesale.account.bankCode} ${wholesale.account.accountNo}(示範銀行帳戶要先建)`,
        );
      }
      const orgId = requireBranchId(state, wholesale.branch);
      const { lotteryWholesaleOptions } = await client.request<{
        lotteryWholesaleOptions: {
          books: {
            bookId: string;
            gameId: string;
            gameCode: string;
            bookNo: string;
            tickets: number;
            bookPrice: number;
          }[];
        };
      }>(OPTIONS, { fromOrgId: orgId });
      const books = wholesale.books.map((wanted) =>
        lotteryWholesaleOptions.books.find(
          (book) =>
            book.gameCode === wanted.gameCode && book.bookNo === wanted.bookNo,
        ),
      );
      if (books.includes(undefined)) {
        const names = wholesale.books
          .map((book) => `${book.gameCode}-${book.bookNo}`)
          .join("、");
        lines.push(
          `「${wholesale.branch}」沒有可批售的 ${names}(還沒有庫存或已拆、被鎖),略過示範批售單`,
        );
        continue;
      }
      const { createAndSubmitFormSubmission } = await client.request<{
        createAndSubmitFormSubmission: {
          submission: { status: string; serialNo: string | null };
        };
      }>(SUBMIT, {
        input: {
          formKey: WHOLESALE_FORM_KEY,
          // 前一次被駁回 / 作廢後重跑要換一個 id(同建立者 + 同 id 會回原本那一筆);
          // 這位客戶的批售單筆數只增不減,當流水用
          clientRequestId: `demo-wholesale-${customerId}-${String(lotteryWholesales.items.length)}`,
          values: {
            [KEYS.fromBranch]: orgId,
            [KEYS.customer]: customerId,
            [KEYS.paymentMode]: WHOLESALE_PAYMENT_MODE.autoBank,
            [KEYS.account]: account.id,
            [KEYS.note]: wholesale.note,
            [KEYS.lines]: books.flatMap((book) =>
              book === undefined
                ? []
                : [
                    {
                      rowId: randomUUID(),
                      [KEYS.game]: book.gameId,
                      [KEYS.book]: book.bookId,
                      [KEYS.tickets]: book.tickets,
                      [KEYS.bookPrice]: book.bookPrice,
                      [KEYS.rate]: wholesale.rate,
                    },
                  ],
            ),
          },
          touched: [
            KEYS.fromBranch,
            KEYS.customer,
            KEYS.paymentMode,
            KEYS.account,
            KEYS.note,
            KEYS.lines,
          ],
        },
      });
      const { status, serialNo } = createAndSubmitFormSubmission.submission;
      lines.push(
        status === "COMPLETED"
          ? `「${wholesale.branch}」示範批售單 ${serialNo ?? ""} 已完成`
          : `「${wholesale.branch}」示範批售單 ${serialNo ?? ""} 已送出,請${wholesale.branch}店長到申請中心核准出貨(核准時自動記帳戶的批售收入)`,
      );
    }
    return lines;
  },
};
