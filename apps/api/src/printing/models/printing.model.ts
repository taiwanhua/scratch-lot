import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

/**
 * 列印的 GraphQL 型別(GQL-02 / GQL-03;欄位語意正本 docs/modules/printers.md「api 介面」)。
 * 資料庫存 kebab-case(`@repo/domain/printing`),GraphQL 一律 SCREAMING_SNAKE_CASE(GQL-01)。
 */

export enum PrintJobStatusEnum {
  PENDING = "pending",
  SENT = "sent",
  PRINTED = "printed",
  FAILED = "failed",
}
registerEnumType(PrintJobStatusEnum, {
  name: "PrintJobStatus",
  description: "列印工作狀態:等待中 → 已送出(代理程式認領)→ 已印 / 失敗",
});

export enum PrintJobErrorEnum {
  AGENT_OFFLINE = "agent-offline",
  AGENT_DISABLED = "agent-disabled",
  NO_RESULT = "no-result",
  PAPER_OUT = "paper-out",
  PRINTER_OFFLINE = "printer-offline",
  OTHER = "other",
}
registerEnumType(PrintJobErrorEnum, {
  name: "PrintJobError",
  description:
    "失敗原因:代理程式離線(含 2 分鐘沒被認領)/ 代理程式已停用 / 未收到列印結果(已送出 2 分鐘沒回報)/ 缺紙 / 連不上印表機 / 其他",
});

export enum PrinterStatusEnum {
  OK = "ok",
  PAPER_OUT = "paper-out",
  OFFLINE = "offline",
}
registerEnumType(PrinterStatusEnum, {
  name: "PrinterStatus",
  description: "代理程式回報的印表機狀態:正常 / 缺紙 / 離線",
});

export enum PrintAgentPlatformEnum {
  WINDOWS_X64 = "windows-x64",
  LINUX_X64 = "linux-x64",
  LINUX_ARM64 = "linux-arm64",
  MACOS_ARM64 = "macos-arm64",
}
registerEnumType(PrintAgentPlatformEnum, {
  name: "PrintAgentPlatform",
  description: "代理程式安裝檔的平台",
});

/** 代理程式(api 介面見 printers.md)。 */
@ObjectType("PrintAgent")
export class PrintAgentModel {
  @Field(() => ID)
  id!: string;

  /** 所在分店。 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  name!: string;

  /** 已配對(有有效金鑰)。重新配對後、新配對碼用掉前為 false。 */
  @Field(() => Boolean)
  paired!: boolean;

  /** 有效配對碼的到期時間;沒有等待中的配對為 null(配對碼本身只在產生時回一次)。 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  pairingExpiresAt!: Date | null;

  /** 已連線 = `lastSeenAt` 在 2 分鐘內(連著即時通道時靠每 60 秒的心跳維持)。 */
  @Field(() => Boolean)
  online!: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  lastSeenAt!: Date | null;

  /** 代理程式回報的版本;沒回報過為 null。 */
  @Field(() => String, { nullable: true })
  version!: string | null;

  /** 比安裝檔的最新版本舊 →「請更新」。讀不到 manifest 或版本不認得時為 false。 */
  @Field(() => Boolean)
  updateAvailable!: boolean;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 印表機。 */
@ObjectType("Printer")
export class PrinterModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  agentId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  host!: string;

  @Field(() => Int)
  port!: number;

  /** 紙寬 mm(底座只有 58)。 */
  @Field(() => Int)
  paperWidth!: number;

  /** 分店預設印表機。 */
  @Field(() => Boolean)
  isDefault!: boolean;

  @Field(() => Boolean)
  enabled!: boolean;

  /** 代理程式最後回報的狀態;沒回報過為 null。 */
  @Field(() => PrinterStatusEnum, { nullable: true })
  status!: PrinterStatusEnum | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  statusAt!: Date | null;

  /** 它的代理程式目前是否已連線(2 分鐘內)。 */
  @Field(() => Boolean)
  agentOnline!: boolean;

  /** 列印按鈕上可選:印表機啟用且代理程式啟用(離線仍可選,送出時立即顯示失敗)。 */
  @Field(() => Boolean)
  available!: boolean;
}

