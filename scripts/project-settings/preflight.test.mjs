/**
 * 發布前環境與累積資料差異(操作正本:docs/deployment.md「發布前環境與資料核對」)。
 * 目標 checkout 是真 Git;gcloud 與 migrator status 子行程是假實作(系統邊界)。
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

import { planExternal } from "./preflight-external.mjs";
import { runPreflight } from "./preflight-report.mjs";
import {
  PENDING_MIGRATION,
  SECRET_URI,
  SERVICE_ENV_LEAK,
  arTag,
  createFakeCloud,
  createTargetCheckout,
  digestOf,
  git,
  isolateGitConfig,
  runSummary,
  shortSha,
  statusJson,
} from "./preflight-test-support.mjs";
import { runScript } from "./test-support.mjs";

before(isolateGitConfig);

const API = "widgets-api-dev";
const ADMIN = "widgets-admin-dev";

/**
 * 預設環境:api 混合流量(00047 90% 對應 k1、00048 10% 的 digest 查無 tag),
 * admin 一個 revision 100%(tag 帶 `-dev` 後綴,對應 k2);DB 最後成功 update 在 k0。
 */
function defaultCloud(checkout, overrides = {}) {
  const { root, commits } = checkout;
  const apiKnown = digestOf("a");
  const apiUnknown = digestOf("b");
  const adminDigest = digestOf("c");
  return {
    services: {
      [API]: [
        { revision: `${API}-00047-twb`, percent: 90 },
        { revision: `${API}-00048-abc`, percent: 10 },
      ],
      [ADMIN]: [{ revision: `${ADMIN}-00012-xyz`, percent: 100 }],
    },
    revisions: {
      [`${API}-00047-twb`]: { app: "api", digest: apiKnown },
      [`${API}-00048-abc`]: { app: "api", digest: apiUnknown },
      [`${ADMIN}-00012-xyz`]: { app: "admin", digest: adminDigest },
    },
    tags: {
      [apiKnown]: [arTag("api", shortSha(root, commits.k1), apiKnown)],
      [apiUnknown]: [],
      [adminDigest]: [
        arTag("admin", `${shortSha(root, commits.k2)}-dev`, adminDigest),
      ],
    },
    status: {
      status: 0,
      stdout: JSON.stringify(
        statusJson({
          sourceCommit: commits.target,
          releaseCommit: commits.k0,
        }),
      ),
      stderr: "",
    },
    ...overrides,
  };
}

async function preflight(checkout, cloud, { target, env = {} } = {}) {
  const fake = createFakeCloud(cloud);
  const result = await runPreflight(
    ["--environment", "dev", "--target", target ?? checkout.commits.target],
    { cwd: checkout.root, env, runExternal: fake.runExternal },
  );
  return { ...result, fake };
}

