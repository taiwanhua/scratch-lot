/**
 * 依維護歸屬把路徑分成五類(正本:docs/architecture.md「底座與專案的維護歸屬」、STRUCT-12 的固定入口、
 * docs/project-initialization.md 的專案值位置)。這是審查的起點,不是語意判定:
 * `common` 只代表路徑屬於底座共用候選,仍須讀 exact delta 排除品牌或業務耦合(verify 第 5 節的專案字樣掃描)。
 *
 *   published-data  改寫、刪除或改變類型的已發布 migration / 種子快照(只能新增,見 check-immutable-sources)
 *   project         專案值、專案來源(含專案的 migration 與快照、文件、文案、skill)、部署設定、前台、品牌資產
 *   mixed           值行檔、依賴宣告、聚合產物、可含專案文案的語系檔、workflow、根目錄設定:逐段整合
 *   common          底座維護的程式、套件、工具與文件(含固定組裝入口);含底座新增的 migration / 快照
 *   unknown         以上都不是:不可自動歸類(verify 報告頂端計數,classify 測試守全 repo 為 0)
 *
 * 專案內容一律放所在目錄的 `project/` 子目錄(程式、文件、文案、測試資產同一個形狀);只有 skill 因為
 * Claude Code / Codex 只掃 `skills/<名稱>/` 一層,改以名單區分:底座 skill 列在 BASE_SKILLS,其餘都是專案的
 * (名稱以 `projectPublic.slug` 開頭,verify 第 7 節檢查)。
 */
import {
  IMMUTABLE_PATHS,
  immutableViolations,
} from "../../apps/db-migrator/scripts/check-immutable-sources.mjs";

export const CATEGORIES = [
  "common",
  "project",
  "mixed",
  "published-data",
  "unknown",
];

/**
 * 底座帶的 skill:repo 自製的兩個,加上底座 `skills-lock.json` 登記的外部 skill。
 * 專案自己另裝的外部 skill(專案的 skills-lock.json 多出的那幾個)不在此列,判 project。
 */
export const BASE_SKILLS = [
  "module-scaffold",
  "project-bootstrap",
  "vercel-react-best-practices",
  "web-design-guidelines",
  "writing-guidelines",
];

const SKILL_ROOT = String.raw`^\.(?:claude|agents)\/skills\/`;
const BASE_SKILL = new RegExp(`${SKILL_ROOT}(?:${BASE_SKILLS.join("|")})\/`);
const PROJECT_SKILL = new RegExp(
  `${SKILL_ROOT}(?!(?:${BASE_SKILLS.join("|")})\/)[^/]+\/`,
);

const PROJECT = [
  /^packages\/project-config\/src\/project\//,
  /^packages\/graphql\/src\/documents\/project\//,
  /^packages\/i18n\/messages\/[^/]+\/front\.json$/,
  // 專案後台文案(新增 / 替換底座字串,I18N-06);須排在 MIXED 的 messages/ 之前
  /^packages\/i18n\/messages\/[^/]+\/project\//,
  // 前後端共用的專案純邏輯(STRUCT-07);須排在 COMMON 的 packages/ 之前
  /^packages\/domain\/src\/project\//,
  /^apps\/db-migrator\/seeds\/project\//,
  /^apps\/db-migrator\/migrations\/project\//,
  /^apps\/[^/]+\/src\/(?:.+\/)?project\//,
  // E2E 的測試資產(上傳用的檔案等;specs / fixtures 程式在 src/**/project/)
  /^apps\/e2e\/fixtures\/project\//,
  /^apps\/[^/]+\/public\/favicon\.ico$/,
  // app 的品牌靜態資產(可安裝 app 的圖示與其 SVG 正本,檔名約定見 scripts/app-icons/)
  /^apps\/[^/]+\/public\/project\//,
  /^apps\/front\//,
  /^deploy\/project\//,
  /^deploy\/env\//,
  // 共用工具的專案設定(例:Figma 稽核的頁面 id、元件名稱、例外清單);須排在 COMMON 的 scripts/ 之前
  /^scripts\/[^/]+\/project\//,
  // 專案自己的名詞表(與底座的 CONTEXT.md 拆開)
  /^CONTEXT-PROJECT\.md$/,
  // 專案文件:各目錄的 project/(docs/modules/project/、docs/adr/project/…)與 docs/project/(單檔的專案版與入口)
  /^docs\/(?:.+\/)?project\//,
  // docs/tmp 只放實作 repo 的未完成工作(STRUCT-11);底座只同步自己的待辦 dis.md
  /^docs\/tmp\/(?!dis\.md$)/,
  PROJECT_SKILL,
];

