import { Field, ID, InputType, Int } from "@nestjs/graphql";

import {
  PrintAgentPlatformEnum,
  PrintJobStatusEnum,
} from "../models/printing.model";

/** 清單分頁預設值(與其他模組同一組數字)。 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 代理程式清單(`system.printers.view`);範圍 = 操作者可見範圍。 */
@InputType()
export class PrintAgentsInput {
  /** 只看這家分店;缺席 / null = 可見範圍內全部。 */
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  /** 缺席 / null = 啟用與停用都列。 */
  @Field(() => Boolean, { nullable: true })
  enabled?: boolean | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 印表機清單(`system.printers.view`)。 */
@InputType()
export class PrintersInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  agentId?: string | null;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean | null;

  /** 比對名稱與主機(部分比對,不分大小寫)。 */
  @Field(() => String, { nullable: true })
  keyword?: string | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 列印紀錄(`system.printers.view`),新到舊。 */
@InputType()
export class PrintJobsInput {
  @Field(() => ID, { nullable: true })
  orgId?: string | null;

  @Field(() => ID, { nullable: true })
  printerId?: string | null;

  @Field(() => PrintJobStatusEnum, { nullable: true })
  status?: PrintJobStatusEnum | null;

  /** 同一張單據的紀錄:`refType` 與 `refId` 一起給。 */
  @Field(() => String, { nullable: true })
  refType?: string | null;

  @Field(() => String, { nullable: true })
  refId?: string | null;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: DEFAULT_PAGE_SIZE,
    description: `每頁筆數,上限 ${String(MAX_PAGE_SIZE)}`,
  })
  pageSize?: number;
}

/** 新增代理程式(`system.printers.create`):產生 8 碼配對碼(10 分鐘)。 */
@InputType()
export class CreatePrintAgentInput {
  /** 所在分店(須在操作者可見範圍內)。 */
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  name!: string;
}

/** 重新配對 / 停用(`system.printers.edit`)。 */
@InputType()
export class PrintAgentIdInput {
  @Field(() => ID)
  id!: string;
}

/** 新增印表機(`system.printers.create`);分店 = 代理程式的分店。 */
@InputType()
export class CreatePrinterInput {
  @Field(() => ID)
  agentId!: string;

  @Field(() => String)
  name!: string;

  /** 區域網路 IP 或主機名。 */
  @Field(() => String)
  host!: string;

  /** 缺席 / null = 9100。 */
  @Field(() => Int, { nullable: true })
  port?: number | null;

  /** 缺席 / null = 58。 */
  @Field(() => Int, { nullable: true })
  paperWidth?: number | null;

  /** true = 設為分店預設(同分店原本的預設改 false);缺席 / null = false。 */
  @Field(() => Boolean, { nullable: true })
  isDefault?: boolean | null;
}

/** 編輯印表機(`system.printers.edit`):缺席 = 不動;這些欄位都不接受 null。 */
@InputType()
export class UpdatePrinterInput {
  @Field(() => ID)
  id!: string;

  /** 改掛同分店的另一個代理程式。 */
  @Field(() => ID, { nullable: true })
  agentId?: string | null;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  host?: string | null;

  @Field(() => Int, { nullable: true })
  port?: number | null;

  @Field(() => Boolean, { nullable: true })
  isDefault?: boolean | null;
}

/** 停用 / 啟用印表機(`system.printers.edit`)。 */
@InputType()
export class SetPrinterEnabledInput {
  @Field(() => ID)
  id!: string;

  @Field(() => Boolean)
  enabled!: boolean;
}

/**
 * 建立列印工作(`api.printing.print`;`isReprint` 另要 `api.printing.reprint`)。
 * `image` = 瀏覽器轉好的黑白 PNG(base64,可帶 `data:image/png;base64,` 前綴),寬度 = 紙寬點數(58mm = 384)。
 */
@InputType()
export class CreatePrintJobInput {
  @Field(() => ID)
  printerId!: string;

  @Field(() => String)
  documentType!: string;

  @Field(() => String)
  refType!: string;

  @Field(() => String)
  refId!: string;

  @Field(() => String)
  image!: string;

  /** 缺席 / null = false(第一次列印)。 */
  @Field(() => Boolean, { nullable: true })
  isReprint?: boolean | null;

  /** 補印必填:欄位類別「補印原因」的選項值;非補印時忽略(寫 null)。 */
  @Field(() => String, { nullable: true })
  reprintReason?: string | null;

  /** 補印原因為 `other` 時必填;非補印時忽略(寫 null)。 */
  @Field(() => String, { nullable: true })
  reprintNote?: string | null;
}

/** 測試列印(`system.printers.edit`):印前端用版面零件組好的測試頁。 */
@InputType()
export class PrintPrinterTestPageInput {
  @Field(() => ID)
  printerId!: string;

  @Field(() => String)
  image!: string;
}

/** 一張單據的列印次數(`api.printing.print`)。 */
@InputType()
export class DocumentPrintCountInput {
  @Field(() => String)
  refType!: string;

  @Field(() => String)
  refId!: string;
}

/** 下載某平台的安裝檔(`system.printers.create`)。 */
@InputType()
export class PrintAgentDownloadUrlInput {
  @Field(() => PrintAgentPlatformEnum)
  platform!: PrintAgentPlatformEnum;
}
