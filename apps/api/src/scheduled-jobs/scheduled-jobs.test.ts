import { generateKeyPairSync } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { sign } from "jsonwebtoken";
import type { Types } from "mongoose";
import request from "supertest";

import {
  type AuthTestApp,
  TEST_JWT_SECRET,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, findRootOrgId } from "../auth/test-support/fixtures";
import {
  type ScheduledJobOutcome,
  ScheduledJobRunner,
} from "./scheduled-job-runner.service";
import { SCHEDULED_JOBS_RUN_PATH } from "./scheduled-jobs.controller";
import {
  GOOGLE_OIDC_CERTS_URL,
  SchedulerIdentityVerifier,
} from "./scheduler-identity";
import {
  PROBE_JOB_KEYS,
  ScheduledJobProbe,
  ScheduledJobProbeModule,
} from "./test-support/scheduled-job-probe";

const INVOKER_EMAIL = "scheduler@test-project.iam.gserviceaccount.com";
const AUDIENCE = "https://api.example.test";
const KID = "test-kid";

const googleKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = (key: typeof googleKey): string =>
  key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

interface TokenOptions {
  email?: string;
  emailVerified?: boolean;
  audience?: string;
  issuer?: string;
  key?: typeof googleKey;
  expiresIn?: number;
}

/** 模擬 Cloud Scheduler 帶的 Google OIDC ID token(測試自備的 RSA 金鑰扮演 Google)。 */
function oidcToken(options: TokenOptions = {}): string {
  return sign(
    {
      email: options.email ?? INVOKER_EMAIL,
      email_verified: options.emailVerified ?? true,
    },
    privatePem(options.key ?? googleKey),
    {
      algorithm: "RS256",
      keyid: KID,
      audience: options.audience ?? AUDIENCE,
      issuer: options.issuer ?? "https://accounts.google.com",
      expiresIn: options.expiresIn ?? 300,
    },
  );
}

const realFetch = globalThis.fetch;

/** 在網路層攔 Google 公鑰端點(其他請求照常),回測試金鑰。 */
function mockGoogleCerts(): void {
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init): Promise<Response> => {
      if (input !== GOOGLE_OIDC_CERTS_URL) {
        return realFetch(input, init);
      }
      const certs = {
        [KID]: googleKey.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      };
      return Promise.resolve(
        Response.json(certs, {
          headers: { "cache-control": "public, max-age=3600" },
        }),
      );
    });
}

/** 某工作在一次呼叫結果裡的狀態。 */
function statusOf(
  outcomes: readonly ScheduledJobOutcome[],
  key: string,
): ScheduledJobOutcome["status"] | undefined {
  return outcomes.find((outcome) => outcome.key === key)?.status;
}

