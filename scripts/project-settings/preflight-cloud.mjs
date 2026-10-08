/**
 * Cloud Run 實際承接流量的 revision → image digest → Artifact Registry 部署 tag → 完整 commit。
 *
 * - 只看 `status.traffic` 中 percent > 0 的 revision,混合流量全部保留;不以最新建立的 revision 代替。
 * - revision 的 image 常是 digest:以 `gcloud artifacts docker tags list --filter=version:sha256:<digest>` 查 tag,
 *   逐筆核對 image 與 version 的 digest 完全相符,才採用 tag。新 tag 是
 *   `完整 commit-環境-run ID-attempt`;舊版 api 短 SHA 與 admin 短 SHA+環境尾碼仍可解析。
 * - SHA 由本機 Git 唯一解析;歧義、查無、多個相異 commit 一律 unknown,不猜測。
 * - 報告只帶 revision / percent / digest / 已核對的 commit 與差異;不轉印 service env 或原始回應。
 */
import { cumulativeDiff, resolveAbbreviation } from "./preflight-git.mjs";

export const APPS = [
  { app: "api", serviceKey: "api_service" },
  { app: "admin", serviceKey: "admin_service" },
];

const ADMIN_TAG_SUFFIX = { dev: "-dev", staging: "-staging", production: "" };
const REVISION_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * 呼叫 gcloud 並解析 JSON。`failure` 區分本機啟動不了(launch-failed)、查詢失敗(權限或資源,query-failed)
 * 與回應無法解析(invalid-output);原始錯誤一律不保留。
 */
async function gcloudJson(runExternal, args) {
  let result;
  try {
    result = await runExternal("gcloud", args);
  } catch {
    return { value: null, failure: "launch-failed" };
  }
  if (result?.isLaunchFailure === true) {
    return { value: null, failure: "launch-failed" };
  }
  if (result?.status !== 0) return { value: null, failure: "query-failed" };
  try {
    return { value: JSON.parse(result.stdout), failure: null };
  } catch {
    return { value: null, failure: "invalid-output" };
  }
}

/** 承接流量的 revision(同名合併 percent),順序依 traffic 列表;讀不到時回 null。 */
function servingRevisions(service) {
  const traffic = service?.status?.traffic;
  if (!Array.isArray(traffic)) return null;
  const percents = new Map();
  for (const entry of traffic) {
    const { revisionName: name, percent } = entry ?? {};
    if (typeof percent !== "number" || percent <= 0) continue;
    if (typeof name !== "string" || !REVISION_NAME.test(name)) return null;
    percents.set(name, (percents.get(name) ?? 0) + percent);
  }
  if (percents.size === 0) return null;
  return [...percents].map(([revision, percent]) => ({ revision, percent }));
}

/** tag 名稱 → Git SHA;只接受目前環境的新 tag 或此 app 的舊版格式。 */
function abbreviationOf(tag, app, environment) {
  const current =
    /^([0-9a-f]{40})-(dev|staging|production)-([1-9]\d*)-([1-9]\d*)$/.exec(tag);
  if (current) return current[2] === environment ? current[1] : null;
  const suffix = app === "admin" ? ADMIN_TAG_SUFFIX[environment] : "";
  if (suffix !== "" && !tag.endsWith(suffix)) return null;
  const sha = suffix === "" ? tag : tag.slice(0, -suffix.length);
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

/** tags list 的回應 → 唯一可證明的完整 commit,否則 null。 */
function commitFromTags(entries, context, digest) {
  const { app, environment, registry, root } = context;
  if (!Array.isArray(entries)) return null;
  const image = `${registry}/${app}`;
  const versionSuffix = `/packages/${app}/versions/sha256:${digest}`;
  const tagPattern = new RegExp(`/packages/${app}/tags/([^/]+)$`);
  const commits = new Set();
  for (const entry of entries) {
    if (entry?.image !== image) continue;
    if (
      typeof entry.version !== "string" ||
      !entry.version.endsWith(versionSuffix)
    ) {
      continue;
    }
    const tag =
      typeof entry.tag === "string" ? tagPattern.exec(entry.tag) : null;
    if (!tag) continue;
    const abbreviation = abbreviationOf(tag[1], app, environment);
    if (abbreviation === null) continue;
    const commit = resolveAbbreviation(root, abbreviation);
    if (commit === null) return null;
    commits.add(commit);
  }
  return commits.size === 1 ? [...commits][0] : null;
}

async function resolveRevision(context, { revision, percent }) {
  const { app, cloud, registry, root, runExternal, target } = context;
  const unknown = { revision, percent, digest: null, commit: null, diff: null };
  const described = await gcloudJson(runExternal, [
    "run",
    "revisions",
    "describe",
    revision,
    `--region=${cloud.region}`,
    `--project=${cloud.gcp_project_id}`,
    "--format=json",
  ]);
  const image = described.value?.spec?.containers?.[0]?.image;
  if (typeof image !== "string") return unknown;
  const prefix = `${registry}/${app}@sha256:`;
  if (!image.startsWith(prefix) || !DIGEST.test(image.slice(prefix.length))) {
    return unknown;
  }
  const digest = image.slice(prefix.length);
  const tags = await gcloudJson(runExternal, [
    "artifacts",
    "docker",
    "tags",
    "list",
    `${registry}/${app}`,
    `--project=${cloud.gcp_project_id}`,
    `--filter=version:sha256:${digest}`,
    "--format=json",
  ]);
  const commit = commitFromTags(tags.value, context, digest);
  return {
    revision,
    percent,
    digest: `sha256:${digest}`,
    commit,
    diff: commit === null ? null : cumulativeDiff(root, commit, target),
  };
}

/** 讀一個 app 的服務狀態;回傳報告段落與 issues。 */
export async function readApp({ app, serviceKey }, context) {
  const service = context.cloud[serviceKey];
  const described = await gcloudJson(context.runExternal, [
    "run",
    "services",
    "describe",
    service,
    `--region=${context.cloud.region}`,
    `--project=${context.cloud.gcp_project_id}`,
    "--format=json",
  ]);
  const serving = servingRevisions(described.value);
  if (serving === null) {
    return {
      entry: { app, service, revisions: null },
      issues: [
        {
          code: "CLOUD_STATUS_UNAVAILABLE",
          scope: app,
          reason: described.failure ?? "invalid-output",
        },
      ],
    };
  }
  const appContext = { ...context, app, registry: context.cloud.registry };
  const revisions = [];
  for (const item of serving) {
    revisions.push(await resolveRevision(appContext, item));
  }
  const issues = [];
  const unresolved = revisions.filter((item) => item.commit === null);
  if (unresolved.length > 0) {
    issues.push({
      code: "REVISION_UNRESOLVED",
      scope: app,
      revisions: unresolved.map((item) => item.revision),
    });
  }
  const diverged = revisions.filter((item) => item.diff?.isAncestor === false);
  if (diverged.length > 0) {
    issues.push({
      code: "REVISION_NOT_ANCESTOR",
      scope: app,
      revisions: diverged.map((item) => item.revision),
    });
  }
  return { entry: { app, service, revisions }, issues };
}
