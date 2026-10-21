/**
 * 種子來源的契約(底座與專案各一份;正本:ADR-0002)。
 *
 * 兩方 registry 都回傳 `SeedSource`:模組宣告交給固定組裝入口(`seeds/registry.ts`)合併後**只推導一次**
 * modules / permissions / dataScopeTargets / 租戶管理員模板,其餘普通種子照宣告交付。
 * `base/` 不 import `project/`;專案的初值由組裝入口讀進來、驗過再傳給底座工廠。
 */
import type { PortableLookupProvider } from "@repo/domain/seed";

import { SeedCompositionError } from "../../src/seed/seed-composition";
import type { SeedRegistry } from "../../src/seed/seed-declaration";
import type {
  ModuleInitialValues,
  ModuleSeedDeclaration,
} from "./module-declaration";

export interface SeedSource {
  /** 這個來源的模組宣告(每模組一檔);父節點可以在另一個來源。 */
  moduleDeclarations: readonly ModuleSeedDeclaration[];
  /**
   * 其餘普通種子與版本化定義。不得再用 documents / relations 宣告由模組宣告推導的內容
   * (modules、permissions、data_scope_targets、租戶管理員模板的綁定)。
   */
  seeds: SeedRegistry;
  /**
   * 這個來源登記、可以跟著共用定義交付的 lookup 來源(選填):來源 key → 可用的固定條件與值
   * (`@repo/domain/seed` 的 `PortableLookupProvider`)。宣告了,受管表單才能引用它;沒宣告的照舊不可攜。
   * 來源本身由 api 的 lookup 登記提供(專案:`apps/api/src/project/lookup-providers.ts`),key 要一致。
   */
  portableLookupProviders?: Readonly<Record<string, PortableLookupProvider>>;
}

/** 根組織的專案初值:結構、key 與初始值欄位政策由底座定義,專案只給這三個值。 */
export interface RootOrgSettings {
  /** 顯示名稱(品牌文字,登記在 docs/branding.md)。 */
  name: string;
  /** 說明;`null` = 不給說明。 */
  description: string | null;
  /** `orgs.settings` 的初始值(如 `timezone`)。 */
  settings: Record<string, unknown>;
}

/** `seeds/project/settings.ts` 的形狀。 */
export interface ProjectSeedSettings {
  rootOrg: RootOrgSettings;
  /** 既有模組的專案初值(只收 `enabled`、`icon`、`settings`);沒有就給 `{}`。 */
  moduleInitialValues: ModuleInitialValues;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(record).filter((key) => !allowed.includes(key));
}

function rootOrgProblems(rootOrg: unknown): string[] {
  if (!isPlainRecord(rootOrg)) {
    return ["rootOrg 必須是 { name, description, settings }"];
  }
  const problems = unknownKeys(rootOrg, [
    "name",
    "description",
    "settings",
  ]).map(
    (key) =>
      `rootOrg.${key} 不是可指定的初值(根組織的結構與 key 由底座定義,專案只給 name、description、settings)`,
  );
  if (typeof rootOrg.name !== "string" || rootOrg.name.trim() === "") {
    problems.push("rootOrg.name 必須是非空字串");
  }
  if (rootOrg.description !== null && typeof rootOrg.description !== "string") {
    problems.push("rootOrg.description 必須是字串或 null");
  }
  if (!isPlainRecord(rootOrg.settings)) {
    problems.push("rootOrg.settings 必須是物件(沒有就給 {})");
  }
  return problems;
}

/**
 * 驗專案初值的外框(在任何寫入之前);模組初值逐鍵的檢查要對照整棵模組樹,在 `composeModuleSeeds`。
 * 不合就丟錯並列出每一項。
 */
export function assertProjectSeedSettings(
  settings: ProjectSeedSettings,
): ProjectSeedSettings {
  // 型別只保證編譯期;專案檔可能繞過型別(as、JS 來源),所以執行期照 unknown 再驗一次
  const candidate: unknown = settings;
  const problems: string[] = [];
  if (isPlainRecord(candidate)) {
    problems.push(
      ...unknownKeys(candidate, ["rootOrg", "moduleInitialValues"]).map(
        (key) => `${key} 不是已知的專案初值`,
      ),
      ...rootOrgProblems(candidate.rootOrg),
    );
    if (!isPlainRecord(candidate.moduleInitialValues)) {
      problems.push("moduleInitialValues 必須是物件(沒有就給 {})");
    }
  } else {
    problems.push("專案初值必須是物件");
  }
  if (problems.length > 0) {
    throw new SeedCompositionError(
      problems.map((problem) => `專案種子初值:${problem}`),
    );
  }
  return settings;
}