function parseReport(result) {
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const paths = (diff) => diff.files.map((file) => file.path).sort();
const codes = (report) => report.issues.map((issue) => issue.code);
const appOf = (report, app) => report.apps.find((entry) => entry.app === app);

/** 報告與 stderr 都不得出現 URI、Secret、env 值或 gcloud 原始錯誤。 */
function assertNoSensitiveOutput(result) {
  for (const text of [result.stdout, result.stderr]) {
    for (const secret of [
      SECRET_URI,
      "hunter2-DB-PASSWORD",
      SERVICE_ENV_LEAK,
      "ya29.SECRET-ACCESS-TOKEN",
      "mongodb+srv://",
    ]) {
      assert.ok(!text.includes(secret), `輸出含敏感內容:${secret}`);
    }
  }
}

test("混合流量逐一列出實際承接流量的 revision,digest 經 Artifact Registry tag 解析成完整 commit,各自算到 target 的累積差異", async () => {
  const checkout = createTargetCheckout();
  const { commits } = checkout;
  const result = await preflight(checkout, defaultCloud(checkout));
  const report = parseReport(result);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.environment, "dev");
  assert.equal(report.targetCommit, commits.target);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));

  const api = appOf(report, "api");
  assert.equal(api.service, API);
  // 0% 的最新 revision 不算正在服務
  assert.deepEqual(
    api.revisions.map(({ revision, percent }) => ({ revision, percent })),
    [
      { revision: `${API}-00047-twb`, percent: 90 },
      { revision: `${API}-00048-abc`, percent: 10 },
    ],
  );
  const [known, unknown] = api.revisions;
  assert.equal(known.digest, `sha256:${digestOf("a")}`);
  assert.equal(known.commit, commits.k1);
  // 累積差異涵蓋 k1 之後的每個 commit,不只最後一批
  assert.deepEqual(known.diff.base, commits.k1);
  assert.deepEqual(paths(known.diff), [
    "apps/admin/src/main.tsx",
    "apps/api/src/app.ts",
    PENDING_MIGRATION,
  ]);
  assert.equal(unknown.commit, null);
  assert.equal(unknown.diff, null);

  const admin = appOf(report, "admin");
  assert.equal(admin.service, ADMIN);
  assert.equal(admin.revisions.length, 1);
  assert.equal(admin.revisions[0].commit, commits.k2);
  assert.deepEqual(paths(admin.revisions[0].diff), [
    "apps/admin/src/main.tsx",
    PENDING_MIGRATION,
  ]);

  // 資料來源差異以 DB 的成功基準(k0)計算,不以 api image 的 commit 代替
  assert.equal(report.database.state, "read");
  assert.equal(
    report.database.status.lastSuccessfulUpdate.releaseCommit,
    commits.k0,
  );
  assert.equal(report.dataChanges.base, commits.k0);
  assert.deepEqual(paths(report.dataChanges), [
    PENDING_MIGRATION,
    "apps/db-migrator/seeds/project/settings.ts",
  ]);

  const unresolved = report.issues.filter(
    (issue) => issue.code === "REVISION_UNRESOLVED",
  );
  assert.deepEqual(unresolved, [
    {
      code: "REVISION_UNRESOLVED",
      scope: "api",
      revisions: [`${API}-00048-abc`],
    },
  ]);
  for (const code of [
    "DATA_STATUS_UNAVAILABLE",
    "DATA_BASELINE_MISSING",
    "DATA_RUN_UNFINISHED",
  ]) {
    assert.ok(!codes(report).includes(code), code);
  }

  // Secret 只在子行程環境傳遞,不出現在任何輸出
  assert.deepEqual(result.fake.seenUris, [SECRET_URI]);
  assertNoSensitiveOutput(result);
  // tag 只從 Artifact Registry 的 tags list 查,不用 images describe
  for (const call of result.fake.calls) {
    assert.ok(!call.args.join(" ").includes("images describe"));
  }
});

test("digest 對應 commit 須能被證明:image / version 不符、多個 tag 指向不同 commit、本機沒有的 commit 一律 unknown;多個 tag 指向同一 commit 可接受", async () => {
  const checkout = createTargetCheckout();
  const { root, commits } = checkout;
  const digest = digestOf("a");
  const k1 = shortSha(root, commits.k1);
  const cases = [
    {
      name: "tag 屬於別的 image",
      tags: [
        arTag("api", k1, digest, {
          image: "europe-west1-docker.pkg.dev/acme-widgets/widgets/admin",
        }),
      ],
      expected: null,
    },
    {
      name: "version 的 digest 不同",
      tags: [arTag("api", k1, digestOf("f"))],
      expected: null,
    },
    {
      name: "兩個 tag 指向不同 commit",
      tags: [
        arTag("api", k1, digest),
        arTag("api", shortSha(root, commits.k2), digest),
      ],
      expected: null,
    },
    {
      name: "tag 的 commit 不在本機歷史",
      tags: [arTag("api", "0badc0d", digest)],
      expected: null,
    },
    {
      name: "tag 不是 commit 格式",
      tags: [arTag("api", "latest", digest)],
      expected: null,
    },
    {
      name: "兩個 tag 證明同一個 commit",
      tags: [
        arTag("api", k1, digest),
        arTag("api", git(root, "rev-parse", "--short=10", commits.k1), digest),
      ],
      expected: commits.k1,
    },
  ];
  for (const scenario of cases) {
    const cloud = defaultCloud(checkout);
    cloud.services[API] = [{ revision: `${API}-00047-twb`, percent: 100 }];
    cloud.tags[digest] = scenario.tags;
    const report = parseReport(await preflight(checkout, cloud));
    const [revision] = appOf(report, "api").revisions;
    assert.equal(revision.commit, scenario.expected, scenario.name);
    const flagged = report.issues.some(
      (issue) =>
        issue.code === "REVISION_UNRESOLVED" &&
        issue.revisions.includes(`${API}-00047-twb`),
    );
    assert.equal(flagged, scenario.expected === null, scenario.name);
  }
});

