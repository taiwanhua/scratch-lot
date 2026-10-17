import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { FormVersionStatus } from "@repo/graphql";

import { captureDownloads } from "@/test/download";
import type { FormDesignWorldOptions } from "@/test/msw/form-design-handlers";
import {
  SHOPPING_FORM_KEY,
  formFragment,
  shoppingDefinition,
  versionFragment,
} from "@/test/msw/form-fixtures";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  defaultDesignOptions,
  findDesigner,
  preloadFormsPage,
  renderFormsPage,
} from "./forms-page-test-support";

preloadFormsPage();

const downloads = captureDownloads();

const EXPORT = "匯出專案設定";

type TestUser = ReturnType<typeof renderFormsPage>["user"];

/** 改不動的表單沒有設計器的元件面板,所以等的是頁籤本身。 */
const openVersions = async (user: TestUser): Promise<HTMLElement> => {
  await user.click(await screen.findByRole("tab", { name: "表單版本" }));
  const table = await screen.findByRole("table", { name: "版本清單" });
  await within(table).findByText("v1");
  return table;
};

const rowOf = (table: HTMLElement, version: string): HTMLElement =>
  within(table).getByRole("row", { name: new RegExp(version) });

const openExport = async (user: TestUser): Promise<HTMLElement> => {
  const table = await openVersions(user);
  await user.click(
    within(rowOf(table, "v1")).getByRole("button", { name: EXPORT }),
  );
  return screen.findByRole("dialog", { name: EXPORT });
};

const fill = async (
  user: TestUser,
  dialog: HTMLElement,
  revision: string,
  changelog: string,
): Promise<void> => {
  await user.type(
    within(dialog).getByRole("textbox", { name: "版本識別" }),
    revision,
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "發布說明" }),
    changelog,
  );
};

/** 三個版本:草稿、已發布的 v2(目前版本)、已退役的 v1。 */
const threeVersions = (): FormDesignWorldOptions => ({
  forms: [formFragment({ currentVersion: 2 })],
  versions: {
    [SHOPPING_FORM_KEY]: [
      versionFragment(shoppingDefinition(), { baseVersion: 2 }),
      versionFragment(shoppingDefinition(), {
        id: `ver-${SHOPPING_FORM_KEY}-2`,
        version: 2,
        status: FormVersionStatus.Published,
        changelog: "第二版",
      }),
      versionFragment(shoppingDefinition(), {
        id: `ver-${SHOPPING_FORM_KEY}-1`,
        version: 1,
        status: FormVersionStatus.Retired,
        changelog: "第一版",
      }),
    ],
  },
});

