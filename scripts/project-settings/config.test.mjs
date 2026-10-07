import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_OUTPUT_KEYS,
  ENVIRONMENTS,
  ProjectSettingsError,
  STATUS_OPTION_KEYS,
  resolveCloudConfig,
  resolveGithubConfig,
} from "./config.mjs";
import {
  LEGACY_COOKHOME_REPOSITORY,
  disabledCloud,
  legacyCookhomeCloud,
  legacyCookhomeGithub,
  liveRepository,
  makeLegacyCookhomeRoot,
  makeProjectRoot,
  repoRoot,
  sampleCloud,
  sampleGithub,
} from "./test-support.mjs";

const REPO = "acme/widgets";

/** 抽設定前 deploy.yml / reset-db.yml / project-status.yml 內寫死的值,逐項手抄作為對照組。 */
const ORIGINAL_SHARED = {
  gcp_project_id: "cookhome-online",
  region: "asia-east1",
  registry: "asia-east1-docker.pkg.dev/cookhome-online/cookhome",
  registry_host: "asia-east1-docker.pkg.dev",
  wif_provider:
    "projects/728045896207/locations/global/workloadIdentityPools/github/providers/github-oidc",
  deployer_sa: "github-deployer@cookhome-online.iam.gserviceaccount.com",
  root_account: "root",
  root_email: "a0987837233@gmail.com",
};
const ORIGINAL_ENVIRONMENTS = {
  dev: {
    api_service: "cookhome-api-dev",
    admin_service: "cookhome-admin-dev",
    api_url: "https://api-dev.cookhome.online",
    mongodb_secret: "mongodb-uri-dev",
    enc_secret: "field-encryption-key-dev",
    root_secret: "root-admin-password-dev",
    jwt_secret: "jwt-secret-dev",
    resend_secret: "resend-api-key-dev",
  },
  staging: {
    api_service: "cookhome-api-staging",
    admin_service: "cookhome-admin-staging",
    api_url: "https://api-staging.cookhome.online",
    mongodb_secret: "mongodb-uri-staging",
    enc_secret: "field-encryption-key-staging",
    root_secret: "root-admin-password-staging",
    jwt_secret: "jwt-secret-staging",
    resend_secret: "resend-api-key-staging",
  },
  production: {
    api_service: "cookhome-api",
    admin_service: "cookhome-admin",
    api_url: "https://api.cookhome.online",
    mongodb_secret: "mongodb-uri",
    enc_secret: "field-encryption-key",
    root_secret: "root-admin-password",
    jwt_secret: "jwt-secret",
    resend_secret: "resend-api-key",
  },
};
const ORIGINAL_BOARD = {
  enabled: true,
  project_id: "PVT_kwHOAeiiKc4BjXhz",
  status_field_id: "PVTSSF_lAHOAeiiKc4BjXhzzhiME14",
  options: {
    backlog: "2882aeb7",
    ready: "e053bab2",
    inProgress: "5adedc57",
    review: "43e18a1a",
    devVerify: "0eaa8179",
    devPassed: "cc87d3d5",
    stagingVerify: "e94980d1",
    stagingPassed: "45c49925",
    released: "e3445e43",
    wontDo: "b6b968cd",
  },
};

const expectError = (fn, pattern) =>
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ProjectSettingsError, String(error));
    assert.match(error.message, pattern);
    return true;
  });

test("CookHome 相容性夾具:三環境解析結果與抽設定前的 workflow 逐值相同", () => {
  const rootDir = makeLegacyCookhomeRoot();
  for (const environment of ENVIRONMENTS) {
    assert.deepEqual(
      resolveCloudConfig({
        rootDir,
        environment,
        repository: LEGACY_COOKHOME_REPOSITORY,
      }),
      { ...ORIGINAL_SHARED, ...ORIGINAL_ENVIRONMENTS[environment] },
      environment,
    );
  }
});

