import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  PRINT_AGENT_OFFLINE_AFTER_MS,
  PRINT_JOB_CLAIM_TIMEOUT_MS,
  PRINT_JOB_RESULT_TIMEOUT_MS,
  PRINT_PAIRING_CODE_TTL_MS,
} from "@repo/domain/printing";

import { startAuthTestApp } from "../auth/test-support/auth-app";
import { countDbCommands } from "../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { internalReader } from "./print-agent-credentials";
import { PrintJobsService } from "./print-jobs.service";
import { PrintingNotifier } from "./printing-notifier";
import {
  type AgentRow,
  DOCS,
  type JobRow,
  type PrinterRow,
  type World,
  addPrinter,
  agentHttp,
  backdate,
  expectFailedNotice,
  failedNoticesOf,
  gql,
  newRef,
  offlineNoticesOf,
  ok,
  pairedAgent,
  pngBase64,
  printInput,
  setupWorld,
  signalsSince,
  statusOf,
} from "./test-support/printing-fixtures";

/**
 * 代理程式端:
 * 配對碼換金鑰、認領(信號與輪詢競爭)、分店隔離、撤銷即時失效、離線與逾時。
 */
describe("列印代理程式 API", () => {
  let world: World;
  let agentA: { agent: AgentRow; key: string };
  let agentB: { agent: AgentRow; key: string };
  let printerA: PrinterRow;
  let printerB: PrinterRow;

  async function createJob(printerId: string): Promise<JobRow> {
    const data = await ok<{ createPrintJob: { job: JobRow } }>(
      world,
      world.admin,
      DOCS.createJob,
      { input: printInput(printerId, newRef()) },
    );
    return data.createPrintJob.job;
  }

  async function jobOf(id: string): Promise<JobRow> {
    const data = await ok<{ printJob: { job: JobRow } }>(
      world,
      world.admin,
      DOCS.job,
      { id },
    );
    return data.printJob.job;
  }

  async function agentRow(id: string): Promise<AgentRow> {
    const data = await ok<{ printAgents: { items: AgentRow[] } }>(
      world,
      world.admin,
      DOCS.agents,
      { input: {} },
    );
    const found = data.printAgents.items.find((agent) => agent.id === id);
    if (found === undefined) {
      throw new Error(`沒有代理程式 ${id}`);
    }
    return found;
  }

  /** 停用一個有 jobCount 張等待中工作的代理程式,回 print_jobs 的指令數。 */
  async function printJobCommandsOf(jobCount: number): Promise<number> {
    const agent = await pairedAgent(
      world,
      world.storeA,
      `批次停用 ${String(jobCount)}`,
    );
    const target = await addPrinter(world, agent.agent.id, {
      name: `批次停用印表機 ${String(jobCount)}`,
    });
    const jobs: JobRow[] = [];
    for (let index = 0; index < jobCount; index += 1) {
      jobs.push(await createJob(target.id));
    }
    const counted = await countDbCommands(() =>
      ok(world, world.admin, DOCS.disableAgent, {
        input: { id: agent.agent.id },
      }),
    );
    for (const job of jobs) {
      await expectFailedNotice(world, job.id, "代理程式已停用");
    }
    return [...counted.byCommand]
      .filter(([key]) => key.startsWith("print_jobs."))
      .reduce((sum, [, count]) => sum + count, 0);
  }

  beforeAll(async () => {
    const api = await startAuthTestApp("printing_agent");
    world = await setupWorld(api);
    agentA = await pairedAgent(world, world.storeA, "分店 A 收銀電腦");
    agentB = await pairedAgent(world, world.storeB, "分店 B 收銀電腦");
    printerA = await addPrinter(world, agentA.agent.id, { isDefault: true });
    printerB = await addPrinter(world, agentB.agent.id);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  describe("配對", () => {
    it("新增代理程式 → 8 碼配對碼(10 分鐘);資料庫只存雜湊", async () => {
      const created = await ok<{
        createPrintAgent: {
          agent: AgentRow;
          pairingCode: string;
          pairingExpiresAt: string;
        };
      }>(world, world.admin, DOCS.createAgent, {
        input: { orgId: String(world.storeA), name: "備用電腦" },
      });
      const { agent, pairingCode, pairingExpiresAt } = created.createPrintAgent;
      expect(pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      const ttl = new Date(pairingExpiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(PRINT_PAIRING_CODE_TTL_MS - 60_000);
      expect(ttl).toBeLessThanOrEqual(PRINT_PAIRING_CODE_TTL_MS);
      expect(agent.paired).toBe(false);
      const stored = await world.api.connection
        .collection("print_agents")
        .findOne({ name: "備用電腦" });
      expect(JSON.stringify(stored)).not.toContain(pairingCode);
    });

    it("配對碼換到長期金鑰(只回一次;資料庫只存雜湊)", async () => {
      const { agent, key } = await pairedAgent(world, world.storeA, "配對測試");
      expect(key).toMatch(/^pa_/);
      const stored = await world.api.connection
        .collection("print_agents")
        .findOne({ name: "配對測試" });
      expect(JSON.stringify(stored)).not.toContain(key);
      expect(await agentRow(agent.id)).toMatchObject({ paired: true });
    });

    it("配對碼用過 → 失敗(401)", async () => {
      const created = await ok<{
        createPrintAgent: { pairingCode: string };
      }>(world, world.admin, DOCS.createAgent, {
        input: { orgId: String(world.storeA), name: "用過的碼" },
      });
      const code = created.createPrintAgent.pairingCode;
      const first = await agentHttp(world, "post", "/print-agent/pair", null, {
        code,
      });
      expect(first.status).toBe(200);
      const again = await agentHttp(world, "post", "/print-agent/pair", null, {
        code,
      });
      expect(again.status).toBe(401);
    });

    it("配對碼過期 → 失敗(401)", async () => {
      const created = await ok<{
        createPrintAgent: { agent: AgentRow; pairingCode: string };
      }>(world, world.admin, DOCS.createAgent, {
        input: { orgId: String(world.storeA), name: "過期的碼" },
      });
      await backdate(
        world,
        "print_agents",
        created.createPrintAgent.agent.id,
        "pairingExpiresAt",
        1000,
      );
      const response = await agentHttp(
        world,
        "post",
        "/print-agent/pair",
        null,
        { code: created.createPrintAgent.pairingCode },
      );
      expect(response.status).toBe(401);
    });

    it("亂猜的配對碼 → 401;沒帶金鑰 / 金鑰不對 → 401", async () => {
      const guess = await agentHttp(world, "post", "/print-agent/pair", null, {
        code: "ABCDEFGH",
      });
      expect(guess.status).toBe(401);
      expect(
        await statusOf(agentHttp(world, "get", "/print-agent/jobs", null)),
      ).toBe(401);
      expect(
        await statusOf(agentHttp(world, "get", "/print-agent/jobs", "pa_nope")),
      ).toBe(401);
    });
  });

  describe("認領", () => {
    it("建立工作 → 交易後送 print-job 給 print-agent:<代理程式>;拿工作列得到", async () => {
      const from = world.sent.length;
      const job = await createJob(printerA.id);
      expect(job.status).toBe("PENDING");
      expect(signalsSince(world, from, "print-job")).toEqual([
        { topics: [`print-agent:${agentA.agent.id}`], id: job.id },
      ]);
      const pending = await agentHttp(
        world,
        "get",
        "/print-agent/jobs",
        agentA.key,
      );
      expect(pending.status).toBe(200);
      const body = pending.body as {
        jobs: { id: string }[];
        printers: { id: string; host: string; port: number }[];
      };
      expect(body.jobs.map((entry) => entry.id)).toContain(job.id);
      expect(body.printers).toEqual([
        expect.objectContaining({
          id: printerA.id,
          host: "receipt-a.lan",
          port: 9100,
        }),
      ]);
    });

    it("信號與輪詢同時到達 → 只有一方認領成功", async () => {
      const job = await createJob(printerA.id);
      const path = `/print-agent/jobs/${job.id}/claim`;
      const responses = await Promise.all([
        agentHttp(world, "post", path, agentA.key),
        agentHttp(world, "post", path, agentA.key),
        agentHttp(world, "post", path, agentA.key),
      ]);
      const statuses = responses
        .map((response) => response.status)
        .toSorted((a, b) => a - b);
      expect(statuses).toEqual([200, 409, 409]);
      expect(await jobOf(job.id)).toMatchObject({ status: "SENT" });
    });

    it("認領後拿圖片(PNG)→ 回報已印 → 送 print-result 給要求人", async () => {
      const job = await createJob(printerA.id);
      const claim = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        agentA.key,
      );
      expect(claim.status).toBe(200);
      const image = await agentHttp(
        world,
        "get",
        `/print-agent/jobs/${job.id}/image`,
        agentA.key,
      );
      expect(image.status).toBe(200);
      expect(image.headers["content-type"]).toContain("image/png");
      const from = world.sent.length;
      const result = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/result`,
        agentA.key,
        { status: "printed" },
      );
      expect(result.status).toBe(204);
      expect(signalsSince(world, from, "print-result")).toEqual([
        { topics: [`user:${String(world.admin.userId)}`], id: job.id },
      ]);
      const done = await jobOf(job.id);
      expect(done.status).toBe("PRINTED");
      expect(done.printedAt).not.toBeNull();
    });

    it("回報失敗(缺紙)→ 失敗原因 PAPER_OUT;已有結果的工作不能再回報(409)", async () => {
      const job = await createJob(printerA.id);
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        agentA.key,
      );
      const failed = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/result`,
        agentA.key,
        { status: "failed", error: "paper-out" },
      );
      expect(failed.status).toBe(204);
      expect(await jobOf(job.id)).toMatchObject({
        status: "FAILED",
        error: "PAPER_OUT",
      });
      const again = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/result`,
        agentA.key,
        { status: "printed" },
      );
      expect(again.status).toBe(409);
    });
  });

  describe("分店隔離", () => {
    it("金鑰無法領別分店的工作:列不到、認領不到、拿不到圖", async () => {
      const job = await createJob(printerA.id);
      const pending = await agentHttp(
        world,
        "get",
        "/print-agent/jobs",
        agentB.key,
      );
      const body = pending.body as { jobs: { id: string }[] };
      expect(body.jobs.map((entry) => entry.id)).not.toContain(job.id);
      const claim = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        agentB.key,
      );
      expect(claim.status).toBe(409);
      const image = await agentHttp(
        world,
        "get",
        `/print-agent/jobs/${job.id}/image`,
        agentB.key,
      );
      expect(image.status).toBe(404);
      expect(await jobOf(job.id)).toMatchObject({ status: "PENDING" });
    });

    it("心跳只更新自己名下的印表機狀態與版本", async () => {
      const response = await agentHttp(
        world,
        "post",
        "/print-agent/heartbeat",
        agentB.key,
        {
          version: "1.1.0",
          printers: [
            { id: printerA.id, status: "paper-out" },
            { id: printerB.id, status: "paper-out" },
          ],
        },
      );
      expect(response.status).toBe(204);
      const data = await ok<{ printers: { items: PrinterRow[] } }>(
        world,
        world.admin,
        DOCS.printers,
        { input: {} },
      );
      const statusOf = (id: string) =>
        data.printers.items.find((printer) => printer.id === id)?.status;
      expect(statusOf(printerA.id)).toBeNull();
      expect(statusOf(printerB.id)).toBe("PAPER_OUT");
      expect(await agentRow(agentB.agent.id)).toMatchObject({
        version: "1.1.0",
      });
    });
  });

  describe("離線、逾時、重新配對與停用(每列一個測試)", () => {
    it("代理程式 2 分鐘內輪詢過 → 已連線(lastSeenAt 每次輪詢更新)", async () => {
      await backdate(
        world,
        "print_agents",
        agentA.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 60_000,
      );
      expect(await agentRow(agentA.agent.id)).toMatchObject({ online: false });
      await agentHttp(world, "get", "/print-agent/jobs", agentA.key);
      expect(await agentRow(agentA.agent.id)).toMatchObject({ online: true });
    });

    it("lastSeenAt 超過 2 分鐘 → 離線", async () => {
      await backdate(
        world,
        "print_agents",
        agentA.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 1000,
      );
      expect(await agentRow(agentA.agent.id)).toMatchObject({ online: false });
      await agentHttp(world, "post", "/print-agent/heartbeat", agentA.key, {
        version: "1.0.0",
      });
      expect(await agentRow(agentA.agent.id)).toMatchObject({ online: true });
    });

    it("送出列印時代理程式已離線 → 仍建立工作,立即標失敗「代理程式離線」,不送 print-job", async () => {
      await backdate(
        world,
        "print_agents",
        agentA.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 1000,
      );
      const from = world.sent.length;
      const job = await createJob(printerA.id);
      expect(job).toMatchObject({ status: "FAILED", error: "AGENT_OFFLINE" });
      expect(signalsSince(world, from, "print-job")).toEqual([]);
      await agentHttp(world, "get", "/print-agent/jobs", agentA.key);
    });

    it("工作「等待中」超過 2 分鐘沒有被認領 → 標失敗「代理程式離線」,送 print-result", async () => {
      const job = await createJob(printerA.id);
      await backdate(
        world,
        "print_jobs",
        job.id,
        "createdAt",
        PRINT_JOB_CLAIM_TIMEOUT_MS + 1000,
      );
      const from = world.sent.length;
      const expired = await world.api.app
        .get(PrintJobsService)
        .expireStale(internalReader(), {}, new Date());
      expect(expired).toBeGreaterThanOrEqual(1);
      expect(await jobOf(job.id)).toMatchObject({
        status: "FAILED",
        error: "AGENT_OFFLINE",
      });
      expect(signalsSince(world, from, "print-result")).toContainEqual({
        topics: [`user:${String(world.admin.userId)}`],
        id: job.id,
      });
    });

    it("查單筆時順手判斷逾時(不必等排程)", async () => {
      const job = await createJob(printerA.id);
      await backdate(
        world,
        "print_jobs",
        job.id,
        "createdAt",
        PRINT_JOB_CLAIM_TIMEOUT_MS + 1000,
      );
      expect(await jobOf(job.id)).toMatchObject({
        status: "FAILED",
        error: "AGENT_OFFLINE",
      });
    });

    it("代理程式啟動時拉到超過 2 分鐘的舊工作 → 不印(清單沒有、認領 409、已標失敗)", async () => {
      const job = await createJob(printerA.id);
      await backdate(
        world,
        "print_jobs",
        job.id,
        "createdAt",
        PRINT_JOB_CLAIM_TIMEOUT_MS + 1000,
      );
      const pending = await agentHttp(
        world,
        "get",
        "/print-agent/jobs",
        agentA.key,
      );
      const body = pending.body as { jobs: { id: string }[] };
      expect(body.jobs.map((entry) => entry.id)).not.toContain(job.id);
      const claim = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        agentA.key,
      );
      expect(claim.status).toBe(409);
      expect(await jobOf(job.id)).toMatchObject({ status: "FAILED" });
    });

    it("[重新配對] → 舊金鑰立即失效,產生新配對碼(10 分鐘);印表機設定保留", async () => {
      const own = await pairedAgent(world, world.storeA, "重新配對測試");
      const printer = await addPrinter(world, own.agent.id, {
        name: "重新配對的印表機",
        host: "receipt-77.lan",
      });
      const reset = await ok<{
        resetPrintAgentPairing: {
          agent: AgentRow;
          pairingCode: string;
          pairingExpiresAt: string;
        };
      }>(world, world.admin, DOCS.resetPairing, {
        input: { id: own.agent.id },
      });
      expect(reset.resetPrintAgentPairing.agent.paired).toBe(false);
      expect(reset.resetPrintAgentPairing.pairingCode).toMatch(/^\w{8}$/);
      const old = await agentHttp(world, "get", "/print-agent/jobs", own.key);
      expect(old.status).toBe(401);
      const paired = await agentHttp(world, "post", "/print-agent/pair", null, {
        code: reset.resetPrintAgentPairing.pairingCode,
      });
      expect(paired.status).toBe(200);
      const fresh = await agentHttp(
        world,
        "get",
        "/print-agent/jobs",
        (paired.body as { key: string }).key,
      );
      expect(fresh.status).toBe(200);
      expect(
        (fresh.body as { printers: { id: string; host: string }[] }).printers,
      ).toEqual([
        expect.objectContaining({ id: printer.id, host: "receipt-77.lan" }),
      ]);
    });

    it("[停用] → 金鑰失效、旗下印表機在列印按鈕上不可選、等待中的工作標失敗", async () => {
      const own = await pairedAgent(world, world.storeB, "停用測試");
      const printer = await addPrinter(world, own.agent.id, {
        name: "停用的印表機",
      });
      const job = await createJob(printer.id);
      expect(job.status).toBe("PENDING");
      const from = world.sent.length;
      const disabled = await ok<{ disablePrintAgent: { agent: AgentRow } }>(
        world,
        world.admin,
        DOCS.disableAgent,
        { input: { id: own.agent.id } },
      );
      expect(disabled.disablePrintAgent.agent).toMatchObject({
        enabled: false,
        paired: false,
        online: false,
      });
      expect(
        await statusOf(agentHttp(world, "get", "/print-agent/jobs", own.key)),
      ).toBe(401);
      expect(await jobOf(job.id)).toMatchObject({
        status: "FAILED",
        error: "AGENT_DISABLED",
      });
      expect(signalsSince(world, from, "print-result")).toContainEqual({
        topics: [`user:${String(world.admin.userId)}`],
        id: job.id,
      });
      const printable = await ok<{
        printablePrinters: { items: PrinterRow[] };
      }>(world, world.admin, DOCS.printable, { orgId: String(world.storeB) });
      expect(
        printable.printablePrinters.items.map((entry) => entry.id),
      ).not.toContain(printer.id);
      const rejected = await gql(world, world.admin, DOCS.createJob, {
        input: printInput(printer.id, newRef()),
      });
      expect(rejected.error?.code).toBe("VALIDATION_FAILED");
      expect(rejected.error?.extensions?.fieldErrors).toEqual([
        expect.objectContaining({
          fieldKey: "printerId",
          code: "PRINTER_UNAVAILABLE",
        }),
      ]);
      const reset = await gql(world, world.admin, DOCS.resetPairing, {
        input: { id: own.agent.id },
      });
      expect(reset.error).toMatchObject({
        code: "CONFLICT",
        extensions: { reason: "AGENT_DISABLED" },
      });
    });
  });

  it("換訂閱憑證:即時通道停用(測試環境)時回三個 null,代理程式改 60 秒輪詢", async () => {
    const response = await agentHttp(
      world,
      "post",
      "/print-agent/realtime-ticket",
      agentA.key,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ticket: null,
      connectUrl: null,
      expiresAt: null,
    });
  });

  describe("列印通知(printing.job-failed / printing.agent-offline)", () => {
    let own: { agent: AgentRow; key: string };
    let printer: PrinterRow;

    beforeAll(async () => {
      own = await pairedAgent(world, world.storeA, "通知測試");
      printer = await addPrinter(world, own.agent.id, { name: "通知印表機" });
    });

    it("代理程式回報失敗 → 通知要求人(原因:缺紙);已印不通知", async () => {
      const failed = await createJob(printer.id);
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${failed.id}/claim`,
        own.key,
      );
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${failed.id}/result`,
        own.key,
        {
          status: "failed",
          error: "paper-out",
        },
      );
      await expectFailedNotice(world, failed.id, "缺紙");

      const printed = await createJob(printer.id);
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${printed.id}/claim`,
        own.key,
      );
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${printed.id}/result`,
        own.key,
        {
          status: "printed",
        },
      );
      expect(await failedNoticesOf(world, printed.id)).toHaveLength(0);
    });

    it("等待中逾時 → 通知要求人(原因:代理程式離線);重掃不重複通知", async () => {
      const job = await createJob(printer.id);
      await backdate(
        world,
        "print_jobs",
        job.id,
        "createdAt",
        PRINT_JOB_CLAIM_TIMEOUT_MS + 1000,
      );
      const service = world.api.app.get(PrintJobsService);
      await service.expireStale(internalReader(), {}, new Date());
      await service.expireStale(internalReader(), {}, new Date());
      await expectFailedNotice(world, job.id, "代理程式離線");
    });

    it("送出時代理程式已離線 → 工作失敗並通知要求人", async () => {
      await backdate(
        world,
        "print_agents",
        own.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 1000,
      );
      const job = await createJob(printer.id);
      expect(job.status).toBe("FAILED");
      await expectFailedNotice(world, job.id, "代理程式離線");
      await agentHttp(world, "get", "/print-agent/jobs", own.key);
    });

    it("代理程式離線 → 提醒持有 system.printers.edit 的人;同一次離線只通知一次,重新上線後再離線是新的一次", async () => {
      const agent = await pairedAgent(world, world.storeB, "離線提醒");
      const notifier = world.api.app.get(PrintingNotifier);
      await notifier.sweepOfflineAgents(new Date());
      expect(await offlineNoticesOf(world, agent.agent.id)).toHaveLength(0);

      await backdate(
        world,
        "print_agents",
        agent.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 1000,
      );
      await notifier.sweepOfflineAgents(new Date());
      await notifier.sweepOfflineAgents(new Date());
      const first = await offlineNoticesOf(world, agent.agent.id);
      const recipients = first.map((row) => String(row.recipientId));
      expect(recipients).toContain(String(world.admin.userId));
      expect(recipients).toContain(String(world.managerNoPrint.userId));
      expect(recipients).not.toContain(String(world.viewer.userId));
      expect(new Set(recipients).size).toBe(recipients.length);

      // 重新上線(輪詢)→ 再離線 → 新的一次
      await agentHttp(world, "get", "/print-agent/jobs", agent.key);
      await backdate(
        world,
        "print_agents",
        agent.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 5000,
      );
      await notifier.sweepOfflineAgents(new Date());
      const second = await offlineNoticesOf(world, agent.agent.id);
      expect(second).toHaveLength(first.length * 2);
    });

    it("已送出超過 2 分鐘沒回報 → 標失敗「未收到列印結果」(NO_RESULT),送 print-result 並通知;之後的回報 409", async () => {
      const job = await createJob(printer.id);
      const claim = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        own.key,
      );
      expect(claim.status).toBe(200);
      await backdate(
        world,
        "print_jobs",
        job.id,
        "sentAt",
        PRINT_JOB_RESULT_TIMEOUT_MS + 1000,
      );
      const from = world.sent.length;
      expect(await jobOf(job.id)).toMatchObject({
        status: "FAILED",
        error: "NO_RESULT",
      });
      expect(signalsSince(world, from, "print-result")).toContainEqual({
        topics: [`user:${String(world.admin.userId)}`],
        id: job.id,
      });
      await expectFailedNotice(world, job.id, "未收到列印結果");
      const late = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/result`,
        own.key,
        {
          status: "printed",
        },
      );
      expect(late.status).toBe(409);
    });

    it("排程補掃也處理已送出逾時;還在 2 分鐘內的已送出不動", async () => {
      const stale = await createJob(printer.id);
      const fresh = await createJob(printer.id);
      for (const job of [stale, fresh]) {
        await agentHttp(
          world,
          "post",
          `/print-agent/jobs/${job.id}/claim`,
          own.key,
        );
      }
      await backdate(
        world,
        "print_jobs",
        stale.id,
        "sentAt",
        PRINT_JOB_RESULT_TIMEOUT_MS + 1000,
      );
      await world.api.app
        .get(PrintJobsService)
        .expireStale(internalReader(), {}, new Date());
      const rows = await world.api.connection
        .collection("print_jobs")
        .find({
          _id: { $in: [stale, fresh].map((job) => new Types.ObjectId(job.id)) },
        })
        .toArray();
      const rowOf = (id: string) => rows.find((row) => String(row._id) === id);
      expect(rowOf(stale.id)).toMatchObject({
        status: "failed",
        error: "no-result",
      });
      expect(rowOf(fresh.id)).toMatchObject({ status: "sent", error: null });
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${fresh.id}/result`,
        own.key,
        {
          status: "printed",
        },
      );
    });

    it("已送出超過 2 分鐘才回報(之前沒人讀過)→ 409,工作先標 no-result 並通知", async () => {
      const job = await createJob(printer.id);
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/claim`,
        own.key,
      );
      await backdate(
        world,
        "print_jobs",
        job.id,
        "sentAt",
        PRINT_JOB_RESULT_TIMEOUT_MS + 1000,
      );
      const late = await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${job.id}/result`,
        own.key,
        {
          status: "printed",
        },
      );
      expect(late.status).toBe(409);
      const row = await world.api.connection
        .collection("print_jobs")
        .findOne({ _id: new Types.ObjectId(job.id) });
      expect(row).toMatchObject({ status: "failed", error: "no-result" });
      await expectFailedNotice(world, job.id, "未收到列印結果");
    });

    it("測試頁失敗 → 通知顯示「測試頁 <印表機名稱>」,不出現 ObjectId", async () => {
      await backdate(
        world,
        "print_agents",
        own.agent.id,
        "lastSeenAt",
        PRINT_AGENT_OFFLINE_AFTER_MS + 1000,
      );
      const data = await ok<{ printPrinterTestPage: { job: JobRow } }>(
        world,
        world.admin,
        DOCS.testPage,
        { input: { printerId: printer.id, image: pngBase64() } },
      );
      expect(data.printPrinterTestPage.job.status).toBe("FAILED");
      const [notice] = await failedNoticesOf(
        world,
        data.printPrinterTestPage.job.id,
      );
      expect(notice?.title).toBe("列印失敗:測試頁 通知印表機");
      expect(notice?.body).not.toContain(printer.id);
      await agentHttp(world, "get", "/print-agent/jobs", own.key);
    });

    it("排程補掃:逾時工作那段失敗,離線代理程式那段照跑;單筆失敗不擋後面的", async () => {
      const service = world.api.app.get(PrintJobsService);
      const notifier = world.api.app.get(PrintingNotifier);
      const expire = jest
        .spyOn(service, "expireStale")
        .mockRejectedValueOnce(new Error("mongo down"));
      const sweep = jest.spyOn(notifier, "sweepOfflineAgents");
      try {
        await expect(
          service.runScheduledSweep(new Date()),
        ).resolves.toBeUndefined();
        expect(sweep).toHaveBeenCalledTimes(1);
      } finally {
        expire.mockRestore();
        sweep.mockRestore();
      }

      const first = await createJob(printer.id);
      const second = await createJob(printer.id);
      for (const job of [first, second]) {
        await backdate(
          world,
          "print_jobs",
          job.id,
          "createdAt",
          PRINT_JOB_CLAIM_TIMEOUT_MS + 1000,
        );
      }
      const jobFailed = jest
        .spyOn(notifier, "jobFailed")
        .mockRejectedValueOnce(new Error("notify down"));
      try {
        const expired = await service.expireStale(
          internalReader(),
          {},
          new Date(),
        );
        expect(expired).toBeGreaterThanOrEqual(1);
      } finally {
        jobFailed.mockRestore();
      }
      const rows = await world.api.connection
        .collection("print_jobs")
        .find({
          _id: {
            $in: [first, second].map((job) => new Types.ObjectId(job.id)),
          },
        })
        .toArray();
      // 出錯那筆整個交易回復(仍是等待中,下一輪再處理),另一筆照常標失敗
      expect(
        rows
          .map((row) => String(row.status))
          .toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
      ).toEqual(["failed", "pending"]);
      await service.expireStale(internalReader(), {}, new Date());
    });

    it("停用代理程式 → 等待中與已送出(還沒回報)的工作都直接標失敗「代理程式已停用」並通知要求人", async () => {
      const sentJob = await createJob(printer.id);
      await agentHttp(
        world,
        "post",
        `/print-agent/jobs/${sentJob.id}/claim`,
        own.key,
      );
      const pendingJob = await createJob(printer.id);
      await ok(world, world.admin, DOCS.disableAgent, {
        input: { id: own.agent.id },
      });
      await expectFailedNotice(world, sentJob.id, "代理程式已停用");
      await expectFailedNotice(world, pendingJob.id, "代理程式已停用");
      expect(await jobOf(sentJob.id)).toMatchObject({
        status: "FAILED",
        error: "AGENT_DISABLED",
      });
    });

    it("停用代理程式:工作標失敗是一次條件更新 + 一次讀回,print_jobs 的指令數不隨工作數成長(TX-06)", async () => {
      const one = await printJobCommandsOf(1);
      expect(await printJobCommandsOf(4)).toBe(one);
    });
  });

  it("代理程式清單預設只列啟用中的;includeDisabled: true 連停用的一起列(紀錄不刪)", async () => {
    const gone = await pairedAgent(world, world.storeA, "清單停用測試");
    await ok(world, world.admin, DOCS.disableAgent, {
      input: { id: gone.agent.id },
    });
    const listed = await Promise.all(
      [{}, { includeDisabled: false }, { includeDisabled: true }].map((input) =>
        ok<{ printAgents: { items: AgentRow[] } }>(
          world,
          world.admin,
          DOCS.agents,
          {
            input: { ...input, pageSize: 100 },
          },
        ),
      ),
    );
    const [byDefault, explicitFalse, withDisabled] = listed.map((data) =>
      data.printAgents.items.map((agent) => agent.id),
    );
    expect(byDefault).not.toContain(gone.agent.id);
    expect(byDefault).toContain(agentA.agent.id);
    expect(explicitFalse).not.toContain(gone.agent.id);
    expect(withDisabled).toContain(gone.agent.id);
  });
});
