/** @jest-environment node */
import { spawnSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "@jest/globals";

/**
 * 驗證 `@repo/eslint-config/react` 的 Typography color 規則(STYLE-12)。
 * 對真 ESLint(本套件的 eslint.config.mjs)跑:程式碼以文字餵入、檔名借用實際存在的元件檔;
 * 全部案例在一個子行程裡跑完。只看 STYLE-12 那條訊息,其他規則的報錯不計。
 */
const LINT_TIMEOUT_MS = 180_000;
const FILE = "src/Typography/Typography.tsx";

/** 子行程:讀 stdin 的案例清單,逐一 `lintText`,回傳每案是否命中 STYLE-12。 */
const LINT_RUNNER = `
import { ESLint } from "eslint";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}
const eslint = new ESLint({ cwd: process.cwd() });
const results = [];
for (const { filename, code } of JSON.parse(input)) {
  const [report] = await eslint.lintText(code, { filePath: filename });
  results.push(
    report.messages.filter(
      (message) =>
        message.ruleId === "no-restricted-syntax" &&
        message.message.includes("STYLE-12"),
    ).length,
  );
}
process.stdout.write(JSON.stringify(results));
`;

const wrap = (jsx: string) => `
import MuiTypography from "@mui/material/Typography";

const t = (key: string) => key;
const flag = Math.random() > 0.5;
const key = String(flag);
const maybe: "error" | undefined = undefined;

export const Probe = () => (
  <>
    ${jsx}
  </>
);

export const Unused = MuiTypography;
`;

/** 會擋:color 的值位置出現帶點字串 */
const BLOCKED = {
  plain: `<Typography color="text.secondary">a</Typography>`,
  muiTag: `<MuiTypography color="warning.main">a</MuiTypography>`,
  braced: `<Typography color={"text.secondary"}>a</Typography>`,
  ternary: `<Typography color={flag ? "error.main" : "textSecondary"}>a</Typography>`,
  nestedTernary: `<Typography color={flag ? "error" : key === "x" ? "text.disabled" : "textSecondary"}>a</Typography>`,
  nullish: `<Typography color={maybe ?? "text.secondary"}>a</Typography>`,
} as const;

/** 不誤判:正式值、sx 裡的路徑、條件裡的 i18n key / 比較字串、其他元件 */
const ALLOWED = {
  formal: `<Typography color="textSecondary">a</Typography>`,
  formalTernary: `<Typography color={flag ? "warning" : "textPrimary"}>a</Typography>`,
  sxShade: `<Typography sx={{ color: "warning.dark" }}>a</Typography>`,
  i18nInTest: `<Typography color={t("confirm.difference") === "x" ? "error" : "textPrimary"}>a</Typography>`,
  compareInTest: `<Typography color={key === "a.b" ? "error" : "textSecondary"}>a</Typography>`,
  otherTag: `<span color="text.secondary">a</span>`,
} as const;

type CaseName = keyof typeof BLOCKED | keyof typeof ALLOWED;
const CASES: Record<CaseName, string> = { ...BLOCKED, ...ALLOWED };

const lintAllCases = (): Record<CaseName, number> => {
  const names = Object.keys(CASES) as CaseName[];
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", LINT_RUNNER],
    {
      cwd: process.cwd(),
      input: JSON.stringify(
        names.map((name) => ({
          filename: FILE,
          code: `import { Typography } from "./Typography";\n${wrap(CASES[name])}`,
        })),
      ),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`ESLint 子行程失敗:${result.stderr}`);
  }
  const counts = JSON.parse(result.stdout) as number[];
  return Object.fromEntries(
    names.map((name, index) => [name, counts[index]]),
  ) as Record<CaseName, number>;
};

describe("Typography color 的 lint 規則(STYLE-12)", () => {
  let reported: Record<CaseName, number>;

  beforeAll(() => {
    reported = lintAllCases();
  }, LINT_TIMEOUT_MS);

  it.each(Object.keys(BLOCKED) as (keyof typeof BLOCKED)[])(
    "擋下:%s",
    (name) => {
      expect(reported[name]).toBe(1);
    },
  );

  it.each(Object.keys(ALLOWED) as (keyof typeof ALLOWED)[])(
    "不誤判:%s",
    (name) => {
      expect(reported[name]).toBe(0);
    },
  );
});