test("CookHome 相容性夾具:看板識別與原 project-status.yml / issue-tracker 的十個狀態逐值相同", () => {
  assert.deepEqual(
    resolveGithubConfig({
      rootDir: makeLegacyCookhomeRoot(),
      repository: LEGACY_COOKHOME_REPOSITORY,
    }),
    ORIGINAL_BOARD,
  );
});

// 正式設定只驗 schema 與 repo 身分,不斷言任何專案值:
// 換 endpoint、換資源或整份換成另一個專案都是合法變更,不該逼專案回頭改底座測試。
test("正式設定:兩份 JSON 通過 schema,三環境與看板都解析得出固定的鍵", () => {
  const repository = liveRepository();
  for (const environment of ENVIRONMENTS) {
    const resolved = resolveCloudConfig({
      rootDir: repoRoot,
      environment,
      repository,
    });
    // 尚未啟用雲端的專案只解析出停用狀態
    if (resolved.enabled === false) {
      assert.deepEqual(resolved, { enabled: false }, environment);
    } else {
      assert.deepEqual(Object.keys(resolved), CLOUD_OUTPUT_KEYS, environment);
    }
  }
  const board = resolveGithubConfig({ rootDir: repoRoot, repository });
  assert.equal(typeof board.enabled, "boolean");
  if (board.enabled) {
    assert.deepEqual(Object.keys(board.options), STATUS_OPTION_KEYS);
  } else {
    assert.deepEqual(board, { enabled: false });
  }
});

test("正式設定:repo 身分不符時照樣被拒絕(不因為是正式檔而放行)", () => {
  expectError(
    () =>
      resolveGithubConfig({
        rootDir: repoRoot,
        repository: "not-this/project-at-all",
      }),
    /repository/,
  );
  expectError(
    () =>
      resolveCloudConfig({
        rootDir: repoRoot,
        environment: "dev",
        repository: "not-this/project-at-all",
      }),
    /repository/,
  );
});

test("cloud 輸出的鍵固定為契約的十六個,且全是字串", () => {
  const resolved = resolveCloudConfig({
    rootDir: makeProjectRoot(),
    environment: "staging",
    repository: REPO,
  });
  assert.deepEqual(Object.keys(resolved), CLOUD_OUTPUT_KEYS);
  assert.equal(CLOUD_OUTPUT_KEYS.length, 16);
  for (const value of Object.values(resolved))
    assert.equal(typeof value, "string");
  assert.equal(resolved.api_service, "widgets-api-staging");
  assert.equal(resolved.registry_host, "europe-west1-docker.pkg.dev");
  assert.equal(resolved.root_secret, "owner-password-staging");
});

test("替代專案的設定不會解析出任何 CookHome 值", () => {
  const root = makeProjectRoot();
  const serialized = JSON.stringify([
    ...ENVIRONMENTS.map((environment) =>
      resolveCloudConfig({ rootDir: root, environment, repository: REPO }),
    ),
    resolveGithubConfig({ rootDir: root, repository: REPO }),
  ]);
  assert.doesNotMatch(serialized, /cookhome|taiwanhua|PVT_kwHO|728045896207/i);
});

test("repository 與 expectedRepository 不符即拒絕(cloud 與 github 兩入口)", () => {
  const root = makeProjectRoot();
  expectError(
    () =>
      resolveCloudConfig({
        rootDir: root,
        environment: "dev",
        repository: "someone/fork",
      }),
    /repository/,
  );
  expectError(
    () => resolveGithubConfig({ rootDir: root, repository: "someone/fork" }),
    /repository/,
  );
});

test("repository 輸入缺少或格式不對即拒絕,不拿設定檔自己的值充當", () => {
  const root = makeProjectRoot();
  for (const repository of [
    undefined,
    "",
    "widgets",
    "acme/widgets/extra",
    "acme/wid gets",
  ]) {
    expectError(
      () => resolveGithubConfig({ rootDir: root, repository }),
      /repository/,
    );
    expectError(
      () =>
        resolveCloudConfig({ rootDir: root, environment: "dev", repository }),
      /repository/,
    );
  }
});