test("同 commit 跨環境與同環境重建後,舊 digest 的獨立 tag 仍能證明來源", async () => {
  const checkout = createTargetCheckout();
  const { commits } = checkout;
  const first = digestOf("a");
  const rebuilt = digestOf("b");
  const cloud = defaultCloud(checkout);
  cloud.tags[first] = [arTag("api", `${commits.k1}-dev-123-1`, first)];
  cloud.tags[rebuilt] = [
    arTag("api", `${commits.k1}-dev-124-1`, rebuilt),
    arTag("api", `${commits.k1}-staging-125-1`, rebuilt),
  ];
  const report = parseReport(await preflight(checkout, cloud));
  assert.deepEqual(
    appOf(report, "api").revisions.map(({ commit }) => commit),
    [commits.k1, commits.k1],
  );
  assert.equal(
    report.issues.some((issue) => issue.code === "REVISION_UNRESOLVED"),
    false,
  );

  cloud.tags[first] = [arTag("api", `${commits.k1}-staging-125-1`, first)];
  const wrongEnvironment = parseReport(await preflight(checkout, cloud));
  assert.equal(appOf(wrongEnvironment, "api").revisions[0].commit, null);
  assert.equal(
    wrongEnvironment.issues.some(
      (issue) => issue.code === "REVISION_UNRESOLVED",
    ),
    true,
  );
});

test("DB 狀態未知或不完整不得當成沒有待部署差異", async () => {
  const checkout = createTargetCheckout();
  const { commits } = checkout;
  const okStatus = (overrides) => ({
    status: 0,
    stdout: JSON.stringify(
      statusJson({
        sourceCommit: commits.target,
        releaseCommit: commits.k0,
        ...overrides,
      }),
    ),
    stderr: "",
  });
  const cases = [
    {
      name: "status 子行程失敗(原始錯誤帶 URI)",
      status: {
        status: 1,
        stdout: "",
        stderr: `MongoServerSelectionError: ${SECRET_URI}`,
      },
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "stdout 不是 JSON",
      status: { status: 0, stdout: "已套用 3 個 migration\n", stderr: "" },
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "未知 schemaVersion",
      status: okStatus({ schemaVersion: 2 }),
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "必填欄位為 null(成功基準的 startedAt)",
      status: okStatus({
        lastSuccessfulUpdate: runSummary({
          releaseCommit: commits.k0,
          startedAt: null,
        }),
      }),
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "status 的來源不是本次 target",
      status: okStatus({ sourceCommit: commits.k3 }),
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "status 無法證明來源(sourceCommit 為 null)",
      status: okStatus({ sourceCommit: null }),
      code: "DATA_STATUS_UNAVAILABLE",
      hasDataChanges: false,
    },
    {
      name: "子行程輸出夾帶契約外欄位(只投影白名單,不轉印)",
      status: okStatus({
        connection: SECRET_URI,
        lock: null,
        migrations: {
          ...statusJson({ sourceCommit: null, releaseCommit: null }).migrations,
          pending: [
            {
              fileName: "20261001120000_data_sample.js",
              origin: "base",
              uri: SECRET_URI,
            },
          ],
        },
      }),
      code: null,
      hasDataChanges: true,
    },
    {
      name: "受管定義安裝未完成(即使目前 registry 已不含該項、且有成功基準)",
      status: okStatus({
        definitions: {
          open: [
            {
              kind: "form",
              key: "retired-form",
              revision: "3",
              runId: "run-2",
            },
          ],
        },
      }),
      code: "DEFINITION_UPDATE_INCOMPLETE",
      hasDataChanges: true,
    },
    {
      name: "沒有成功基準",
      status: okStatus({
        lastSuccessfulUpdate: null,
        subsequentRuns: null,
      }),
      code: "DATA_BASELINE_MISSING",
      hasDataChanges: false,
    },
    {
      name: "成功基準的 releaseCommit 為 null",
      status: okStatus({
        lastSuccessfulUpdate: runSummary({ releaseCommit: null }),
      }),
      code: "DATA_BASELINE_MISSING",
      hasDataChanges: false,
    },
    {
      name: "成功基準的 commit 不在本機歷史",
      status: okStatus({
        lastSuccessfulUpdate: runSummary({
          releaseCommit: "0".repeat(40),
        }),
      }),
      code: "DATA_BASELINE_MISSING",
      hasDataChanges: false,
    },
    {
      name: "基準之後有失敗的執行",
      status: okStatus({
        subsequentRuns: [
          runSummary({
            runId: "run-2",
            status: "failed",
            stage: "migrations",
            releaseCommit: commits.k3,
            startedAt: "2026-10-02T00:00:00.000Z",
            finishedAt: "2026-10-02T00:01:00.000Z",
          }),
        ],
      }),
      code: "DATA_RUN_UNFINISHED",
      hasDataChanges: true,
    },
    {
      name: "有未完成的 migration",
      status: okStatus({
        migrations: {
          ...statusJson({ sourceCommit: null, releaseCommit: null }).migrations,
          open: [
            {
              fileName: "20261001120000_data_sample.js",
              status: "started",
              runId: "run-2",
              releaseCommit: commits.k3,
            },
          ],
        },
      }),
      code: "DATA_RUN_UNFINISHED",
      hasDataChanges: true,
    },
    {
      name: "鎖仍被持有",
      status: okStatus({
        lock: {
          owner: "runner-1",
          runId: "run-3",
          operation: "update",
          releaseCommit: commits.k3,
          startedAt: "2026-10-03T00:00:00.000Z",
        },
      }),
      code: "DATA_RUN_UNFINISHED",
      hasDataChanges: true,
    },
  ];
  for (const scenario of cases) {
    const result = await preflight(
      checkout,
      defaultCloud(checkout, { status: scenario.status }),
    );
    const report = parseReport(result);
    if (scenario.code === null) {
      assert.equal(report.database.state, "read", scenario.name);
      assert.deepEqual(report.database.status.migrations.pending, [
        { fileName: "20261001120000_data_sample.js", origin: "base" },
      ]);
    } else {
      assert.ok(codes(report).includes(scenario.code), scenario.name);
      const issue = report.issues.find((entry) => entry.code === scenario.code);
      assert.equal(issue.scope, "database", scenario.name);
    }
    if (scenario.hasDataChanges) {
      assert.notEqual(report.dataChanges, null, scenario.name);
    } else {
      // 未核對時不能給出空的差異清單冒充「沒有資料變更」
      assert.equal(report.dataChanges, null, scenario.name);
    }
    assertNoSensitiveOutput(result);
  }
});