@ObjectType("PrintJobRequester")
export class PrintJobRequesterModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/** 列印工作(圖片不經 GraphQL 回傳)。 */
@ObjectType("PrintJob")
export class PrintJobModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  orgId!: string;

  @Field(() => ID)
  printerId!: string;

  @Field(() => String)
  documentType!: string;

  @Field(() => String)
  refType!: string;

  @Field(() => String)
  refId!: string;

  /** 單據的顯示名稱;建立時沒給為 null。 */
  @Field(() => String, { nullable: true })
  documentName!: string | null;

  @Field(() => PrintJobStatusEnum)
  status!: PrintJobStatusEnum;

  /** 失敗原因;沒失敗為 null。 */
  @Field(() => PrintJobErrorEnum, { nullable: true })
  error!: PrintJobErrorEnum | null;

  @Field(() => Boolean)
  isReprint!: boolean;

  /** 這張單據的第幾次列印。 */
  @Field(() => Int)
  printNo!: number;

  /** 補印原因(欄位類別「補印原因」的選項值);非補印為 null。 */
  @Field(() => String, { nullable: true })
  reprintReason!: string | null;

  @Field(() => String, { nullable: true })
  reprintNote!: string | null;

  /** 要求人;查不到使用者時為 null。 */
  @Field(() => PrintJobRequesterModel, { nullable: true })
  requestedBy!: PrintJobRequesterModel | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  sentAt!: Date | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  printedAt!: Date | null;
}

@ObjectType()
export class PrintAgentPayload {
  @Field(() => PrintAgentModel)
  agent!: PrintAgentModel;
}

/** 新增代理程式 / 重新配對:配對碼**只在這裡回一次**(資料庫只存雜湊)。 */
@ObjectType()
export class PrintAgentPairingPayload {
  @Field(() => PrintAgentModel)
  agent!: PrintAgentModel;

  /** 8 碼配對碼;伺服器網址由前端以自己打的 API origin 顯示。 */
  @Field(() => String)
  pairingCode!: string;

  @Field(() => GraphQLISODateTime)
  pairingExpiresAt!: Date;
}

@ObjectType()
export class PrintAgentsPayload {
  @Field(() => [PrintAgentModel])
  items!: PrintAgentModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

@ObjectType()
export class PrinterPayload {
  @Field(() => PrinterModel)
  printer!: PrinterModel;
}

@ObjectType()
export class PrintersPayload {
  @Field(() => [PrinterModel])
  items!: PrinterModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 列印按鈕的選單:分店的印表機(不分頁;一家店只有幾台)。 */
@ObjectType()
export class PrintablePrintersPayload {
  @Field(() => [PrinterModel])
  items!: PrinterModel[];

  @Field(() => Int)
  totalCount!: number;

  /** 分店預設印表機(可選的那幾台裡 `isDefault` 的);沒有為 null。 */
  @Field(() => ID, { nullable: true })
  defaultPrinterId!: string | null;
}

@ObjectType()
export class PrintJobPayload {
  @Field(() => PrintJobModel)
  job!: PrintJobModel;
}

@ObjectType()
export class PrintJobsPayload {
  @Field(() => [PrintJobModel])
  items!: PrintJobModel[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 一張單據已印的次數(> 0 時按鈕變 [補印];補印的 `printNo` = 這個數 + 1)。 */
@ObjectType()
export class DocumentPrintCountPayload {
  @Field(() => Int)
  printedCount!: number;
}

@ObjectType("PrintAgentReleaseFile")
export class PrintAgentReleaseFileModel {
  @Field(() => PrintAgentPlatformEnum)
  platform!: PrintAgentPlatformEnum;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  sha256!: string;

  /** bytes。 */
  @Field(() => Int)
  size!: number;
}

/** 下載區:最新版本與四個平台的檔案;還沒發布過(沒有 manifest)時 `latestVersion` 為 null、`files` 為空。 */
@ObjectType()
export class PrintAgentReleasePayload {
  @Field(() => String, { nullable: true })
  latestVersion!: string | null;

  @Field(() => [PrintAgentReleaseFileModel])
  files!: PrintAgentReleaseFileModel[];
}

/** 按下下載時現簽的網址(1 小時)。 */
@ObjectType()
export class PrintAgentDownloadUrlPayload {
  @Field(() => String)
  url!: string;

  @Field(() => String)
  version!: string;

  @Field(() => PrintAgentReleaseFileModel)
  file!: PrintAgentReleaseFileModel;

  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;
}