test("未知或缺少的環境即拒絕", () => {
  const root = makeProjectRoot();
  for (const environment of [
    undefined,
    "",
    "prod",
    "DEV",
    "__proto__",
    "toString",
  ]) {
    expectError(
      () =>
        resolveCloudConfig({ rootDir: root, environment, repository: REPO }),
      /environment/,
    );
  }
});

test("schemaVersion 未知或缺少即拒絕(兩份檔各自檢查)", () => {
  for (const version of [undefined, 0, 2, "1"]) {
    const github = { ...sampleGithub(), schemaVersion: version };
    const cloud = { ...sampleCloud(), schemaVersion: version };
    expectError(
      () =>
        resolveGithubConfig({
          rootDir: makeProjectRoot({ github }),
          repository: REPO,
        }),
      /github\.json.*schemaVersion/,
    );
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ github }),
          environment: "dev",
          repository: REPO,
        }),
      /github\.json.*schemaVersion/,
    );
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud }),
          environment: "dev",
          repository: REPO,
        }),
      /cloud\.json.*schemaVersion/,
    );
  }
});

test("設定檔不存在或不是合法 JSON 即拒絕,不回退任何預設值", () => {
  expectError(
    () =>
      resolveGithubConfig({
        rootDir: makeProjectRoot({ github: null }),
        repository: REPO,
      }),
    /github\.json/,
  );
  expectError(
    () =>
      resolveCloudConfig({
        rootDir: makeProjectRoot({ cloud: null }),
        environment: "dev",
        repository: REPO,
      }),
    /cloud\.json/,
  );
  expectError(
    () =>
      resolveGithubConfig({
        rootDir: makeProjectRoot({ github: "{ not json" }),
        repository: REPO,
      }),
    /github\.json/,
  );
  expectError(
    () =>
      resolveCloudConfig({
        rootDir: makeProjectRoot({ cloud: "[]" }),
        environment: "dev",
        repository: REPO,
      }),
    /cloud\.json/,
  );
});

test("github scope 不依賴 cloud.json", () => {
  const root = makeProjectRoot({ cloud: null });
  assert.equal(
    resolveGithubConfig({ rootDir: root, repository: REPO }).enabled,
    true,
  );
  const broken = makeProjectRoot({ cloud: "{ not json" });
  assert.equal(
    resolveGithubConfig({ rootDir: broken, repository: REPO }).enabled,
    true,
  );
});

test("cloud 的每個必要欄位缺少時都拒絕,並指出欄位路徑", () => {
  const paths = [
    ["gcp", "projectId"],
    ["gcp", "region"],
    ["gcp", "artifactRegistry"],
    ["gcp", "workloadIdentityProvider"],
    ["gcp", "deployServiceAccount"],
    ["environments", "dev", "apiService"],
    ["environments", "dev", "adminService"],
    ["environments", "dev", "apiUrl"],
    ["environments", "dev", "rootAdmin", "account"],
    ["environments", "dev", "rootAdmin", "email"],
    ["environments", "dev", "secrets", "mongodbUri"],
    ["environments", "dev", "secrets", "fieldEncryptionKey"],
    ["environments", "dev", "secrets", "rootAdminPassword"],
    ["environments", "dev", "secrets", "jwtSecret"],
  ];
  for (const segments of paths) {
    for (const mutate of [
      (parent, key) => delete parent[key],
      (parent, key) => (parent[key] = ""),
      (parent, key) => (parent[key] = 42),
      (parent, key) => (parent[key] = null),
    ]) {
      const cloud = sampleCloud();
      let parent = cloud;
      for (const segment of segments.slice(0, -1)) parent = parent[segment];
      mutate(parent, segments.at(-1));
      expectError(
        () =>
          resolveCloudConfig({
            rootDir: makeProjectRoot({ cloud }),
            environment: "dev",
            repository: REPO,
          }),
        new RegExp(segments.join("\\.")),
      );
    }
  }
});

