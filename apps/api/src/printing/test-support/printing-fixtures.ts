import { crc32, deflateSync } from "node:zlib";

import { expect, jest } from "@jest/globals";
import { Types } from "mongoose";
import request from "supertest";

import type { RealtimePublishRequest } from "@repo/domain/realtime";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../auth/test-support/fixtures";
import { createRole } from "../../permission/test-support/fixtures";
import { RealtimeTransport } from "../../realtime/realtime-transport";

/**
 * 列印測試的共用夾具(docs/modules/printers.md):組織、操作者、GraphQL 文件、代理程式的 HTTP 呼叫。
 * 測試檔只寫行為。
 */

export const PASSWORD = ["print", "test", "pass"].join("-");

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const AGENT_FIELDS = /* GraphQL */ `
  fragment PrintAgentFields on PrintAgent {
    id
    orgId
    name
    paired
    pairingExpiresAt
    online
    lastSeenAt
    version
    updateAvailable
    enabled
  }
`;

const PRINTER_FIELDS = /* GraphQL */ `
  fragment PrinterFields on Printer {
    id
    orgId
    agentId
    name
    host
    port
    paperWidth
    isDefault
    enabled
    status
    agentOnline
    available
  }
`;

const JOB_FIELDS = /* GraphQL */ `
  fragment PrintJobFields on PrintJob {
    id
    orgId
    printerId
    documentType
    refType
    refId
    status
    error
    isReprint
    printNo
    reprintReason
    reprintNote
    requestedBy {
      id
      name
    }
    sentAt
    printedAt
  }
`;

export const DOCS = {
  createAgent: /* GraphQL */ `
    ${AGENT_FIELDS}
    mutation CreatePrintAgent($input: CreatePrintAgentInput!) {
      createPrintAgent(input: $input) {
        agent {
          ...PrintAgentFields
        }
        pairingCode
        pairingExpiresAt
      }
    }
  `,
  resetPairing: /* GraphQL */ `
    ${AGENT_FIELDS}
    mutation ResetPrintAgentPairing($input: PrintAgentIdInput!) {
      resetPrintAgentPairing(input: $input) {
        agent {
          ...PrintAgentFields
        }
        pairingCode
        pairingExpiresAt
      }
    }
  `,
  disableAgent: /* GraphQL */ `
    ${AGENT_FIELDS}
    mutation DisablePrintAgent($input: PrintAgentIdInput!) {
      disablePrintAgent(input: $input) {
        agent {
          ...PrintAgentFields
        }
      }
    }
  `,
  agents: /* GraphQL */ `
    ${AGENT_FIELDS}
    query PrintAgents($input: PrintAgentsInput!) {
      printAgents(input: $input) {
        items {
          ...PrintAgentFields
        }
        totalCount
      }
    }
  `,
  createPrinter: /* GraphQL */ `
    ${PRINTER_FIELDS}
    mutation CreatePrinter($input: CreatePrinterInput!) {
      createPrinter(input: $input) {
        printer {
          ...PrinterFields
        }
      }
    }
  `,
  updatePrinter: /* GraphQL */ `
    ${PRINTER_FIELDS}
    mutation UpdatePrinter($input: UpdatePrinterInput!) {
      updatePrinter(input: $input) {
        printer {
          ...PrinterFields
        }
      }
    }
  `,
  setPrinterEnabled: /* GraphQL */ `
    ${PRINTER_FIELDS}
    mutation SetPrinterEnabled($input: SetPrinterEnabledInput!) {
      setPrinterEnabled(input: $input) {
        printer {
          ...PrinterFields
        }
      }
    }
  `,
  printers: /* GraphQL */ `
    ${PRINTER_FIELDS}
    query Printers($input: PrintersInput!) {
      printers(input: $input) {
        items {
          ...PrinterFields
        }
        totalCount
      }
    }
  `,
  printable: /* GraphQL */ `
    ${PRINTER_FIELDS}
    query PrintablePrinters($orgId: ID!) {
      printablePrinters(orgId: $orgId) {
        items {
          ...PrinterFields
        }
        totalCount
        defaultPrinterId
      }
    }
  `,
  createJob: /* GraphQL */ `
    ${JOB_FIELDS}
    mutation CreatePrintJob($input: CreatePrintJobInput!) {
      createPrintJob(input: $input) {
        job {
          ...PrintJobFields
        }
      }
    }
  `,
  testPage: /* GraphQL */ `
    ${JOB_FIELDS}
    mutation PrintPrinterTestPage($input: PrintPrinterTestPageInput!) {
      printPrinterTestPage(input: $input) {
        job {
          ...PrintJobFields
        }
      }
    }
  `,
  job: /* GraphQL */ `
    ${JOB_FIELDS}
    query PrintJob($id: ID!) {
      printJob(id: $id) {
        job {
          ...PrintJobFields
        }
      }
    }
  `,
  jobs: /* GraphQL */ `
    ${JOB_FIELDS}
    query PrintJobs($input: PrintJobsInput!) {
      printJobs(input: $input) {
        items {
          ...PrintJobFields
        }
        totalCount
      }
    }
  `,
  printedCount: /* GraphQL */ `
    query DocumentPrintCount($input: DocumentPrintCountInput!) {
      documentPrintCount(input: $input) {
        printedCount
      }
    }
  `,
  release: /* GraphQL */ `
    query PrintAgentRelease {
      printAgentRelease {
        latestVersion
        files {
          platform
          name
          sha256
          size
        }
      }
    }
  `,
  downloadUrl: /* GraphQL */ `
    query PrintAgentDownloadUrl($input: PrintAgentDownloadUrlInput!) {
      printAgentDownloadUrl(input: $input) {
        url
        version
        expiresAt
        file {
          platform
          name
        }
      }
    }
  `,
} as const;

