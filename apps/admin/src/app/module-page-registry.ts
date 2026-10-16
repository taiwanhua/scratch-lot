import type { ComponentType } from "react";

import {
  formModulePageKeys,
  formModulePages,
} from "@/components/base/form-engine/FormModulePages/form-module-pages";
import {
  type FormModuleOptions,
  type FormModuleOptionsRegistry,
  composeFormModuleOptions,
} from "@/lib/base/form-engine/form-module-options";
import type { ModulePageProps } from "@/lib/base/module-tree";

import type { ShellMinWidth } from "./AdminShell/shell-geometry";
import type { ModulePageRegistry } from "./guards/ModuleRoute/ModuleRoute";

/**
 * 模組頁面登記的型別與純合成。來源分兩份 —— 底座(`app/base/module-pages.ts`)與專案
 * (`app/project/module-pages.ts`、`app/project/page-replacements.ts`)—— 由固定入口 `app/module-pages.tsx` 合成。
 *
 * 登記只決定「進去看到什麼」:網址、模組名、權限與引擎一律取 `me.modules`,能不能進仍由 `ModuleRoute` 守門。
 * 專案要換掉底座頁用「替換」明寫,不靠撞 key 蓋過去;底座的原檔與登記都留著,拿掉替換就回到原版。
 */
export type PageComponent = ComponentType<ModulePageProps>;

/** 表單模組的四頁。 */
export type FormPageSlot = "list" | "viewPage" | "createPage" | "editPage";

export interface PagePresentation {
  readonly Page: PageComponent;
  /** 內容區最小寬度的斷點;沒給 = 殼層預設(`AdminShell/shell-geometry.ts`) */
  readonly minWidth?: ShellMinWidth;
}

/** 一個固定頁:模組 key → 頁面。 */
export interface ModulePageEntry extends PagePresentation {
  readonly key: string;
}

/** 一個表單模組:展開成四頁(表單引擎的預設組裝),同時帶它的模組層設定。 */
export interface FormPageEntry {
  readonly moduleKey: string;
  readonly options?: FormModuleOptions;
  /** 單頁客製:只換指定的那幾頁,其餘沿用預設 */
  readonly pageOverrides?: Readonly<
    Partial<Record<FormPageSlot, PagePresentation>>
  >;
}

export interface ModulePageSource {
  readonly pages: readonly ModulePageEntry[];
  readonly forms: readonly FormPageEntry[];
}

/** 以專案頁替換一個已存在的底座頁;`minWidth` 省略 = 沿用底座那一頁的寬度。 */
export interface ModulePageReplacement extends PagePresentation {
  readonly target: string;
}

export interface ComposeModulePagesInput {
  readonly base: ModulePageSource;
  readonly project: ModulePageSource;
  readonly replacements: readonly ModulePageReplacement[];
}

export interface ComposedModulePages {
  readonly pages: ModulePageRegistry;
  readonly pageMinWidths: Readonly<Record<string, ShellMinWidth>>;
  readonly formModuleOptions: FormModuleOptionsRegistry;
}

type SourceName = "base" | "project";

/** 展開後的一頁,帶著它在輸入裡的位置(錯誤訊息用)。 */
interface ExpandedPage extends PagePresentation {
  readonly key: string;
  readonly source: SourceName;
  readonly origin: string;
}

const FORM_PAGE_SLOTS: readonly FormPageSlot[] = [
  "list",
  "viewPage",
  "createPage",
  "editPage",
];

const isBlank = (key: string): boolean => key.trim() === "";

/** 來源 → 展開後的頁(保留輸入順序;表單模組先展開成四頁,再一起驗 key)。 */
const expandSource = (
  source: SourceName,
  { pages, forms }: ModulePageSource,
  problems: string[],
): ExpandedPage[] => {
  const expanded: ExpandedPage[] = [];
  for (const [index, { key, Page, minWidth }] of pages.entries()) {
    const origin = `${source}.pages[${String(index)}]`;
    if (isBlank(key)) {
      problems.push(`模組 key 是空的:${origin}`);
      continue;
    }
    expanded.push({
      key,
      Page,
      ...(minWidth !== undefined && { minWidth }),
      source,
      origin,
    });
  }
  for (const [index, { moduleKey, pageOverrides }] of forms.entries()) {
    const entryOrigin = `${source}.forms[${String(index)}]`;
    if (isBlank(moduleKey)) {
      problems.push(`表單模組 key 是空的:${entryOrigin}`);
      continue;
    }
    const keys = formModulePageKeys(moduleKey);
    const defaults = formModulePages(moduleKey);
    for (const slot of FORM_PAGE_SLOTS) {
      const override = pageOverrides?.[slot];
      const minWidth = override?.minWidth;
      expanded.push({
        key: keys[slot],
        Page: override?.Page ?? defaults[keys[slot]],
        ...(minWidth !== undefined && { minWidth }),
        source,
        origin: `${entryOrigin}(${moduleKey}).${slot}`,
      });
    }
  }
  return expanded;
};

