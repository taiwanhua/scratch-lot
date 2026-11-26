import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  WHOLESALE_CUSTOMER_TEXT_LIMITS,
  wholesaleAmountOf,
} from "@repo/domain/project/lottery";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { DEMO_STEPS, DEMO_TENANT, demoPlan } from ".";
import { PROJECT_FIELD_CATEGORIES } from "../field-categories";
import { parseOnboardingPlan } from "../onboarding/plan";
import { ONBOARDING_STEPS } from "../onboarding/steps";
import { rolesStep } from "../onboarding/steps/roles";
import { DEMO_BANK_ACCOUNTS } from "./bank-accounts";
import { DEMO_CASH_POINTS } from "./cash-points";
import {
  DEMO_CLASS_A_DEALERS,
  DEMO_CLASS_B_DEALERS,
  DEMO_TRUSTEES,
} from "./dealers";
import { DEMO_GAMES } from "./games";
import { DEMO_OPENINGS } from "./opening";
import { DEMO_BRANCHES } from "./organization";
import { DEMO_VAULT_CASH } from "./vault-cash";
import { DEMO_WHOLESALES, DEMO_WHOLESALE_CUSTOMERS } from "./wholesale";

const DEMO_DIR = __dirname;
const SOURCE_DIRS = [
  DEMO_DIR,
  path.join(DEMO_DIR, "..", "onboarding"),
  path.join(DEMO_DIR, "..", "..", "..", "src", "demo"),
];

/** 目錄底下(含子目錄)的程式檔,不含測試本身。 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [full]
      : [];
  });
}

/** 「@ 前後都是信箱字元、網域帶點」= 一個完整的信箱(只找存不存在,不必精確)。 */
const EMAIL = /[\w.+-]@[\w-]+\.\w/g;