const MIXED = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^(?:apps|packages)\/[^/]+\/package\.json$/,
  // 聚合底座與專案 API / 文件的生成產物(GQL-05):由來源重產,不直接回收
  /^apps\/api\/schema\.gql$/,
  /^packages\/graphql\/src\/generated\//,
  // admin / common 語系(專案文案另放 messages/<locale>/project/;這兩份目前仍可能含專案品牌字串)
  /^packages\/i18n\/messages\//,
  /^\.github\//,
  // 值行檔:標題行、範本值是專案值(verify 第 6 節只容許這些位置與底座不同)
  /^(?:CLAUDE|AGENTS|README)\.md$/,
  /(?:^|\/)\.env\.example$/,
  /(?:^|\/)docker-compose\.ya?ml$/,
  // 根目錄設定:專案可加 turbo env、忽略規則、外部 skill 或 Claude Code hook
  /^turbo\.json$/,
  /^\.gitignore$/,
  /^\.prettierignore$/,
  /^\.dockerignore$/,
  /^skills-lock\.json$/,
  /^\.claude\/settings\.json$/,
];

const COMMON = [
  /^packages\//,
  // 含固定組裝入口(module-pages.tsx、help-registry.ts、app.module.ts、database.module.ts、seeds/registry.ts):
  // 專案只改 project/ 來源,不改入口,所以入口與底座不同就是漂移(verify 第 1 節)
  /^apps\/(?:admin|api|db-migrator|e2e|print-agent|realtime|storybook)\//,
  /^scripts\//,
  // 底座文件(專案文件在 project/ 子目錄與 docs/project/,已在 PROJECT 先判)
  /^docs\//,
  /^CONTEXT\.md$/,
  BASE_SKILL,
  // 底座指定的 Node 版本(與根 package.json 的 engines、workflow 的 node-version 一致)
  /^\.nvmrc$/,
  /^\.npmrc$/,
  /^\.gitattributes$/,
];

const isImmutableSource = (file) =>
  IMMUTABLE_PATHS.some((dir) => file.startsWith(`${dir}/`));

/** `status` 是 `git diff --name-status --no-renames` 的狀態字母(A / M / D / T …)。 */
export function classifyPath(file, status) {
  if (
    isImmutableSource(file) &&
    immutableViolations(`${status}\t${file}`).length > 0
  ) {
    return "published-data";
  }
  if (PROJECT.some((pattern) => pattern.test(file))) return "project";
  if (MIXED.some((pattern) => pattern.test(file))) return "mixed";
  if (COMMON.some((pattern) => pattern.test(file))) return "common";
  return "unknown";
}

/** `.claude/skills/<名稱>/` 或 `.agents/skills/<名稱>/` 底下的檔 → `{ root, name }`;其他路徑回 null。 */
export function skillOf(file) {
  const match = /^\.(claude|agents)\/skills\/([^/]+)\//.exec(file);
  return match ? { root: match[1], name: match[2] } : null;
}

/** [{ path, status }] → 加上 category。 */
export const classifyFiles = (files) =>
  files.map((file) => ({
    ...file,
    category: classifyPath(file.path, file.status),
  }));