describe("表單管理:版本面板的「匯出專案設定」", () => {
  it("選已發布的版本、填版本識別與發布說明 → 下載 api 給的 .seed.ts(檔名與內容原樣),版本清單不變", async () => {
    const { user, world } = renderFormsPage();
    const dialog = await openExport(user);

    expect(
      within(dialog).getByText(
        "把表單「購物單」的第 1 版下載成一個設定檔,交給開發人員放進專案,其他環境就會拿到同一份設計。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "只匯出這一版的設計內容,不會更動任何資料;人員、組織、分派與綁定不會被帶走。",
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "下載設定檔" });
    expect(confirm).toBeDisabled();

    await fill(user, dialog, "2026-10-r1", "  第一次交付\n含採購欄位  ");
    await user.click(confirm);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: EXPORT })).toBeNull();
    });
    expect(world.inputs.exportFormSeed).toEqual([
      {
        formKey: SHOPPING_FORM_KEY,
        version: 1,
        revision: "2026-10-r1",
        changelog: "第一次交付\n含採購欄位",
      },
    ]);
    expect(downloads.map(({ fileName }) => fileName)).toEqual([
      "shopping_list.2026-10-r1.seed.ts",
    ]);
    const source = await downloads.at(0)?.text();
    expect(source).toContain(
      'import type { SeedSet } from "@repo/domain/seed";',
    );
    expect(source).toContain('kind: "form-definition"');
    expect(source).toContain('key: "shopping_list"');
    expect(source).toContain('revision: "2026-10-r1"');
    expect(source).toContain(String.raw`changelog: "第一次交付\n含採購欄位"`);
    expect(source).toContain('desiredStatus: "published"');
    expect(source).toContain('label: "品項"');
    expect(source).toMatch(/\} satisfies SeedSet;\n$/);
    expect(await findSnackbarAlert()).toEqual({
      text: "已下載 shopping_list.2026-10-r1.seed.ts",
      severity: "success",
    });
    // 既有的版本操作都還在
    const table = screen.getByRole("table", { name: "版本清單" });
    expect(
      within(table).getByRole("button", { name: "發布" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "退役目前版本" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "檢視 v1" }),
    ).toBeInTheDocument();
  });

  it("版本識別格式不符:就地提示、不能送出,改對了才能下載", async () => {
    const { user, world } = renderFormsPage();
    const dialog = await openExport(user);
    const confirm = within(dialog).getByRole("button", { name: "下載設定檔" });

    await fill(user, dialog, "R1 final", "說明");

    expect(
      within(dialog).getByText(
        "格式不符:小寫英文或數字開頭,只能用小寫英文、數字、底線、連字號,最長 64 個字。",
      ),
    ).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    const revision = within(dialog).getByRole("textbox", { name: "版本識別" });
    await user.clear(revision);
    await user.type(revision, "r1_final");
    expect(confirm).toBeEnabled();
    expect(world.inputs.exportFormSeed).toEqual([]);
    expect(downloads).toEqual([]);
  });

  it("這一版夾帶只在本環境有意義的設定:整份不下載,逐項列出位置與修正說明,彈窗留著", async () => {
    const { user } = renderFormsPage({
      ...defaultDesignOptions(),
      failures: {
        ExportFormSeed: {
          code: "VALIDATION_FAILED",
          extensions: {
            fields: ["definition"],
            issues: [
              {
                code: "FIXED_ENVIRONMENT_VALUE",
                message:
                  "引用欄位「採購人」不能帶固定值:它指向來源環境的資料,換環境後對不到",
                path: "definition.fields.5.default.value",
              },
              {
                code: "DEPENDENCY_UNRESOLVED",
                message:
                  "欄位類別 local-category 不是這次交付受管的類別;請在普通種子登記它",
                path: "definition.fields.2.options.key",
              },
            ],
          },
        },
      },
    });
    const dialog = await openExport(user);
    await fill(user, dialog, "r1", "說明");

    await user.click(
      within(dialog).getByRole("button", { name: "下載設定檔" }),
    );

    expect(
      await within(dialog).findByText("這一版還不能匯出。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "definition.fields.5.default.value:引用欄位「採購人」不能帶固定值:它指向來源環境的資料,換環境後對不到",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "definition.fields.2.options.key:欄位類別 local-category 不是這次交付受管的類別;請在普通種子登記它",
      ),
    ).toBeInTheDocument();
    expect(downloads).toEqual([]);
    expect(await findSnackbarAlert()).toEqual({
      text: "這一版還不能匯出。",
      severity: "error",
    });
    // 修正後可以直接再試一次
    expect(
      within(dialog).getByRole("button", { name: "下載設定檔" }),
    ).toBeEnabled();
  });

  it("api 拒絕(不是站在根組織):顯示原因、不下載", async () => {
    const { user } = renderFormsPage({
      ...defaultDesignOptions(),
      failures: {
        ExportFormSeed: {
          code: "FORBIDDEN",
          extensions: { reason: "ROOT_ONLY" },
        },
      },
    });
    const dialog = await openExport(user);
    await fill(user, dialog, "r1", "說明");

    await user.click(
      within(dialog).getByRole("button", { name: "下載設定檔" }),
    );

    expect(
      await within(dialog).findByText("只有系統管理員能匯出專案設定。"),
    ).toBeInTheDocument();
    expect(downloads).toEqual([]);
  });

  it("只有目前發布的版本能匯出:草稿與已退役的版本沒有這顆按鈕", async () => {
    const { user } = renderFormsPage(threeVersions());
    await findDesigner();
    await user.click(screen.getByRole("tab", { name: "表單版本" }));
    const table = await screen.findByRole("table", { name: "版本清單" });
    await within(table).findByText("v2");

    expect(within(table).getAllByRole("button", { name: EXPORT })).toHaveLength(
      1,
    );
    expect(
      within(rowOf(table, "v2")).getByRole("button", { name: EXPORT }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(table, "v1")).queryByRole("button", { name: EXPORT }),
    ).toBeNull();
    expect(
      within(rowOf(table, "草稿")).queryByRole("button", { name: EXPORT }),
    ).toBeNull();
  });

  it.each([
    [
      "租戶看分派來的共用表單(改不動)",
      formFragment({
        tenantEnabled: true,
        abilities: {
          canEdit: false,
          canAssign: false,
          canSetEnabled: true,
          canFork: true,
        },
      }),
    ],
    [
      "租戶自己的客製表單(改得動,但不是共用)",
      formFragment({
        isShared: false,
        ownerOrgId: "org-1",
        ownerOrgName: "CookHome",
        tenantEnabled: true,
      }),
    ],
  ])("不可用:%s 沒有匯出按鈕", async (_title, form) => {
    const { user } = renderFormsPage({
      ...defaultDesignOptions(),
      forms: [form],
    });

    const table = await openVersions(user);

    expect(within(table).queryByRole("button", { name: EXPORT })).toBeNull();
    // 其他不受影響:檢視仍在
    expect(
      within(table).getByRole("button", { name: "檢視 v1" }),
    ).toBeInTheDocument();
  });
});
