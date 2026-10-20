import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { loadOnboardingPlan, parseOnboardArgs } from "./command";
import { parseOnboardingPlan } from "./plan";
import { ROLE_GRANT_SECTIONS } from "./role-grants";
import { ONBOARDING_ROLES, roleGrantOf } from "./roles";
import { grantWithin } from "./steps/roles";

const PLAN = {
  branches: [{ name: "一店" }, { name: "二店" }],
  headquartersBranch: "一店",
  users: [
    {
      account: "hq@example.test",
      email: "hq@example.test",
      name: "總部",
      branches: [],
      headquarters: true,
      roles: ["hq"],
    },
    {
      account: "clerk@example.test",
      email: "clerk@example.test",
      name: "店員",
      branches: ["二店"],
      roles: ["clerk"],
    },
  ],
  positions: [{ value: "counter-a", label: "櫃台 A" }],
};

describe("開通資料(真實租戶由開通 skill 寫成 JSON 檔)", () => {
  it("正規化:headquarters 預設 false、沒給的清單是空的", () => {
    const plan = parseOnboardingPlan(PLAN);
    expect(plan.users[1]?.headquarters).toBe(false);
    expect(plan.positions).toEqual([
      { value: "counter-a", label: "櫃台 A", color: null },
    ]);
    expect(
      parseOnboardingPlan({
        ...PLAN,
        positions: [{ value: "counter-a", label: "櫃台 A", color: "cyan" }],
      }).positions[0]?.color,
    ).toBe("cyan");
    expect(parseOnboardingPlan({ branches: [{ name: "一店" }] })).toEqual({
      branches: [{ name: "一店" }],
      headquartersBranch: null,
      users: [],
      positions: [],
      cashPoints: [],
    });
  });

  it.each([
    [
      "使用者的分店不在 branches",
      { ...PLAN, users: [{ ...PLAN.users[1], branches: ["三店"] }] },
      /不在 branches 內/,
    ],
    [
      "總部分店不在 branches",
      { ...PLAN, headquartersBranch: "三店" },
      /headquartersBranch/,
    ],
    [
      "角色不是三個之一",
      { ...PLAN, users: [{ ...PLAN.users[1], roles: ["admin"] }] },
      /必須是 hq \/ store-manager \/ clerk/,
    ],
    [
      "既不屬於分店也不是總部人員",
      { ...PLAN, users: [{ ...PLAN.users[1], branches: [] }] },
      /至少要屬於一家分店/,
    ],
    [
      "帳號重複",
      { ...PLAN, users: [PLAN.users[1], PLAN.users[1]] },
      /有重複的值/,
    ],
    [
      "崗位顏色不是色票代號(例:色碼)",
      {
        ...PLAN,
        positions: [{ value: "counter-a", label: "櫃台 A", color: "#ff0000" }],
      },
      /必須是色票代號/,
    ],
    [
      "崗位代碼不是 kebab-case",
      { ...PLAN, positions: [{ value: "Counter A", label: "櫃台 A" }] },
      /kebab-case/,
    ],
  ])("%s:拒絕(還沒有呼叫 api)", (_case, raw, message) => {
    expect(() => parseOnboardingPlan(raw)).toThrow(message);
  });

  it("開通資料檔裡出現名稱含 password 的欄位:拒絕(開通資料不放密碼)", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "onboard-plan-"));
    const file = path.join(directory, "plan.json");
    writeFileSync(
      file,
      JSON.stringify({
        ...PLAN,
        users: [{ ...PLAN.users[0], initialPassword: "x" }],
      }),
    );
    await expect(loadOnboardingPlan(file)).rejects.toThrow(
      /開通資料不放密碼\(users\[0\]\.initialPassword\)/,
    );

    writeFileSync(file, JSON.stringify(PLAN));
    await expect(loadOnboardingPlan(file)).resolves.toMatchObject({
      headquartersBranch: "一店",
    });
  });

  it("onboard 指令:密碼不從參數讀,多給任何參數(例 --password)直接拒絕", () => {
    const base = [
      "--api-url=https://api.example.test",
      "--tenant=acme",
      "--account=admin@example.test",
      "--plan=plan.json",
    ];
    expect(parseOnboardArgs(base)).toMatchObject({
      apiUrl: "https://api.example.test",
      tenant: "acme",
      account: "admin@example.test",
    });
    expect(() =>
      parseOnboardArgs(base.filter((arg) => !arg.startsWith("--tenant"))),
    ).toThrow(/--tenant 必填/);
    expect(() => parseOnboardArgs([...base, "--password=x"])).toThrow(
      /無法辨識的參數/,
    );
    expect(() => parseOnboardArgs(base.slice(1))).toThrow(/--api-url 必填/);
  });
});

describe("開通時建立的角色:配方每模組一段", () => {
  it("三個角色:總部管理、店長、店員", () => {
    expect(ONBOARDING_ROLES.map((role) => role.name)).toEqual([
      "總部管理",
      "店長",
      "店員",
    ]);
  });

  it("合併各段:去重、保持宣告順序;沒有列的角色 = 那個模組不給", () => {
    const sections = [
      {
        section: "甲",
        grants: {
          hq: { moduleKeys: ["a"], permissionKeys: ["a.*"] },
          clerk: { moduleKeys: ["a"], permissionKeys: ["a.view"] },
        },
      },
      {
        section: "乙",
        grants: { hq: { moduleKeys: ["b", "a"], permissionKeys: ["b.*"] } },
      },
    ];
    expect(roleGrantOf("hq", sections)).toEqual({
      moduleKeys: ["a", "b"],
      permissionKeys: ["a.*", "b.*"],
    });
    expect(roleGrantOf("store-manager", sections)).toEqual({
      moduleKeys: [],
      permissionKeys: [],
    });
  });

  it("目前的配方:三個角色都有總覽與申請中心,沒有系統管理", () => {
    for (const role of ONBOARDING_ROLES) {
      const grant = roleGrantOf(role.key, ROLE_GRANT_SECTIONS);
      expect(grant.moduleKeys).toEqual(
        expect.arrayContaining(["overview", "apply-center"]),
      );
      expect(grant.moduleKeys.some((key) => key.startsWith("system"))).toBe(
        false,
      );
    }
  });

  it("矩陣上沒有的模組(租戶沒開)略過並列出", () => {
    const nodes = [
      { key: "a", permissions: [{ key: "a.view" }], children: [] },
    ];
    expect(
      grantWithin(
        { moduleKeys: ["a", "z"], permissionKeys: ["a.*", "a.view", "z.*"] },
        nodes,
      ),
    ).toEqual({
      grant: { moduleKeys: ["a"], permissionKeys: ["a.*", "a.view"] },
      skipped: ["z", "z.*"],
    });
  });
});