/** 同一個 key 出現兩次以上就是碰撞:同來源重複、底座與專案相撞、表單展開撞固定頁,都在這裡抓。 */
const collectCollisions = (
  entries: readonly ExpandedPage[],
  problems: string[],
): ReadonlyMap<string, ExpandedPage> => {
  const origins = new Map<string, string[]>();
  const byKey = new Map<string, ExpandedPage>();
  for (const entry of entries) {
    const seen = origins.get(entry.key);
    if (seen === undefined) {
      origins.set(entry.key, [entry.origin]);
      byKey.set(entry.key, entry);
    } else {
      seen.push(entry.origin);
    }
  }
  for (const [key, seen] of origins) {
    if (seen.length > 1) {
      problems.push(`模組 key「${key}」重複登記:${seen.join("、")}`);
    }
  }
  return byKey;
};

/** 替換只能指向已存在的底座頁,而且一頁只能被替換一次。 */
const collectReplacements = (
  replacements: readonly ModulePageReplacement[],
  byKey: ReadonlyMap<string, ExpandedPage>,
  problems: string[],
): ReadonlyMap<string, ModulePageReplacement> => {
  const origins = new Map<string, string[]>();
  const byTarget = new Map<string, ModulePageReplacement>();
  for (const [index, replacement] of replacements.entries()) {
    const origin = `replacements[${String(index)}]`;
    const { target } = replacement;
    if (byKey.get(target)?.source !== "base") {
      problems.push(
        `替換的目標「${target}」不是已登記的底座頁:${origin}(專案自己的頁直接改登記,不用替換)`,
      );
      continue;
    }
    const seen = origins.get(target);
    if (seen === undefined) {
      origins.set(target, [origin]);
      byTarget.set(target, replacement);
    } else {
      seen.push(origin);
    }
  }
  for (const [target, seen] of origins) {
    if (seen.length > 1) {
      problems.push(`底座頁「${target}」被替換了兩次以上:${seen.join("、")}`);
    }
  }
  return byTarget;
};

/**
 * 底座與專案的頁面來源 → 一張登記表。任何碰撞(空 key、同來源重複、底座與專案相撞、表單展開撞固定頁、
 * 未知或重複的替換目標)都直接丟錯並列出 key 與來源 —— 在展開成物件「之前」驗,因為展開後被蓋掉的那一筆就看不到了。
 *
 * 不修改輸入;輸出是凍結的、沒有原型的物件,`pages[key]` 只查得到登記過的 key
 * (模組 key 剛好叫 `constructor` 也不會撈到物件原型上的成員)。
 */
export const composeModulePages = ({
  base,
  project,
  replacements,
}: ComposeModulePagesInput): ComposedModulePages => {
  const problems: string[] = [];
  const entries = [
    ...expandSource("base", base, problems),
    ...expandSource("project", project, problems),
  ];
  const byKey = collectCollisions(entries, problems);
  const byTarget = collectReplacements(replacements, byKey, problems);
  if (problems.length > 0) {
    throw new Error(
      ["模組頁面登記有問題:", ...problems.map((line) => `- ${line}`)].join(
        "\n",
      ),
    );
  }

  const pages = Object.create(null) as Record<string, PageComponent>;
  const pageMinWidths = Object.create(null) as Record<string, ShellMinWidth>;
  for (const [key, entry] of byKey) {
    const replacement = byTarget.get(key);
    pages[key] = replacement?.Page ?? entry.Page;
    const minWidth = replacement?.minWidth ?? entry.minWidth;
    if (minWidth !== undefined) {
      pageMinWidths[key] = minWidth;
    }
  }

  return {
    pages: Object.freeze(pages),
    pageMinWidths: Object.freeze(pageMinWidths),
    formModuleOptions: composeFormModuleOptions(
      [...base.forms, ...project.forms].map(({ moduleKey, options }) => ({
        moduleKey,
        ...(options !== undefined && { options }),
      })),
    ),
  };
};
