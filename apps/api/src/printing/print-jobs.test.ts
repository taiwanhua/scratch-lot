import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { PRINT_AGENT_MANIFEST_PATH } from "@repo/domain/printing";

import { startAuthTestApp } from "../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { RecordingStorageService } from "../storage/recording-storage.service";
import { StorageService } from "../storage/storage.service";
import { PrintAgentReleaseService } from "./print-agent-release.service";
import {
  type AgentRow,
  DOCS,
  type GqlOutcome,
  type JobRow,
  type Person,
  type PrinterRow,
  type World,
  addPrinter,
  agentHttp,
  gql,
  newRef,
  ok,
  pairedAgent,
  pngBase64,
  printInput,
  setupWorld,
} from "./test-support/printing-fixtures";

const SHA = "b".repeat(64);

/**
 * 後台端(底座規格第 6 章「列印按鈕元件」「權限」「下載與安裝」):建立工作的權限、補印的驗證、
 * 印表機管理的權限守門、預設印表機、安裝檔下載。
 */
describe("列印 API(後台)", () => {
  let world: World;
  let agent: { agent: AgentRow; key: string };
  let printer: PrinterRow;

  async function create(
    who: Person,
    input: Record<string, unknown>,
  ): Promise<GqlOutcome<{ createPrintJob: { job: JobRow } }>> {
    return gql<{ createPrintJob: { job: JobRow } }>(
      world,
      who,
      DOCS.createJob,
      {
        input,
      },
    );
  }

  /** 讓這張單據印成功一次(代理程式認領 + 回報已印)。 */
  async function printOnce(refId: string): Promise<JobRow> {
    const created = await create(world.admin, printInput(printer.id, refId));
    expect(created.error).toBeNull();
    const job = created.data?.createPrintJob.job;
    if (job === undefined) {
      throw new Error("沒有建立工作");
    }
    await agentHttp(
      world,
      "post",
      `/print-agent/jobs/${job.id}/claim`,
      agent.key,
    );
    await agentHttp(
      world,
      "post",
      `/print-agent/jobs/${job.id}/result`,
      agent.key,
      { status: "printed" },
    );
    return job;
  }

  /** 測試環境沒有 GCS:檔案服務是記錄用 adapter,manifest 由測試放進去。 */
  function storage(): RecordingStorageService {
    const service = world.api.app.get(StorageService, { strict: false });
    if (!(service instanceof RecordingStorageService)) {
      throw new TypeError("測試應使用記錄用 adapter");
    }
    return service;
  }

  function release(): PrintAgentReleaseService {
    return world.api.app.get(PrintAgentReleaseService, { strict: false });
  }

  beforeAll(async () => {
    const api = await startAuthTestApp("printing_jobs");
    world = await setupWorld(api);
    agent = await pairedAgent(world, world.storeA);
    printer = await addPrinter(world, agent.agent.id);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  describe("建立列印工作", () => {
    it("沒有 api.printing.print → 建立工作被拒(FORBIDDEN)", async () => {
      const result = await create(
        world.managerNoPrint,
        printInput(printer.id, newRef()),
      );
      expect(result.error?.code).toBe("FORBIDDEN");
      const viewer = await create(
        world.viewer,
        printInput(printer.id, newRef()),
      );
      expect(viewer.error?.code).toBe("FORBIDDEN");
    });

    it("有 api.printing.print → 建立「等待中」的工作,要求人 = 自己,第 1 次", async () => {
      const result = await create(
        world.cashier,
        printInput(printer.id, newRef()),
      );
      expect(result.error).toBeNull();
      expect(result.data?.createPrintJob.job).toMatchObject({
        status: "PENDING",
        printNo: 1,
        isReprint: false,
        requestedBy: { id: String(world.cashier.userId) },
      });
    });

    it("圖片不是 PNG / 寬度不是 384 點 → VALIDATION_FAILED(INVALID_IMAGE)", async () => {
      for (const image of ["bm90IGEgcG5n", pngBase64(400)]) {
        const result = await create(
          world.admin,
          printInput(printer.id, newRef(), { image }),
        );
        expect(result.error?.code).toBe("VALIDATION_FAILED");
        expect(result.error?.extensions?.fieldErrors).toEqual([
          expect.objectContaining({ fieldKey: "image", code: "INVALID_IMAGE" }),
        ]);
      }
    });

    it("停用的印表機 → VALIDATION_FAILED(PRINTER_UNAVAILABLE)", async () => {
      const other = await addPrinter(world, agent.agent.id, {
        name: "要停用的",
      });
      await ok(world, world.admin, DOCS.setPrinterEnabled, {
        input: { id: other.id, enabled: false },
      });
      const result = await create(world.admin, printInput(other.id, newRef()));
      expect(result.error?.extensions?.fieldErrors).toEqual([
        expect.objectContaining({
          fieldKey: "printerId",
          code: "PRINTER_UNAVAILABLE",
        }),
      ]);
    });
  });

  describe("補印(列印按鈕的 API 列,每列一個測試)", () => {
    it("第一次列印(非補印)→ reprintReason、reprintNote 寫 null(就算送了也忽略)", async () => {
      const result = await create(
        world.admin,
        printInput(printer.id, newRef(), {
          reprintReason: "lost",
          reprintNote: "不該寫進去",
        }),
      );
      expect(result.data?.createPrintJob.job).toMatchObject({
        isReprint: false,
        reprintReason: null,
        reprintNote: null,
      });
    });

    it("選「遺失」送出 → isReprint、reprintReason = lost、沒填說明寫 null;printNo = 已印次數 + 1", async () => {
      const refId = newRef();
      await printOnce(refId);
      await printOnce(refId);
      const count = await ok<{ documentPrintCount: { printedCount: number } }>(
        world,
        world.admin,
        DOCS.printedCount,
        { input: { refType: "order", refId } },
      );
      expect(count.documentPrintCount.printedCount).toBe(2);
      const result = await create(
        world.admin,
        printInput(printer.id, refId, {
          isReprint: true,
          reprintReason: "lost",
        }),
      );
      expect(result.error).toBeNull();
      expect(result.data?.createPrintJob.job).toMatchObject({
        isReprint: true,
        reprintReason: "lost",
        reprintNote: null,
        printNo: 3,
      });
    });

    it("選「破損」並填說明 → 說明照存", async () => {
      const result = await create(
        world.admin,
        printInput(printer.id, newRef(), {
          isReprint: true,
          reprintReason: "damaged",
          reprintNote: "被咖啡潑到",
        }),
      );
      expect(result.data?.createPrintJob.job).toMatchObject({
        reprintReason: "damaged",
        reprintNote: "被咖啡潑到",
      });
    });

    it("補印沒有 reprintReason → VALIDATION_FAILED,fieldErrors 指到 reprintReason", async () => {
      const result = await create(
        world.admin,
        printInput(printer.id, newRef(), { isReprint: true }),
      );
      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.extensions?.fieldErrors).toEqual([
        expect.objectContaining({
          fieldKey: "reprintReason",
          code: "REQUIRED",
        }),
      ]);
    });

    it("補印原因「其他」沒有 reprintNote → VALIDATION_FAILED,fieldErrors 指到 reprintNote", async () => {
      const result = await create(
        world.admin,
        printInput(printer.id, newRef(), {
          isReprint: true,
          reprintReason: "other",
          reprintNote: "  ",
        }),
      );
      expect(result.error?.extensions?.fieldErrors).toEqual([
        expect.objectContaining({ fieldKey: "reprintNote", code: "REQUIRED" }),
      ]);
    });

    it("補印原因不是「補印原因」類別的選項 → VALIDATION_FAILED(INVALID)", async () => {
      const result = await create(
        world.admin,
        printInput(printer.id, newRef(), {
          isReprint: true,
          reprintReason: "male",
        }),
      );
      expect(result.error?.extensions?.fieldErrors).toEqual([
        expect.objectContaining({ fieldKey: "reprintReason", code: "INVALID" }),
      ]);
    });

    it("沒有 api.printing.reprint → 直接呼叫補印 API → FORBIDDEN", async () => {
      const result = await create(
        world.cashier,
        printInput(printer.id, newRef(), {
          isReprint: true,
          reprintReason: "lost",
        }),
      );
      expect(result.error?.code).toBe("FORBIDDEN");
    });
  });

  describe("印表機管理的權限(API 列,每列一個測試)", () => {
    it("沒有 create 直接呼叫新增代理程式 / 新增印表機 / 下載 API → FORBIDDEN", async () => {
      const calls = [
        gql(world, world.viewer, DOCS.createAgent, {
          input: { orgId: String(world.storeA), name: "x" },
        }),
        gql(world, world.viewer, DOCS.createPrinter, {
          input: { agentId: agent.agent.id, name: "x", host: "receipt-x.lan" },
        }),
        gql(world, world.viewer, DOCS.downloadUrl, {
          input: { platform: "WINDOWS_X64" },
        }),
        gql(world, world.viewer, DOCS.release),
      ];
      for (const result of await Promise.all(calls)) {
        expect(result.error?.code).toBe("FORBIDDEN");
      }
    });

    it("沒有 edit 直接呼叫編輯 / 停用 / 重新配對 / 測試列印 API → FORBIDDEN", async () => {
      const calls = [
        gql(world, world.viewer, DOCS.updatePrinter, {
          input: { id: printer.id, name: "改名" },
        }),
        gql(world, world.viewer, DOCS.setPrinterEnabled, {
          input: { id: printer.id, enabled: false },
        }),
        gql(world, world.viewer, DOCS.disableAgent, {
          input: { id: agent.agent.id },
        }),
        gql(world, world.viewer, DOCS.resetPairing, {
          input: { id: agent.agent.id },
        }),
        gql(world, world.viewer, DOCS.testPage, {
          input: { printerId: printer.id, image: pngBase64() },
        }),
      ];
      for (const result of await Promise.all(calls)) {
        expect(result.error?.code).toBe("FORBIDDEN");
      }
    });

    it("只有 view → 三個清單都看得到", async () => {
      const agents = await gql(world, world.viewer, DOCS.agents, { input: {} });
      const printers = await gql(world, world.viewer, DOCS.printers, {
        input: {},
      });
      const jobs = await gql(world, world.viewer, DOCS.jobs, { input: {} });
      expect([agents.error, printers.error, jobs.error]).toEqual([
        null,
        null,
        null,
      ]);
    });

    it("沒有 view → 清單 FORBIDDEN;列印按鈕的人仍可查自己要求的那張工作", async () => {
      const list = await gql(world, world.cashier, DOCS.jobs, { input: {} });
      expect(list.error?.code).toBe("FORBIDDEN");
      const created = await create(
        world.cashier,
        printInput(printer.id, newRef()),
      );
      const id = created.data?.createPrintJob.job.id;
      const own = await gql<{ printJob: { job: JobRow } }>(
        world,
        world.cashier,
        DOCS.job,
        { id },
      );
      expect(own.error).toBeNull();
      const adminJob = await create(
        world.admin,
        printInput(printer.id, newRef()),
      );
      const other = await gql(world, world.cashier, DOCS.job, {
        id: adminJob.data?.createPrintJob.job.id,
      });
      expect(other.error?.code).toBe("NOT_FOUND");
    });

    it("測試列印(edit)→ 建立 printer-test-page 的工作,refId = 印表機", async () => {
      const result = await ok<{ printPrinterTestPage: { job: JobRow } }>(
        world,
        world.managerNoPrint,
        DOCS.testPage,
        { input: { printerId: printer.id, image: pngBase64() } },
      );
      expect(result.printPrinterTestPage.job).toMatchObject({
        status: "PENDING",
        printerId: printer.id,
      });
      const stored = await world.api.connection
        .collection("print_jobs")
        .findOne({ refType: "printer", refId: printer.id });
      expect(stored?.documentType).toBe("printer-test-page");
    });
  });

  describe("印表機", () => {
    it("分店預設至多一台:設新的預設時舊的改 false;列印選單回 defaultPrinterId", async () => {
      const first = await addPrinter(world, agent.agent.id, {
        name: "預設一",
        isDefault: true,
      });
      const second = await addPrinter(world, agent.agent.id, {
        name: "預設二",
      });
      await ok(world, world.admin, DOCS.updatePrinter, {
        input: { id: second.id, isDefault: true },
      });
      const printable = await ok<{
        printablePrinters: {
          items: PrinterRow[];
          defaultPrinterId: string | null;
        };
      }>(world, world.cashier, DOCS.printable, { orgId: String(world.storeA) });
      expect(printable.printablePrinters.defaultPrinterId).toBe(second.id);
      const defaults = printable.printablePrinters.items.filter(
        (entry) => entry.isDefault,
      );
      expect(defaults.map((entry) => entry.id)).toEqual([second.id]);
      expect(
        printable.printablePrinters.items.map((entry) => entry.id),
      ).toContain(first.id);
    });

    it("沒有印表機的分店 → 列印選單是空的", async () => {
      const printable = await ok<{
        printablePrinters: { totalCount: number };
      }>(world, world.cashier, DOCS.printable, { orgId: String(world.storeB) });
      expect(printable.printablePrinters.totalCount).toBe(0);
    });

    it("主機格式不對、埠超出範圍 → VALIDATION_FAILED", async () => {
      const result = await gql(world, world.admin, DOCS.createPrinter, {
        input: {
          agentId: agent.agent.id,
          name: "壞的",
          host: "bad host!",
          port: 70_000,
        },
      });
      expect(result.error?.extensions?.fields).toEqual(["host", "port"]);
    });
  });

  describe("安裝檔下載", () => {
    it("還沒發布(沒有 manifest)→ 最新版本 null;下載 → NOT_FOUND", async () => {
      storage().putObject(PRINT_AGENT_MANIFEST_PATH, null);
      release().invalidate();
      const data = await ok<{
        printAgentRelease: { latestVersion: string | null; files: unknown[] };
      }>(world, world.admin, DOCS.release);
      expect(data.printAgentRelease).toEqual({
        latestVersion: null,
        files: [],
      });
      const download = await gql(world, world.admin, DOCS.downloadUrl, {
        input: { platform: "WINDOWS_X64" },
      });
      expect(download.error?.code).toBe("NOT_FOUND");
    });

    it("讀 manifest.json → 最新版本與檔案;下載簽 1 小時的網址;舊版代理程式標「請更新」", async () => {
      storage().putObject(
        PRINT_AGENT_MANIFEST_PATH,
        JSON.stringify({
          latest: "1.2.0",
          releases: [
            {
              version: "1.2.0",
              publishedAt: "2026-10-17T00:00:00.000Z",
              files: [
                {
                  platform: "windows-x64",
                  name: "print-agent-windows-x64.zip",
                  sha256: SHA,
                  size: 2048,
                },
              ],
            },
          ],
        }),
      );
      release().invalidate();
      const data = await ok<{
        printAgentRelease: {
          latestVersion: string;
          files: { platform: string }[];
        };
      }>(world, world.admin, DOCS.release);
      expect(data.printAgentRelease.latestVersion).toBe("1.2.0");
      expect(data.printAgentRelease.files).toEqual([
        expect.objectContaining({ platform: "WINDOWS_X64" }),
      ]);

      const before = Date.now();
      const download = await ok<{
        printAgentDownloadUrl: { url: string; expiresAt: string };
      }>(world, world.admin, DOCS.downloadUrl, {
        input: { platform: "WINDOWS_X64" },
      });
      expect(download.printAgentDownloadUrl.url).toContain(
        "print-agent/1.2.0/print-agent-windows-x64.zip",
      );
      const signed = storage().signed.at(-1);
      expect(signed?.objectPath).toBe(
        "print-agent/1.2.0/print-agent-windows-x64.zip",
      );
      const ttl = (signed?.expiresAt.getTime() ?? 0) - before;
      expect(ttl).toBeGreaterThan(59 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);

      // 代理程式配對時回報 1.0.0 → 請更新
      const agents = await ok<{ printAgents: { items: AgentRow[] } }>(
        world,
        world.admin,
        DOCS.agents,
        { input: { orgId: String(world.storeA) } },
      );
      const row = agents.printAgents.items.find(
        (entry) => entry.id === agent.agent.id,
      );
      expect(row).toMatchObject({ version: "1.0.0", updateAvailable: true });
    });

    it("manifest 裡沒有的平台 → NOT_FOUND", async () => {
      const download = await gql(world, world.admin, DOCS.downloadUrl, {
        input: { platform: "MACOS_ARM64" },
      });
      expect(download.error?.code).toBe("NOT_FOUND");
    });
  });
});