export interface AgentRow {
  id: string;
  orgId: string;
  name: string;
  paired: boolean;
  pairingExpiresAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
  version: string | null;
  updateAvailable: boolean;
  enabled: boolean;
}

export interface PrinterRow {
  id: string;
  orgId: string;
  agentId: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  status: string | null;
  agentOnline: boolean;
  available: boolean;
}

export interface JobRow {
  id: string;
  printerId: string;
  status: string;
  error: string | null;
  isReprint: boolean;
  printNo: number;
  reprintReason: string | null;
  reprintNote: string | null;
  requestedBy: { id: string; name: string } | null;
  sentAt: string | null;
  printedAt: string | null;
}

/** 權限組合(模組樹要給完整,ADR-0011)。 */
const PRINTERS_MODULES = ["system", "system.printers"];
const PRINTING_API_MODULES = ["api", "api.printing"];

export const ROLES = {
  /** 印表機管理全部 + 列印 / 補印。 */
  admin: {
    moduleKeys: [...PRINTERS_MODULES, ...PRINTING_API_MODULES],
    permissionKeys: [
      "system.printers.view",
      "system.printers.create",
      "system.printers.edit",
      "api.printing.print",
      "api.printing.reprint",
    ],
  },
  /** 只能列印(不能補印、不能管理)。 */
  cashier: {
    moduleKeys: PRINTING_API_MODULES,
    permissionKeys: ["api.printing.print"],
  },
  /** 只有檢視印表機管理。 */
  viewer: {
    moduleKeys: PRINTERS_MODULES,
    permissionKeys: ["system.printers.view"],
  },
  /** 管理全部,但沒有列印權限(沒有收據機的租戶那種)。 */
  managerNoPrint: {
    moduleKeys: PRINTERS_MODULES,
    permissionKeys: [
      "system.printers.view",
      "system.printers.create",
      "system.printers.edit",
    ],
  },
} as const;

export interface Person {
  userId: Types.ObjectId;
  token: string;
}

export interface World {
  api: AuthTestApp;
  tenantId: Types.ObjectId;
  storeA: Types.ObjectId;
  storeB: Types.ObjectId;
  admin: Person;
  cashier: Person;
  viewer: Person;
  managerNoPrint: Person;
  /** 攔下來的即時信號(每次 `/publish`)。 */
  sent: RealtimePublishRequest[];
}

let accountSequence = 0;

async function login(api: AuthTestApp, account: string): Promise<string> {
  const result = await api.graphql<{ login: { accessToken: string } }>(LOGIN, {
    input: { account, password: PASSWORD },
  });
  expect(result.errors).toBeUndefined();
  const token = result.data?.login.accessToken;
  if (!token) {
    throw new Error(`登入失敗:${account}`);
  }
  return token;
}

async function person(
  api: AuthTestApp,
  tenantId: Types.ObjectId,
  orgIds: Types.ObjectId[],
  role: { moduleKeys: readonly string[]; permissionKeys: readonly string[] },
): Promise<Person> {
  accountSequence += 1;
  const account = `printing-${String(accountSequence)}`;
  const userId = await createUser(api.connection, {
    account,
    password: PASSWORD,
    orgIds,
  });
  await createRole(api.app, api.connection, {
    name: `列印角色:${account}`,
    ownerOrgId: tenantId,
    moduleKeys: [...role.moduleKeys],
    permissionKeys: [...role.permissionKeys],
    assignTo: [userId],
  });
  return { userId, token: await login(api, account) };
}

/** 一個租戶、兩家分店;四種操作者都屬於兩家分店(目前組織 = 分店 A)。 */
export async function setupWorld(api: AuthTestApp): Promise<World> {
  const tenantId = await createOrg(api.connection, { name: "列印測試租戶" });
  const storeA = await createOrg(api.connection, {
    name: "分店 A",
    parentId: tenantId,
  });
  const storeB = await createOrg(api.connection, {
    name: "分店 B",
    parentId: tenantId,
  });
  const orgIds = [storeA, storeB];
  const sent: RealtimePublishRequest[] = [];
  const transport = api.app.get(RealtimeTransport, { strict: false });
  jest.spyOn(transport, "send").mockImplementation((publish) => {
    sent.push(publish);
    return Promise.resolve();
  });
  return {
    api,
    tenantId,
    storeA,
    storeB,
    admin: await person(api, tenantId, orgIds, ROLES.admin),
    cashier: await person(api, tenantId, orgIds, ROLES.cashier),
    viewer: await person(api, tenantId, orgIds, ROLES.viewer),
    managerNoPrint: await person(api, tenantId, orgIds, ROLES.managerNoPrint),
    sent,
  };
}

