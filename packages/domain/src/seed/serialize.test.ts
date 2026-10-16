/* eslint-disable sonarjs/code-eval -- 測試要實際執行 serializeSeedSet 匯出的原始碼(放進隔離的 vm context,輸入全是本檔自己組的夾具),才能驗「惡意字串不會被執行、來回後一字不差」;到期條件:匯出格式不再是可執行的 TypeScript 時移除 */
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "@jest/globals";
import {
  type CompilerOptions,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  createCompilerHost,
  createProgram,
  createSourceFile,
  flattenDiagnosticMessageText,
  getPreEmitDiagnostics,
  transpileModule,
} from "typescript";

import { field } from "../form/form-test-support";
import { review } from "../workflow/workflow-test-support";
import { SeedSerializationError } from "./canonical";
import { type SeedSet, seedRef } from "./declaration";
import { formSeed, userReference, workflowSeed } from "./seed-test-support";
import { serializeSeedSet } from "./serialize";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

/** 匯出檔在型別檢查時的(虛擬)位置:放在套件裡,`@repo/domain/seed` 才解得到真正的契約。 */
const EXPORTED_FILE = path.join(
  PACKAGE_ROOT,
  "src",
  "seed",
  "exported.seed.ts",
);

const normalize = (fileName: string): string =>
  path.resolve(fileName).toLowerCase();

/**
 * 用真的 TypeScript 編譯器檢查匯出的原始碼:`@repo/domain/seed` 指向本套件的出口檔,
 * 所以 `satisfies SeedSet` 驗的就是正式契約。回傳診斷訊息(空陣列 = 型別檢查通過)。
 */
function typeCheck(source: string): string[] {
  const options: CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ScriptTarget.ES2022,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    lib: ["lib.es2024.d.ts"],
    types: [],
    paths: { "@repo/domain/seed": [path.join(PACKAGE_ROOT, "src", "seed.ts")] },
  };
  const host = createCompilerHost(options);
  const isExported = (fileName: string): boolean =>
    normalize(fileName) === normalize(EXPORTED_FILE);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => isExported(fileName) || fileExists(fileName);
  host.readFile = (fileName) =>
    isExported(fileName) ? source : readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    isExported(fileName)
      ? createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const program = createProgram([EXPORTED_FILE], options, host);
  return getPreEmitDiagnostics(
    program,
    program.getSourceFile(EXPORTED_FILE),
  ).map((diagnostic) =>
    flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  );
}

/** 轉成 JSON 文字再讀回來:換成本 context 的純物件(也丟掉 undefined 的鍵),供深比對。 */
function jsonRoundTrip(value: unknown): unknown {
  const text = JSON.stringify(value);
  return JSON.parse(text) as unknown;
}

/** 把匯出的原始碼當模組執行,取回具名匯出 `seed`(型別匯入在轉譯時消失)。 */
function evaluate(source: string): unknown {
  const { outputText } = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  });
  const exports: { seed?: unknown } = {};
  vm.runInNewContext(outputText, { exports });
  return jsonRoundTrip(exports.seed);
}

function documentsWith(value: unknown): SeedSet {
  return {
    kind: "documents",
    collection: "demo_items_one",
    entries: [{ key: "demo-item-one.sample", data: { createdBy: value } }],
  };
}

/** 名稱、說明、公式、changelog 裡可能出現、放進原始碼有風險的字串。 */
const HOSTILE_STRINGS = [
  "${process.exit(1)}",
  "`; throw new Error('injected'); `",
  String.raw`"quoted" 'single' \backslash\\`,
  "line1\nline2\r\ttab",
  "*/ export const seed = null; /*",
  "</script><script>alert(1)</script>",
  `行分隔${String.fromCodePoint(0x20_28)}段分隔${String.fromCodePoint(0x20_29)}結尾`,
  `雙向控制${String.fromCodePoint(0x20_2e)}txt.exe${String.fromCodePoint(0x20_66)}`,
  `${String.fromCodePoint(0xfe_ff)}BOM 開頭`,
  "\u0000 與 \u001F 控制字元",
  "表情 😀 與孤立代理 \uD83D",
];

