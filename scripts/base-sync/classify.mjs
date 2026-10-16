/**
 * 依維護歸屬把路徑分成五類(正本:docs/architecture.md「底座與專案的維護歸屬」、STRUCT-12 的固定入口、
 * docs/project-initialization.md 的專案值位置)。這是審查的起點,不是語意判定:
 * `common` 只代表路徑屬於底座共用候選,仍須讀 exact delta 排除品牌或業務耦合。
 *
 *   published-data  改寫、刪除或改變類型的已發布 migration / 種子快照(只能新增,見 check-immutable-sources)
 *   project         專案值、專案來源(含專案的 migration 與快照)、部署設定、前台、品牌資產、receipt
 *   mixed           固定組裝入口、依賴宣告、聚合產物、可含專案文案的語系檔、workflow、共用文件:逐段整合
 *   common          底座維護的程式、套件與工具;含底座新增的 migration / 快照
 *   unknown         以上都不是:不可自動歸類
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

const PROJECT = [
  /^packages\/project-config\/src\/project\//,
  /^packages\/graphql\/src\/documents\/project\//,
  /^packages\/i18n\/messages\/[^/]+\/front\.json$/,
  /^apps\/db-migrator\/seeds\/project\//,
  /^apps\/db-migrator\/migrations\/project\//,
  /^apps\/[^/]+\/src\/(?:.+\/)?project\//,
  /^apps\/[^/]+\/public\/favicon\.ico$/,
  /^apps\/front\//,
  /^deploy\/project\//,
  /^deploy\/env\//,
  // 共用工具的專案設定(例:Figma 稽核的頁面 id、元件名稱、例外清單);須排在 COMMON 的 scripts/ 之前
  /^scripts\/[^/]+\/project\//,
  // 專案自己的名詞表與討論紀錄(與底座的 CONTEXT.md、docs/tmp/dis.md 拆開);須排在 MIXED 的 *.md / docs/ 之前
  /^CONTEXT-PROJECT\.md$/,
  /^docs\/tmp\/project-dis\.md$/,
];

const MIXED = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^(?:apps|packages)\/[^/]+\/package\.json$/,
  /^apps\/admin\/src\/app\/module-pages\.tsx$/,
  /^apps\/admin\/src\/lib\/base\/help-registry\.ts$/,
  // 搬進 lib/base/ 之前的位置:比對分層前的底座版本時仍會出現,過渡期一併視為固定入口
  /^apps\/admin\/src\/lib\/help-registry\.ts$/,
  /^apps\/api\/src\/app\.module\.ts$/,
  /^apps\/api\/src\/database\/database\.module\.ts$/,
  /^apps\/db-migrator\/seeds\/registry\.ts$/,
  // 聚合底座與專案 API / 文件的生成產物(GQL-05):由來源重產,不直接回收
  /^apps\/api\/schema\.gql$/,
  /^packages\/graphql\/src\/generated\//,
  // admin / common 語系可含專案品牌與擴充文案
  /^packages\/i18n\/messages\//,
  /^\.github\//,
  /^docs\//,
  /^[^/]+\.md$/,
  /(?:^|\/)\.env\.example$/,
  /(?:^|\/)docker-compose\.ya?ml$/,
];

const COMMON = [
  /^packages\//,
  /^apps\/(?:admin|api|db-migrator|e2e|print-agent|realtime|storybook)\//,
  /^scripts\//,
  // 底座帶的 repo 自製 Claude skill(module-scaffold、project-bootstrap…);專案自己的 skill 日後需要時另立 project/ 規則
  /^\.claude\/skills\//,
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

/** [{ path, status }] → 加上 category。 */
export const classifyFiles = (files) =>
  files.map((file) => ({
    ...file,
    category: classifyPath(file.path, file.status),
  }));
