import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import type { FormDefinition } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  FORM_TEST_TIMEOUT_MS,
  call,
  column,
  definitionOf,
  extensionsOf,
  field,
  publishNewForm,
  rootToken,
} from "../../../forms/test-support/form-fixtures";
import { EXPORT_FORM_SEED } from "../../../forms/test-support/seed-export-support";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface ExportData {
  exportFormSeed: { fileName: string; source: string };
}

/** 明細引用遊戲(同叫貨單);`filter` 是遊戲欄的固定條件。 */
const gameLinesDefinition = (filter: Record<string, unknown>): FormDefinition =>
  definitionOf([
    field("title", "text"),
    field("lines", "array", {
      columns: [
        column("game", "reference", {
          source: { provider: "lottery_game", labelField: "name", filter },
        }),
        column("books", "number"),
      ],
    }),
  ]);

/**
 * 匯出 seed 的可攜性目錄讀專案 lookup 登記的 `portable`(與種子組裝同一份 domain 常數):
 * 引用遊戲且只帶「只列販售中」的共用表單匯得出來;宣告以外的固定條件照樣不可攜。
 */
describe("匯出 seed:專案可攜的 lookup 來源 lottery_game", () => {
  let api: AuthTestApp;
  let root: string;

  const exportSeed = (formKey: string) =>
    call<ExportData>(api, root, EXPORT_FORM_SEED, {
      input: { formKey, version: 1, revision: "r1", changelog: "初版" },
    });

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-requisition-seed-export");
    root = await rootToken(api);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("明細引用遊戲、固定條件 status = on_sale → 匯得出來(不是 LOOKUP_PROVIDER_UNSUPPORTED)", async () => {
    await publishNewForm(
      api,
      root,
      "exp_game_lines",
      gameLinesDefinition({ status: "on_sale" }),
    );
    const result = await exportSeed("exp_game_lines");
    expect(result.errors).toBeUndefined();
    expect(result.data?.exportFormSeed.source).toContain("lottery_game");
  });

  it("宣告以外的固定條件值(status = discontinued)→ LOOKUP_FILTER_UNSUPPORTED", async () => {
    await publishNewForm(
      api,
      root,
      "exp_game_stopped",
      gameLinesDefinition({ status: "discontinued" }),
    );
    const result = await exportSeed("exp_game_stopped");
    const extensions = extensionsOf(result) as {
      code: string;
      issues: { code: string; path: string }[];
    };
    expect(extensions.code).toBe("VALIDATION_FAILED");
    expect(
      extensions.issues.map(({ code, path }) => `${path} ${code}`),
    ).toEqual([
      "definition.fields.1.columns.0.source.filter.status LOOKUP_FILTER_UNSUPPORTED",
    ]);
  });
});