test("Resend 未啟用時仍能解析 cloud 設定,其他 secret 仍必填", () => {
  const cloud = sampleCloud();
  cloud.environments.dev.secrets.resendApiKey = null;
  const resolved = resolveCloudConfig({
    rootDir: makeProjectRoot({ cloud }),
    environment: "dev",
    repository: REPO,
  });
  assert.equal(resolved.resend_secret, "");
  for (const invalid of [undefined, "", 42]) {
    const changed = sampleCloud();
    if (invalid === undefined)
      delete changed.environments.dev.secrets.resendApiKey;
    else changed.environments.dev.secrets.resendApiKey = invalid;
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud: changed }),
          environment: "dev",
          repository: REPO,
        }),
      /environments\.dev\.secrets\.resendApiKey/,
    );
  }
});

test("三環境 key 固定:少一個、多一個或有未知欄位都拒絕,即使目標環境本身完整", () => {
  const missing = sampleCloud();
  delete missing.environments.production;
  const extra = sampleCloud();
  extra.environments.qa = extra.environments.dev;
  const unknownField = sampleCloud();
  unknownField.environments.staging.bucket = "not-allowed-here";
  const unknownTop = { ...sampleCloud(), fallback: {} };
  for (const cloud of [missing, extra, unknownField, unknownTop]) {
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud }),
          environment: "dev",
          repository: REPO,
        }),
      /cloud\.json/,
    );
  }
});

test("字串含控制字元(換行、CR、NUL、ESC)一律拒絕,錯誤訊息不回印該值", () => {
  for (const bad of [
    "line\nbreak",
    "cr\rhere",
    "nul\u0000",
    "esc\u001b[0m",
    "tab\there",
  ]) {
    const cloud = sampleCloud();
    cloud.environments.dev.rootAdmin.account = `owner${bad}::error::injected`;
    assert.throws(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud }),
          environment: "dev",
          repository: REPO,
        }),
      (error) => {
        assert.ok(error instanceof ProjectSettingsError);
        assert.match(error.message, /environments\.dev\.rootAdmin\.account/);
        assert.doesNotMatch(error.message, /injected/);
        return true;
      },
    );
    const github = sampleGithub();
    github.projectStatus.projectId = `PVT_${bad}`;
    expectError(
      () =>
        resolveGithubConfig({
          rootDir: makeProjectRoot({ github }),
          repository: REPO,
        }),
      /projectStatus\.projectId/,
    );
  }
});

test("雲端識別欄位拒絕 shell 特殊字元;root 帳號屬自由文字,原樣保留交給 env 安全傳遞", () => {
  const injections = [
    "x; rm -rf /",
    "$(id)",
    "`id`",
    "a b",
    "a|b",
    "a&b",
    "a'b",
    'a"b',
    "a>b",
  ];
  const targets = [
    (cloud, value) => (cloud.gcp.projectId = value),
    (cloud, value) => (cloud.gcp.region = value),
    (cloud, value) => (cloud.gcp.artifactRegistry = value),
    (cloud, value) => (cloud.gcp.workloadIdentityProvider = value),
    (cloud, value) => (cloud.gcp.deployServiceAccount = value),
    (cloud, value) => (cloud.environments.dev.apiService = value),
    (cloud, value) => (cloud.environments.dev.adminService = value),
    (cloud, value) => (cloud.environments.dev.apiUrl = `https://${value}`),
    (cloud, value) => (cloud.environments.dev.secrets.mongodbUri = value),
    (cloud, value) => (cloud.environments.dev.secrets.jwtSecret = value),
    (cloud, value) =>
      (cloud.environments.dev.rootAdmin.email = `${value}@x.example`),
  ];
  for (const injection of injections) {
    for (const apply of targets) {
      const cloud = sampleCloud();
      apply(cloud, injection);
      expectError(
        () =>
          resolveCloudConfig({
            rootDir: makeProjectRoot({ cloud }),
            environment: "dev",
            repository: REPO,
          }),
        /cloud\.json/,
      );
    }
  }
  const cloud = sampleCloud();
  cloud.environments.dev.rootAdmin.account = "o'wner $(id) ;x";
  assert.equal(
    resolveCloudConfig({
      rootDir: makeProjectRoot({ cloud }),
      environment: "dev",
      repository: REPO,
    }).root_account,
    "o'wner $(id) ;x",
  );
});