test("gcloud 查詢失敗:報告列為未核對,不輸出原始錯誤,也不列空 revision 冒充沒有差異", async () => {
  const checkout = createTargetCheckout();
  const result = await preflight(
    checkout,
    defaultCloud(checkout, { failServices: true }),
  );
  const report = parseReport(result);
  const issues = report.issues.filter(
    (issue) => issue.code === "CLOUD_STATUS_UNAVAILABLE",
  );
  assert.deepEqual(issues.map((issue) => issue.scope).sort(), ["admin", "api"]);
  assert.ok(issues.every((issue) => issue.reason === "query-failed"));
  assert.equal(appOf(report, "api").revisions, null);
  assert.equal(appOf(report, "admin").revisions, null);
  assertNoSensitiveOutput(result);

  // 本機啟動不了外部工具與查詢失敗分開回報
  const launch = parseReport(
    await runPreflight(
      ["--environment", "dev", "--target", checkout.commits.target],
      {
        cwd: checkout.root,
        env: {},
        runExternal: () => ({
          status: null,
          stdout: "",
          stderr: "",
          isLaunchFailure: true,
        }),
      },
    ),
  );
  assert.deepEqual(
    launch.issues.map(({ code, scope, reason }) => ({ code, scope, reason })),
    [
      {
        code: "CLOUD_STATUS_UNAVAILABLE",
        scope: "api",
        reason: "launch-failed",
      },
      {
        code: "CLOUD_STATUS_UNAVAILABLE",
        scope: "admin",
        reason: "launch-failed",
      },
      {
        code: "DATA_STATUS_UNAVAILABLE",
        scope: "database",
        reason: "launch-failed",
      },
    ],
  );
});