describe("示範資料(seeds/project/demo/)不放機密", () => {
  it("沒有任何信箱:示範帳號只寫 + 別名,信箱執行時由基底信箱產生", () => {
    for (const file of sourceFiles(DEMO_DIR)) {
      // 註解裡的範例(<基底>+demo-admin@…)不是信箱;程式字串裡出現完整信箱就算
      const found = readFileSync(file, "utf8").match(EMAIL) ?? [];
      expect({ file, found }).toEqual({ file, found: [] });
    }
  });

  it("沒有密碼:沒有任何 password 欄位寫死值", () => {
    for (const file of sourceFiles(DEMO_DIR)) {
      const text = readFileSync(file, "utf8");
      expect({
        file,
        hardcoded: /password\s*[:=]\s*["'`]/i.test(text),
      }).toEqual({ file, hardcoded: false });
    }
  });

  it("開通資料由基底信箱加別名產生,形狀與真實租戶的開通資料相同", () => {
    const plan = demoPlan("owner@example.test");
    expect(parseOnboardingPlan(plan)).toEqual(plan);
    for (const user of plan.users) {
      expect(user.email).toMatch(/^owner\+demo-[a-z0-9-]+@example\.test$/);
      expect(user.account).toBe(user.email);
    }
    expect(DEMO_TENANT.adminAlias).toBe("demo-admin");
  });

  it("示範內容:分店、總部人員 / 店長 / 店員、崗位只有 店內櫃台A、店外櫃台B", () => {
    const plan = demoPlan("owner@example.test");
    expect(plan.branches.length).toBeGreaterThan(0);
    const roles = new Set(plan.users.flatMap((user) => user.roles));
    expect(roles).toEqual(new Set(["clerk", "hq", "store-manager"]));
    expect(plan.users.some((user) => user.headquarters)).toBe(true);
    expect(
      plan.positions.map((position) => [position.label, position.color]),
    ).toEqual([
      ["店內櫃台A", "blue"],
      ["店外櫃台B", "green"],
    ]);
  });
});

describe("示範資料:檔案管理(遊戲、收銀點)", () => {
  it("專案 seed 不內建崗位;兩家店的收銀點都是 店內櫃台A、店外櫃台B 各一,和崗位一對一", () => {
    const plan = demoPlan("owner@example.test");
    expect(
      PROJECT_FIELD_CATEGORIES.find(
        (category) => category.key === SCHEDULE_FIELD_CATEGORY_KEYS.position,
      )?.options,
    ).toEqual([]);
    const labelOf = new Map(
      plan.positions.map((position) => [position.value, position.label]),
    );
    for (const branch of plan.branches) {
      const points = plan.cashPoints.filter(
        (point) => point.branch === branch.name,
      );
      expect({
        branch: branch.name,
        points: points.map((point) => [point.name, point.positionKey]),
      }).toEqual({
        branch: branch.name,
        points: plan.positions.map((position) => [
          position.label,
          position.value,
        ]),
      });
      for (const point of points) {
        expect(labelOf.get(point.positionKey)).toBe(point.name);
      }
    }
  });

  it("遊戲:有示範遊戲,代號不重複", () => {
    expect(DEMO_GAMES.length).toBeGreaterThan(0);
    expect(new Set(DEMO_GAMES.map((game) => game.gameCode)).size).toBe(
      DEMO_GAMES.length,
    );
  });
});

describe("示範專用的步驟(開通腳本不做)", () => {
  const keys = DEMO_STEPS.map((step) => step.key);

  it("開通清單的步驟照原順序都在(「角色」換成多套列印權限的那一份),示範專用的接在後面", () => {
    expect(keys.slice(0, ONBOARDING_STEPS.length)).toEqual(
      ONBOARDING_STEPS.map((step) => step.key),
    );
    expect(DEMO_STEPS).not.toContain(rolesStep);
    expect(keys.slice(ONBOARDING_STEPS.length)).toEqual([
      "demo-games",
      "demo-opening",
      "demo-dealers",
      "demo-bank-accounts",
      "demo-vault-cash",
      "demo-wholesale",
    ]);
    // 開通腳本本身不含示範專用的步驟
    expect(ONBOARDING_STEPS.some((step) => step.key.startsWith("demo-"))).toBe(
      false,
    );
  });

  it("小金庫起始現金排在「流程」之後(現金更正單要走店長核准,不是送出就完成)", () => {
    expect(keys.indexOf("demo-vault-cash")).toBeGreaterThan(
      keys.indexOf("form-workflows"),
    );
  });

  it("批售單排在「流程」與「銀行帳戶」之後(要店長核准出貨、從帳戶入帳)", () => {
    expect(keys.indexOf("demo-wholesale")).toBeGreaterThan(
      keys.indexOf("form-workflows"),
    );
    expect(keys.indexOf("demo-wholesale")).toBeGreaterThan(
      keys.indexOf("demo-bank-accounts"),
    );
  });

  it("引用的分店、乙類、受託人都在示範資料裡", () => {
    const branches = new Set(DEMO_BRANCHES.map((branch) => branch.name));
    for (const account of DEMO_BANK_ACCOUNTS) {
      expect(account.usedBy.every((name) => branches.has(name))).toBe(true);
    }
    for (const vault of DEMO_VAULT_CASH) {
      expect(branches.has(vault.branch)).toBe(true);
    }
    // 期初建檔:分店、收銀點、遊戲都在示範資料裡
    const points = new Set(
      DEMO_CASH_POINTS.map((point) => `${point.branch}/${point.name}`),
    );
    const games = new Set(DEMO_GAMES.map((game) => game.gameCode));
    for (const opening of DEMO_OPENINGS) {
      expect(branches.has(opening.branch)).toBe(true);
      for (const book of opening.books) {
        expect(games.has(book.gameCode)).toBe(true);
        expect(
          book.cashPoint === null ||
            points.has(`${opening.branch}/${book.cashPoint}`),
        ).toBe(true);
      }
    }
    const classB = new Set(
      DEMO_CLASS_B_DEALERS.map((dealer) => dealer.licenseNo),
    );
    const trustees = new Set(DEMO_TRUSTEES.map((trustee) => trustee.name));
    for (const dealer of DEMO_CLASS_A_DEALERS) {
      expect(classB.has(dealer.coSalesLicenseNo)).toBe(true);
      expect(dealer.trustees.every((name) => trustees.has(name))).toBe(true);
      expect(classB.has(dealer.licenseNo)).toBe(false);
    }
  });
});

describe("示範資料:批售客戶與批售單", () => {
  it("批售客戶:證號 8 碼且不重複、電話只有數字、文字不超過上限、共用給的分店都在示範資料裡", () => {
    const branches = new Set(DEMO_BRANCHES.map((branch) => branch.name));
    expect(DEMO_WHOLESALE_CUSTOMERS.length).toBeGreaterThan(0);
    expect(
      new Set(DEMO_WHOLESALE_CUSTOMERS.map((customer) => customer.licenseNo))
        .size,
    ).toBe(DEMO_WHOLESALE_CUSTOMERS.length);
    for (const customer of DEMO_WHOLESALE_CUSTOMERS) {
      expect(customer.licenseNo).toMatch(/^\d{8}$/);
      expect(customer.phone).toMatch(/^\d{1,15}$/);
      expect(customer.storeName.length).toBeLessThanOrEqual(
        WHOLESALE_CUSTOMER_TEXT_LIMITS.storeName,
      );
      expect(customer.contactName.length).toBeLessThanOrEqual(
        WHOLESALE_CUSTOMER_TEXT_LIMITS.contactName,
      );
      expect(customer.address.length).toBeLessThanOrEqual(
        WHOLESALE_CUSTOMER_TEXT_LIMITS.address,
      );
      expect(customer.sharedWith.every((name) => branches.has(name))).toBe(
        true,
      );
    }
  });

  it("批售單:分店、客戶、遊戲都在示範資料裡;入帳帳戶的使用組織含出貨分店(從帳戶入帳,核准時自動記批售收入)", () => {
    const branches = new Set(DEMO_BRANCHES.map((branch) => branch.name));
    const customers = new Set(
      DEMO_WHOLESALE_CUSTOMERS.map((customer) => customer.licenseNo),
    );
    const games = new Map(DEMO_GAMES.map((game) => [game.gameCode, game]));
    expect(DEMO_WHOLESALES.length).toBeGreaterThan(0);
    for (const wholesale of DEMO_WHOLESALES) {
      expect(branches.has(wholesale.branch)).toBe(true);
      expect(customers.has(wholesale.customerLicenseNo)).toBe(true);
      const account = DEMO_BANK_ACCOUNTS.find(
        (item) =>
          item.bankCode === wholesale.account.bankCode &&
          item.accountNo === wholesale.account.accountNo,
      );
      expect(account?.usedBy).toContain(wholesale.branch);
      expect(Number.isInteger(wholesale.rate)).toBe(true);
      expect(wholesale.rate).toBeGreaterThanOrEqual(0);
      expect(wholesale.rate).toBeLessThanOrEqual(100);
      expect(wholesale.books.length).toBeGreaterThan(0);
      expect(
        new Set(
          wholesale.books.map((book) => `${book.gameCode}-${book.bookNo}`),
        ).size,
      ).toBe(wholesale.books.length);
      for (const book of wholesale.books) {
        expect(games.has(book.gameCode)).toBe(true);
        expect(book.bookNo).toMatch(/^\d{7}$/);
      }
    }
  });

  it("示範批售單的批售金額:5164 發大財一本(20,000)× 93% = 18,600", () => {
    const [wholesale] = DEMO_WHOLESALES;
    if (wholesale === undefined) {
      throw new Error("沒有示範批售單");
    }
    const total = wholesale.books.reduce((sum, book) => {
      const game = DEMO_GAMES.find((item) => item.gameCode === book.gameCode);
      const bookPrice = (game?.unitPrice ?? 0) * (game?.ticketsPerBook ?? 0);
      return sum + wholesaleAmountOf(bookPrice, wholesale.rate);
    }, 0);
    expect(total).toBe(18_600);
  });
});

describe("開通腳本與示範指令不直接寫資料庫", () => {
  it("demo 指令、開通腳本、示範資料的程式都不 import mongodb / mongoose(只透過 api 的 GraphQL)", () => {
    for (const directory of SOURCE_DIRS) {
      for (const file of sourceFiles(directory)) {
        const text = readFileSync(file, "utf8");
        expect({
          file,
          importsDriver: /from\s+["'](mongodb|mongoose)["']/.test(text),
        }).toEqual({ file, importsDriver: false });
      }
    }
  });
});