describe("排程任務(Cloud Scheduler 內部端點)", () => {
  let api: AuthTestApp;

  const callEndpoint = (token?: string) => {
    const server = api.app.getHttpServer() as Parameters<typeof request>[0];
    const call = request(server).post(SCHEDULED_JOBS_RUN_PATH);
    return token === undefined
      ? call
      : call.set("Authorization", `Bearer ${token}`);
  };
  const statusFor = async (token?: string): Promise<number> => {
    const response = await callEndpoint(token);
    return response.status;
  };
  const runAt = (iso: string) =>
    api.app.get(ScheduledJobRunner).runDueJobs(new Date(iso));
  const probe = () => api.app.get(ScheduledJobProbe);
  const runsAt = (key: string, scheduledFor: string) =>
    api.connection
      .collection("scheduled_job_runs")
      .find({ key, scheduledFor: new Date(scheduledFor) })
      .toArray();
  const callsSince = (key: string, before: number) =>
    probe().callsOf(key).slice(before);

  beforeAll(async () => {
    mockGoogleCerts();
    api = await startAuthTestApp(
      "scheduled_jobs_test",
      { SCHEDULER_INVOKER_EMAIL: INVOKER_EMAIL, SCHEDULER_AUDIENCE: AUDIENCE },
      [ScheduledJobProbeModule],
    );
  }, 300_000);

  afterAll(async () => {
    await api.close();
    jest.restoreAllMocks();
  });

  describe("呼叫身分:只接受 Scheduler 的 service account", () => {
    it("沒帶 token → 401", async () => {
      const response = await callEndpoint();
      expect(response.status).toBe(401);
    });

    it("後台使用者的 access token(HS256)→ 401", async () => {
      const adminToken = sign(
        { sub: "someone", aud: "admin" },
        TEST_JWT_SECRET,
      );
      expect(await statusFor(adminToken)).toBe(401);
    });

    it("簽章不是 Google 的、audience 不對、issuer 不對、已過期 → 401", async () => {
      for (const token of [
        oidcToken({ key: strangerKey }),
        oidcToken({ audience: "https://other.example.test" }),
        oidcToken({ issuer: "https://evil.example.test" }),
        oidcToken({ expiresIn: -60 }),
      ]) {
        expect(await statusFor(token)).toBe(401);
      }
    });

    it("Google 簽的有效 token 但不是 Scheduler 的 service account(或 email 未驗證)→ 403", async () => {
      const other = oidcToken({
        email: "someone-else@test-project.iam.gserviceaccount.com",
      });
      expect(await statusFor(other)).toBe(403);
      const unverified = oidcToken({ emailVerified: false });
      expect(await statusFor(unverified)).toBe(403);
    });

    it("呼叫身分未設定(本地、未啟用排程的環境)→ 一律 403", async () => {
      const verifier = new SchedulerIdentityVerifier({
        invokerEmail: undefined,
        audience: undefined,
      });
      expect(await verifier.verify(oidcToken())).toBe("forbidden");
    });

    it("Scheduler 的 token → 200,依登記執行到期工作", async () => {
      const response = await callEndpoint(oidcToken());
      expect(response.status).toBe(200);
      const body = response.body as {
        outcomes: { key: string; status: string }[];
      };
      expect(body.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: PROBE_JOB_KEYS.every15m,
            status: "succeeded",
          }),
          expect.objectContaining({
            key: PROBE_JOB_KEYS.failing,
            status: "failed",
          }),
        ]),
      );
    });
  });

  describe("冪等:同一 (key, scheduledFor) 只執行一次", () => {
    it("同一區間內重複呼叫(含同時呼叫)只跑一次,其餘回 skipped", async () => {
      const before = probe().callsOf(PROBE_JOB_KEYS.every15m).length;
      const first = await runAt("2030-01-01T10:16:00.000Z");
      const concurrent = await Promise.all([
        runAt("2030-01-01T10:20:00.000Z"),
        runAt("2030-01-01T10:29:59.000Z"),
        runAt("2030-01-01T10:15:00.000Z"),
      ]);

      const calls = callsSince(PROBE_JOB_KEYS.every15m, before);
      expect(calls.map((call) => call.scheduledFor)).toEqual([
        "2030-01-01T10:15:00.000Z",
      ]);
      expect(statusOf(first, PROBE_JOB_KEYS.every15m)).toBe("succeeded");
      expect(
        concurrent.map((outcomes) =>
          statusOf(outcomes, PROBE_JOB_KEYS.every15m),
        ),
      ).toEqual(["skipped", "skipped", "skipped"]);

      const runs = await runsAt(
        PROBE_JOB_KEYS.every15m,
        "2030-01-01T10:15:00.000Z",
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "succeeded", error: null });
      expect(runs[0]?.finishedAt).toBeInstanceOf(Date);
    });

    it("同時收到三次呼叫(新的時點)只有一次取得執行權", async () => {
      const before = probe().callsOf(PROBE_JOB_KEYS.every15m).length;
      const outcomes = await Promise.all([
        runAt("2030-01-01T10:46:00.000Z"),
        runAt("2030-01-01T10:47:00.000Z"),
        runAt("2030-01-01T10:48:00.000Z"),
      ]);
      const statuses = outcomes.map((list) =>
        statusOf(list, PROBE_JOB_KEYS.every15m),
      );
      expect(statuses.filter((status) => status === "succeeded")).toHaveLength(
        1,
      );
      expect(statuses.filter((status) => status === "skipped")).toHaveLength(2);
      expect(
        callsSince(PROBE_JOB_KEYS.every15m, before).map(
          (call) => call.scheduledFor,
        ),
      ).toEqual(["2030-01-01T10:45:00.000Z"]);
    });

    it("下一個區間是新的時點,會再跑一次", async () => {
      await runAt("2030-01-01T10:30:00.000Z");
      const slots = probe()
        .callsOf(PROBE_JOB_KEYS.every15m)
        .map((call) => call.scheduledFor);
      expect(slots).toContain("2030-01-01T10:30:00.000Z");
    });

    it("失敗的工作記 failed 與錯誤訊息,同一時點不重跑", async () => {
      await runAt("2030-01-01T11:05:00.000Z");
      const again = await runAt("2030-01-01T11:50:00.000Z");
      expect(statusOf(again, PROBE_JOB_KEYS.failing)).toBe("skipped");
      const runs = await runsAt(
        PROBE_JOB_KEYS.failing,
        "2030-01-01T11:00:00.000Z",
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: "failed",
        error: "probe failure",
      });
    });
  });

  describe("daily@08:00 依各租戶時區", () => {
    let rootId: Types.ObjectId;
    let taipeiId: Types.ObjectId;
    let newYorkId: Types.ObjectId;

    beforeAll(async () => {
      rootId = await findRootOrgId(api.connection);
      // 根組織固定台北,讓斷言不受種子設定影響
      await api.connection
        .collection("orgs")
        .updateOne(
          { _id: rootId },
          { $set: { "settings.timezone": "Asia/Taipei" } },
        );
      taipeiId = await createOrg(api.connection, {
        name: "台北租戶",
        settings: { timezone: "Asia/Taipei" },
      });
      newYorkId = await createOrg(api.connection, {
        name: "紐約租戶",
        settings: { timezone: "America/New_York" },
      });
    });

    it("兩個時區的租戶各在自己的當地 08:00 到期", async () => {
      const before = probe().callsOf(PROBE_JOB_KEYS.daily0800).length;

      // 台北 07:50 / 紐約前一天 18:50:都還沒到
      await runAt("2030-02-28T23:50:00.000Z");
      expect(callsSince(PROBE_JOB_KEYS.daily0800, before)).toEqual([]);

      // 台北 08:05 → 台北租戶與根組織到期;紐約前一天 19:05,不到期
      await runAt("2030-03-01T00:05:00.000Z");
      // 台北 21:05 / 紐約 08:05(EST)→ 只有紐約租戶到期
      await runAt("2030-03-01T13:05:00.000Z");
      // 同一天稍後再呼叫:兩邊都已跑過
      await runAt("2030-03-01T13:20:00.000Z");

      const calls = callsSince(PROBE_JOB_KEYS.daily0800, before);
      expect(calls.map((call) => call.scheduledFor)).toEqual([
        "2030-03-01T00:00:00.000Z",
        "2030-03-01T13:00:00.000Z",
      ]);
      expect(calls[0]?.tenantIds).toEqual(
        expect.arrayContaining([null, String(taipeiId)]),
      );
      expect(calls[0]?.tenantIds).not.toContain(String(newYorkId));
      expect(calls[1]?.tenantIds).toEqual([String(newYorkId)]);
    });

    it("停用的租戶不在名單內", async () => {
      await api.connection
        .collection("orgs")
        .updateOne({ _id: newYorkId }, { $set: { enabled: false } });
      const before = probe().callsOf(PROBE_JOB_KEYS.daily0800).length;
      await runAt("2030-03-02T13:05:00.000Z");
      expect(callsSince(PROBE_JOB_KEYS.daily0800, before)).toEqual([]);
    });
  });
});