test("外部邊界:Windows 的 gcloud 經系統 PowerShell -File 執行 PATH 上的 SDK launcher,其他平台直接執行;migrator 用同一 checkout 的 tsx 跑 run.ts,不經 pnpm", () => {
  const sdkBin = "D:\\Tools\\CloudSDK\\bin";
  const powershell =
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const files = new Set([
    `${sdkBin}\\gcloud.ps1`,
    "D:\\Tools\\CloudSDK\\lib\\gcloud.py",
    powershell,
  ]);
  const checkoutRoot = path.resolve("checkout-root");
  const resolved = [];
  const host = {
    platform: "win32",
    env: {
      Path: `C:\\Windows;relative\\bin;${sdkBin}`,
      SystemRoot: "C:\\Windows",
    },
    exists: (file) => files.has(file),
    root: checkoutRoot,
    resolveModule: (packageJson, specifier) => {
      resolved.push([packageJson, specifier]);
      return "tsx-cli.mjs";
    },
    execPath: "node-executable",
  };
  const args = ["run", "services", "describe", "svc", "--format=json"];
  assert.deepEqual(planExternal("gcloud", args, host), {
    file: powershell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      `${sdkBin}\\gcloud.ps1`,
      ...args,
    ],
  });
  // 不在 PATH、或 launcher 旁沒有 SDK 本體:啟動失敗,不猜安裝路徑
  assert.equal(
    planExternal("gcloud", args, {
      ...host,
      env: { ...host.env, Path: "C:\\Windows" },
    }),
    null,
  );
  assert.equal(
    planExternal("gcloud", args, {
      ...host,
      exists: (file) =>
        file !== "D:\\Tools\\CloudSDK\\lib\\gcloud.py" && files.has(file),
    }),
    null,
  );
  assert.deepEqual(
    planExternal("gcloud", args, { ...host, platform: "linux" }),
    {
      file: "gcloud",
      args,
    },
  );

  const packageDir = path.join(checkoutRoot, "apps", "db-migrator");
  assert.deepEqual(planExternal("migrator", ["--status", "--json"], host), {
    file: "node-executable",
    args: [
      "tsx-cli.mjs",
      "src/update/run.ts",
      "--alias=migrate:status",
      "--status",
      "--json",
    ],
    cwd: packageDir,
  });
  assert.deepEqual(resolved, [
    [path.join(packageDir, "package.json"), "tsx/cli"],
  ]);
  // 只允許唯讀 status;依賴缺少時是啟動失敗;其他命令一律不執行
  assert.equal(planExternal("migrator", ["--down"], host), null);
  assert.equal(
    planExternal("migrator", ["--status", "--json"], {
      ...host,
      resolveModule: () => {
        throw new Error("missing");
      },
    }),
    null,
  );
  assert.equal(planExternal("pnpm", ["install"], host), null);
});

test("前置條件不符直接拒絕,不碰任何外部系統:target 不是目前 checkout、有未提交改動、未知環境", async () => {
  const checkout = createTargetCheckout();
  const { root, commits } = checkout;
  const cases = [
    {
      name: "target 是較舊的 commit",
      args: ["--environment", "dev", "--target", commits.k3],
    },
    {
      name: "target 不是完整 SHA",
      args: ["--environment", "dev", "--target", commits.target.slice(0, 7)],
    },
    {
      name: "未知環境",
      args: ["--environment", "qa", "--target", commits.target],
    },
  ];
  for (const scenario of cases) {
    const fake = createFakeCloud(defaultCloud(checkout));
    const result = await runPreflight(scenario.args, {
      cwd: root,
      env: {},
      runExternal: fake.runExternal,
    });
    assert.notEqual(result.exitCode, 0, scenario.name);
    assert.equal(result.stdout, "", scenario.name);
    assert.notEqual(result.stderr, "", scenario.name);
    assert.deepEqual(fake.calls, [], scenario.name);
  }

  writeFileSync(
    path.join(root, "apps/api/src/app.ts"),
    "export const app = 2;\n",
  );
  const fake = createFakeCloud(defaultCloud(checkout));
  const dirty = await runPreflight(
    ["--environment", "dev", "--target", commits.target],
    { cwd: root, env: {}, runExternal: fake.runExternal },
  );
  assert.notEqual(dirty.exitCode, 0);
  assert.equal(dirty.stdout, "");
  assert.match(dirty.stderr, /未提交/);
  assert.deepEqual(fake.calls, []);
});

test("CLI 入口:參數不合法時在任何外部呼叫前失敗,stdout 為空", () => {
  const checkout = createTargetCheckout();
  const result = runScript(
    "preflight.mjs",
    ["--environment", "qa", "--target", checkout.commits.target],
    { cwd: checkout.root },
  );
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /environment/);
});
