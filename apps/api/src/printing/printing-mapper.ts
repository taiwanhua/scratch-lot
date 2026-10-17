import { isPrintAgentOffline } from "@repo/domain/printing";

import type { Persisted } from "../database/base.repository";
import type {
  PrintAgentDocument,
  PrintJobDocument,
  PrinterDocument,
} from "../database/database.module";
import type {
  PrintAgentModel,
  PrintJobErrorEnum,
  PrintJobModel,
  PrintJobRequesterModel,
  PrintJobStatusEnum,
  PrinterModel,
  PrinterStatusEnum,
} from "./models/printing.model";

export type AgentRecord = Persisted<PrintAgentDocument>;
export type PrinterRecord = Persisted<PrinterDocument>;
export type JobRecord = Persisted<PrintJobDocument>;

/** 清單頁碼夾在 1 起、每頁 1–上限。 */
export function pageOf(
  input: { page?: number | null; pageSize?: number | null },
  defaultSize: number,
  maxSize: number,
): { page: number; pageSize: number; skip: number } {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(
    maxSize,
    Math.max(1, input.pageSize ?? defaultSize),
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function toAgentModel(
  agent: AgentRecord,
  now: Date,
  isOutdated: (version: string | null) => boolean,
): PrintAgentModel {
  const pairingPending =
    agent.pairingCodeHash !== null &&
    agent.pairingExpiresAt !== null &&
    agent.pairingExpiresAt.getTime() > now.getTime();
  return {
    id: String(agent._id),
    orgId: String(agent.orgId),
    name: agent.name,
    paired: agent.keyHash !== null,
    pairingExpiresAt: pairingPending ? agent.pairingExpiresAt : null,
    online: agent.enabled && !isPrintAgentOffline(agent.lastSeenAt, now),
    lastSeenAt: agent.lastSeenAt,
    version: agent.version,
    updateAvailable: isOutdated(agent.version),
    enabled: agent.enabled,
    createdAt: agent.createdAt,
  };
}

/** `agents`:印表機的代理程式(查不到 = 已不存在,當作停用)。 */
export function toPrinterModel(
  printer: PrinterRecord,
  agents: ReadonlyMap<string, AgentRecord>,
  now: Date,
): PrinterModel {
  const agent = agents.get(String(printer.agentId));
  const agentEnabled = agent?.enabled === true;
  return {
    id: String(printer._id),
    orgId: String(printer.orgId),
    agentId: String(printer.agentId),
    name: printer.name,
    host: printer.host,
    port: printer.port,
    paperWidth: printer.paperWidth,
    isDefault: printer.isDefault,
    enabled: printer.enabled,
    status: printer.status as PrinterStatusEnum | null,
    statusAt: printer.statusAt,
    agentOnline:
      agentEnabled && !isPrintAgentOffline(agent.lastSeenAt ?? null, now),
    available: printer.enabled && agentEnabled,
  };
}

export function toJobModel(
  job: JobRecord,
  requesters: ReadonlyMap<string, PrintJobRequesterModel>,
): PrintJobModel {
  return {
    id: String(job._id),
    orgId: String(job.orgId),
    printerId: String(job.printerId),
    documentType: job.documentType,
    refType: job.refType,
    refId: job.refId,
    documentName: job.documentName,
    status: job.status as PrintJobStatusEnum,
    error: job.error as PrintJobErrorEnum | null,
    isReprint: job.isReprint,
    printNo: job.printNo,
    reprintReason: job.reprintReason,
    reprintNote: job.reprintNote,
    requestedBy: requesters.get(String(job.requestedBy)) ?? null,
    createdAt: job.createdAt,
    sentAt: job.sentAt,
    printedAt: job.printedAt,
  };
}