test("apiUrl 必須是不帶路徑的 https origin(admin 的 endpoint 由它加 /graphql 組出)", () => {
  for (const apiUrl of [
    "http://api.widgets.example",
    "https://api.widgets.example/",
    "https://api.widgets.example/graphql",
    "https://api.widgets.example?x=1",
    "api.widgets.example",
  ]) {
    const cloud = sampleCloud();
    cloud.environments.dev.apiUrl = apiUrl;
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud }),
          environment: "dev",
          repository: REPO,
        }),
      /environments\.dev\.apiUrl/,
    );
  }
});

test("看板啟用:十個 option 鍵固定,缺鍵、多鍵、空值或缺 ID 都拒絕", () => {
  assert.equal(STATUS_OPTION_KEYS.length, 10);
  const resolved = resolveGithubConfig({
    rootDir: makeProjectRoot(),
    repository: REPO,
  });
  assert.deepEqual(Object.keys(resolved), [
    "enabled",
    "project_id",
    "status_field_id",
    "options",
  ]);
  assert.deepEqual(Object.keys(resolved.options), STATUS_OPTION_KEYS);

  const cases = [
    (github) => delete github.projectStatus.options.devPassed,
    (github) => (github.projectStatus.options.extra = "a00000ff"),
    (github) => (github.projectStatus.options.review = ""),
    (github) => (github.projectStatus.options.review = "has space"),
    (github) => delete github.projectStatus.options,
    (github) => delete github.projectStatus.projectId,
    (github) => (github.projectStatus.statusFieldId = ""),
    (github) => (github.projectStatus.enabled = "true"),
    (github) => delete github.projectStatus.enabled,
    (github) => delete github.projectStatus,
  ];
  for (const mutate of cases) {
    const github = sampleGithub();
    mutate(github);
    expectError(
      () =>
        resolveGithubConfig({
          rootDir: makeProjectRoot({ github }),
          repository: REPO,
        }),
      /github\.json.*projectStatus/,
    );
  }
});

test("看板停用:不要求 IDs / options,只輸出 enabled=false,但仍核對 repository", () => {
  const github = {
    schemaVersion: 1,
    expectedRepository: REPO,
    projectStatus: { enabled: false },
  };
  const root = makeProjectRoot({ github, cloud: null });
  assert.deepEqual(resolveGithubConfig({ rootDir: root, repository: REPO }), {
    enabled: false,
  });
  expectError(
    () => resolveGithubConfig({ rootDir: root, repository: "someone/fork" }),
    /repository/,
  );
  const leftovers = sampleGithub();
  leftovers.projectStatus.enabled = false;
  assert.deepEqual(
    resolveGithubConfig({
      rootDir: makeProjectRoot({ github: leftovers }),
      repository: REPO,
    }),
    { enabled: false },
  );
});

test("cloud 省略 enabled 或 enabled 為 true:三環境逐鍵輸出相同,輸出不多出 enabled", () => {
  const cases = [
    [sampleCloud, REPO, makeProjectRoot],
    [
      legacyCookhomeCloud,
      LEGACY_COOKHOME_REPOSITORY,
      ({ cloud }) => makeProjectRoot({ github: legacyCookhomeGithub(), cloud }),
    ],
  ];
  for (const [fixture, repository, makeRoot] of cases) {
    const omitted = makeRoot({ cloud: fixture() });
    const explicit = makeRoot({ cloud: { ...fixture(), enabled: true } });
    for (const environment of ENVIRONMENTS) {
      const expected = resolveCloudConfig({
        rootDir: omitted,
        environment,
        repository,
      });
      const resolved = resolveCloudConfig({
        rootDir: explicit,
        environment,
        repository,
      });
      assert.deepEqual(Object.keys(resolved), CLOUD_OUTPUT_KEYS, environment);
      assert.deepEqual(resolved, expected, environment);
    }
  }
});