describe("serializeSeedSet", () => {
  it("輸出固定的外框:型別匯入、不重排的標記、具名 seed、satisfies SeedSet", () => {
    const source = serializeSeedSet(workflowSeed(undefined, { key: "leave" }));
    const lines = source.split("\n");
    expect(lines.slice(0, 2)).toEqual([
      'import type { SeedSet } from "@repo/domain/seed";',
      "",
    ]);
    // 快照放進 repo 後不被 `pnpm format` 重排:匯出的位元組就是進版控的位元組
    expect(lines.slice(3, 8)).toEqual([
      "// prettier-ignore",
      "export const seed = {",
      '  kind: "workflow-definition",',
      '  key: "leave",',
      '  revision: "r1",',
    ]);
    expect(source.endsWith("} satisfies SeedSet;\n")).toBe(true);
    expect(source).not.toContain("`");
  });

  it("key 有底線時檔名 <key>.<revision>.seed.ts 不合 kebab-case:第一行附檔名規則的豁免(含原因與到期條件);沒有底線就不加", () => {
    const [firstLine] = serializeSeedSet(workflowSeed()).split("\n");
    expect(firstLine).toMatch(
      /^\/\* eslint-disable unicorn\/filename-case -- .+到期條件.+ \*\/$/,
    );
    expect(
      serializeSeedSet(workflowSeed(undefined, { key: "leave" })),
    ).not.toContain("eslint-disable");
    // 普通種子的快照檔名由登記的人決定,不預設豁免
    expect(
      serializeSeedSet({
        kind: "root-admin",
        orgKey: "root",
        roleKey: "super_admin",
      }),
    ).not.toContain("eslint-disable");
  });

  it("表單與流程宣告:型別檢查通過,執行後與原宣告內容相同(可直接登記)", () => {
    const seeds: SeedSet[] = [
      formSeed(
        [
          field("title", "text", {
            rules: {
              required: true,
              pattern: String.raw`^\d{3}-[A-Z]+$`,
              patternMessage: "格式:123-ABC",
            },
          }),
          userReference("applicant", {
            default: { kind: "expression", expr: { var: "ctx.user.id" } },
          }),
          field("amount", "number", {
            visibleWhen: {
              and: [
                { "!!": [{ var: "applicant" }] },
                { ">": [{ var: "amount" }, 0] },
              ],
            },
          }),
          field("items", "array", {
            columns: [
              {
                key: "qty",
                label: "數量",
                type: "number",
                precision: 0,
                widget: { kind: "number" },
                valueSource: { kind: "input" },
              },
            ],
          }),
        ],
        { tabLabelTemplate: "{{title}} - {{applicant}}", allowDraft: false },
      ),
      workflowSeed(
        {
          steps: [
            review("boss", { skipWhen: { "<": [{ var: "amount" }, 1000] } }),
            review("hr", {
              assignee: { kind: "role", roleId: null, placeholder: "人資" },
              mode: "all",
            }),
          ],
          edges: [{ from: "boss", to: "hr" }],
        },
        { checkFormKey: "leave_request", desiredStatus: "retired" },
      ),
    ];
    for (const seed of seeds) {
      const source = serializeSeedSet(seed);
      expect(typeCheck(source)).toEqual([]);
      expect(evaluate(source)).toEqual(seed);
    }
  }, 120_000);

  it("普通種子(documents / relations / root-admin)同一種輸出,seedRef 原樣保留", () => {
    const seeds: SeedSet[] = [
      {
        kind: "documents",
        collection: "fields",
        adoptBy: {
          fields: ["categoryId", "value"],
          where: { isSystem: false, orgId: seedRef("orgs", "root") },
        },
        entries: [
          {
            key: "gender.male",
            data: {
              categoryId: seedRef("field_categories", "gender"),
              orgId: null,
              value: "male",
              order: 1,
              enabled: true,
            },
          },
        ],
      },
      {
        kind: "relations",
        entries: [
          {
            type: "org_role",
            first: { collection: "orgs", key: "root" },
            second: { collection: "roles", key: "super-admin" },
          },
        ],
      },
      { kind: "root-admin", orgKey: "root", roleKey: "super-admin" },
    ];
    for (const seed of seeds) {
      const source = serializeSeedSet(seed);
      expect(typeCheck(source)).toEqual([]);
      expect(evaluate(source)).toEqual(seed);
    }
  }, 120_000);

  it("型別檢查是真的:改壞匯出檔(目標狀態不存在、少了必填欄位)會被擋下", () => {
    const source = serializeSeedSet(workflowSeed());
    expect(
      typeCheck(source.replace('"published"', '"draft"')).length,
    ).toBeGreaterThan(0);
    expect(
      typeCheck(source.replace("  checkFormKey: null,\n", "")).length,
    ).toBeGreaterThan(0);
  }, 120_000);

  it("惡意或特殊字串只會是字串內容:不被執行、不提前結束字面值,來回後一字不差", () => {
    for (const hostile of HOSTILE_STRINGS) {
      const seed = formSeed(
        [
          field("title", "text", {
            label: hostile,
            help: hostile,
            default: {
              kind: "expression",
              expr: { concat: [hostile, { var: "title" }] },
            },
          }),
        ],
        { name: hostile, changelog: hostile, tabLabelTemplate: hostile },
      );
      const source = serializeSeedSet(seed);
      expect(evaluate(source)).toEqual(jsonRoundTrip(seed));
      // 行分隔、BOM、雙向控制字元不會以原字元出現在原始碼裡
      for (const codePoint of [0x20_28, 0x20_29, 0x20_2e, 0x20_66, 0xfe_ff]) {
        expect(source).not.toContain(String.fromCodePoint(codePoint));
      }
    }
    const everything = formSeed([field("title", "text")], {
      name: HOSTILE_STRINGS.join(" | "),
    });
    expect(typeCheck(serializeSeedSet(everything))).toEqual([]);
  }, 120_000);

  it("物件鍵不是識別字就加引號;__proto__ 是自有屬性,不會變成設定原型", () => {
    const data = JSON.parse(
      '{"__proto__": {"polluted": true}, "has-dash": 1, "1st": 2, "a b": 3, "${x}": 4, "ok_key": 5}',
    ) as Record<string, unknown>;
    const seed: SeedSet = {
      kind: "documents",
      collection: "seed_fixture_items",
      entries: [{ key: "odd-keys", data }],
    };
    const source = serializeSeedSet(seed);
    expect(source).toContain('["__proto__"]: {');
    expect(source).toContain('"has-dash": 1');
    expect(source).toContain("ok_key: 5");
    expect(typeCheck(source)).toEqual([]);
    const evaluated = evaluate(source) as {
      entries: { data: Record<string, unknown> }[];
    };
    const [entry] = evaluated.entries;
    expect(Object.hasOwn(entry?.data ?? {}, "__proto__")).toBe(true);
    expect((entry?.data as { polluted?: unknown }).polluted).toBeUndefined();
    expect(evaluated).toEqual(jsonRoundTrip(seed));
  }, 120_000);

  it("不是純 JSON 的值(Date、類別實例、非有限數字、陣列裡的 undefined)拒絕並指出位置", () => {
    class FakeObjectId {
      readonly hex = "00000000000000000000d001";
    }
    for (const value of [
      new Date(0),
      new FakeObjectId(),
      Number.POSITIVE_INFINITY,
      [undefined],
      () => 1,
    ]) {
      expect(() => serializeSeedSet(documentsWith(value))).toThrow(
        SeedSerializationError,
      );
      expect(() => serializeSeedSet(documentsWith(value))).toThrow(
        "entries.0.data.createdBy",
      );
    }
  });

  it("同一份宣告每次輸出相同;定義宣告的頂層鍵照固定順序", () => {
    const seed = workflowSeed();
    const shuffled = Object.fromEntries(
      Object.entries(seed).toReversed(),
    ) as unknown as SeedSet;
    expect(serializeSeedSet(shuffled)).toBe(serializeSeedSet(seed));
  });
});