/** GraphQL 呼叫的結果:data 與第一個錯誤。 */
export interface GqlOutcome<T> {
  data: T | null;
  error: { code?: string; extensions?: Record<string, unknown> } | null;
}

/** GraphQL 呼叫;回 data 與第一個錯誤。 */
export async function gql<T = Record<string, unknown>>(
  world: World,
  who: Person,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GqlOutcome<T>> {
  const result = await world.api.graphql<T>(query, variables, {
    accessToken: who.token,
  });
  const first = result.errors?.[0];
  return {
    data: result.data,
    error:
      first === undefined
        ? null
        : {
            code: first.extensions?.code,
            extensions: first.extensions as Record<string, unknown>,
          },
  };
}

/** 只取 HTTP 狀態碼。 */
export async function statusOf(
  call: PromiseLike<{ status: number }>,
): Promise<number> {
  const response = await call;
  return response.status;
}

/** 必須成功的 GraphQL 呼叫。 */
export async function ok<T>(
  world: World,
  who: Person,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await gql<T>(world, who, query, variables);
  expect(error).toBeNull();
  if (data === null) {
    throw new Error("沒有回資料");
  }
  return data;
}

/** 代理程式的 HTTP 呼叫(`key` 為 null = 不帶金鑰)。 */
export function agentHttp(
  world: World,
  method: "get" | "post",
  path: string,
  key: string | null,
  body?: unknown,
): request.Test {
  const server = world.api.app.getHttpServer() as Parameters<typeof request>[0];
  let call =
    method === "get" ? request(server).get(path) : request(server).post(path);
  if (key !== null) {
    call = call.set("Authorization", `Bearer ${key}`);
  }
  return body === undefined ? call : call.send(body as object);
}

/** 新增代理程式(管理員)→ 拿配對碼 → 配對 → 回代理程式與金鑰。 */
export async function pairedAgent(
  world: World,
  orgId: Types.ObjectId,
  name = "收銀電腦",
): Promise<{ agent: AgentRow; key: string }> {
  const created = await ok<{
    createPrintAgent: { agent: AgentRow; pairingCode: string };
  }>(world, world.admin, DOCS.createAgent, {
    input: { orgId: String(orgId), name },
  });
  const paired = await agentHttp(world, "post", "/print-agent/pair", null, {
    code: created.createPrintAgent.pairingCode,
    version: "1.0.0",
  });
  expect(paired.status).toBe(200);
  const body = paired.body as { agentId: string; key: string };
  expect(body.agentId).toBe(created.createPrintAgent.agent.id);
  return { agent: created.createPrintAgent.agent, key: body.key };
}

/** 新增印表機(管理員)。 */
export async function addPrinter(
  world: World,
  agentId: string,
  input: Record<string, unknown> = {},
): Promise<PrinterRow> {
  const data = await ok<{ createPrinter: { printer: PrinterRow } }>(
    world,
    world.admin,
    DOCS.createPrinter,
    {
      input: { agentId, name: "櫃台收據機", host: "receipt-a.lan", ...input },
    },
  );
  return data.createPrinter.printer;
}

/** PNG 的一個 chunk(長度 + 類型 + 內容 + CRC)。 */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 384 點寬(或指定寬度)的黑白 PNG(base64)。 */
export function pngBase64(width = 384, height = 4): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(1, 8); // 1 bit
  header.writeUInt8(0, 9); // 灰階
  const rowBytes = Math.ceil(width / 8);
  const raw = Buffer.alloc((rowBytes + 1) * height); // 每列前面一個 filter byte
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

let refSequence = 0;

/** 每次一張新單據的 refId。 */
export function newRef(): string {
  refSequence += 1;
  return `order-${String(refSequence)}`;
}

/** 列印按鈕的輸入(第一次列印)。 */
export function printInput(
  printerId: string,
  refId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    printerId,
    documentType: "order-receipt",
    refType: "order",
    refId,
    image: pngBase64(),
    ...extra,
  };
}

/** 直接把資料庫的時間往回撥(模擬過了一段時間)。 */
export async function backdate(
  world: World,
  collection: "print_jobs" | "print_agents",
  id: string,
  field: "createdAt" | "lastSeenAt" | "pairingExpiresAt",
  msAgo: number,
): Promise<void> {
  await world.api.connection
    .collection(collection)
    .updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { [field]: new Date(Date.now() - msAgo) } },
    );
}

/** 從第 `from` 筆起,某類信號送到的頻道與 id。 */
export function signalsSince(
  world: World,
  from: number,
  type: string,
): { topics: string[]; id: string | undefined }[] {
  return world.sent
    .slice(from)
    .filter((publish) => publish.signal.type === type)
    .map((publish) => ({ topics: publish.topics, id: publish.signal.id }));
}