test("cloud enabled 為 true 時仍整份嚴格驗證:缺欄位或未知欄位照樣拒絕", () => {
  const missing = { ...sampleCloud(), enabled: true };
  delete missing.environments.staging.secrets.jwtSecret;
  const noGcp = { ...sampleCloud(), enabled: true };
  delete noGcp.gcp;
  const unknownTop = { ...sampleCloud(), enabled: true, fallback: {} };
  for (const cloud of [
    missing,
    noGcp,
    unknownTop,
    { schemaVersion: 1, enabled: true },
  ]) {
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud }),
          environment: "dev",
          repository: REPO,
        }),
      /cloud\.json/,
    );
  }
});

test("cloud 停用:檔案只有 schemaVersion 與 enabled,三環境都只回 { enabled: false }", () => {
  const root = makeProjectRoot({ cloud: disabledCloud() });
  for (const environment of ENVIRONMENTS) {
    assert.deepEqual(
      resolveCloudConfig({ rootDir: root, environment, repository: REPO }),
      { enabled: false },
      environment,
    );
  }
});

test("cloud 停用:夾帶 gcp / environments / 未知鍵一律拒絕(不留舊專案的目標)", () => {
  const { gcp, environments } = sampleCloud();
  for (const extra of [
    { gcp },
    { environments },
    { gcp, environments },
    { gcp: {} },
    { environments: null },
    { fallback: {} },
    { Enabled: false },
  ]) {
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ cloud: { ...disabledCloud(), ...extra } }),
          environment: "dev",
          repository: REPO,
        }),
      /cloud\.json/,
    );
  }
});

test("cloud 的 enabled 不是 boolean(null、字串、數字、物件、陣列)即拒絕,完整檔與兩欄檔皆然", () => {
  for (const enabled of [null, "false", "true", "", 0, 1, {}, []]) {
    for (const base of [sampleCloud(), { schemaVersion: 1 }]) {
      expectError(
        () =>
          resolveCloudConfig({
            rootDir: makeProjectRoot({ cloud: { ...base, enabled } }),
            environment: "dev",
            repository: REPO,
          }),
        /cloud\.json.*enabled/,
      );
    }
  }
});

test("cloud 停用:未知或缺少的 schemaVersion 照樣拒絕", () => {
  for (const version of [undefined, 0, 2, "1"]) {
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({
            cloud: { schemaVersion: version, enabled: false },
          }),
          environment: "dev",
          repository: REPO,
        }),
      /cloud\.json.*schemaVersion/,
    );
  }
});

test("cloud 停用:仍先核對 environment 與 repository 身分,不以任意 repo context 繞過識別", () => {
  const root = makeProjectRoot({ cloud: disabledCloud() });
  for (const environment of [undefined, "", "prod", "DEV", "__proto__"]) {
    expectError(
      () =>
        resolveCloudConfig({ rootDir: root, environment, repository: REPO }),
      /environment/,
    );
  }
  for (const repository of [undefined, "", "widgets", "someone/fork"]) {
    expectError(
      () =>
        resolveCloudConfig({ rootDir: root, environment: "dev", repository }),
      /repository/,
    );
  }
  // github.json 不存在或壞掉時,停用的 cloud 也不放行
  for (const github of [null, "{ not json"]) {
    expectError(
      () =>
        resolveCloudConfig({
          rootDir: makeProjectRoot({ github, cloud: disabledCloud() }),
          environment: "dev",
          repository: REPO,
        }),
      /github\.json/,
    );
  }
});

test("cloud scope 只用 github.json 的身分欄位:看板停用或看板欄位不完整不影響部署解析", () => {
  const github = {
    schemaVersion: 1,
    expectedRepository: REPO,
    projectStatus: { enabled: false },
  };
  assert.equal(
    resolveCloudConfig({
      rootDir: makeProjectRoot({ github }),
      environment: "production",
      repository: REPO,
    }).api_service,
    "widgets-api",
  );
});
