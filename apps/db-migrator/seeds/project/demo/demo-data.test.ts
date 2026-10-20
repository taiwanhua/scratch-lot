import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { DEMO_TENANT, demoPlan } from ".";
import { PROJECT_FIELD_CATEGORIES } from "../field-categories";
import { parseOnboardingPlan } from "../onboarding/plan";

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

  it("示範內容:分店、總部人員 / 店長 / 店員、自訂崗位 櫃台 A、櫃台 B、彩券機旁", () => {
    const plan = demoPlan("owner@example.test");
    expect(plan.branches.length).toBeGreaterThan(0);
    const roles = new Set(plan.users.flatMap((user) => user.roles));
    expect(roles).toEqual(new Set(["clerk", "hq", "store-manager"]));
    expect(plan.users.some((user) => user.headquarters)).toBe(true);
    expect(
      plan.positions.map((position) => [position.label, position.color]),
    ).toEqual([
      ["櫃台 A", "cyan"],
      ["櫃台 B", "purple"],
      ["彩券機旁", "pink"],
    ]);
  });
});

describe("示範資料:檔案管理(遊戲、收銀點)", () => {
  it("收銀點的崗位都在專案預設崗位或示範自訂崗位裡;彩券機旁對應彩券機旁", () => {
    const plan = demoPlan("owner@example.test");
    const seeded =
      PROJECT_FIELD_CATEGORIES.find(
        (category) => category.key === SCHEDULE_FIELD_CATEGORY_KEYS.position,
      )?.options.map((option) => option.value) ?? [];
    const known = new Set([
      ...seeded,
      ...plan.positions.map((position) => position.value),
    ]);
    for (const point of plan.cashPoints) {
      expect({ point, known: known.has(point.positionKey) }).toEqual({
        point,
        known: true,
      });
    }
    const machine = plan.positions.find(
      (position) => position.label === "彩券機旁",
    );
    expect(
      plan.cashPoints.find((point) => point.name === "彩券機旁")?.positionKey,
    ).toBe(machine?.value);
  });

  it("遊戲:有示範遊戲,代號不重複", () => {
    const plan = demoPlan("owner@example.test");
    expect(plan.games.length).toBeGreaterThan(0);
    expect(new Set(plan.games.map((game) => game.gameCode)).size).toBe(
      plan.games.length,
    );
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
