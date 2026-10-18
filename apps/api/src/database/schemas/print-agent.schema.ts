import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";
import { tenantScopePlugin } from "../plugins/tenant-scope.plugin";

export const PRINT_AGENTS_COLLECTION = "print_agents";

/**
 * 列印三張表固定屬於印表機管理模組(`tenantScopePlugin` 的 `moduleData`;
 * 與 `apps/db-migrator/seeds/base/modules/system.ts` 的 `PRINTERS_KEY` 一致)。
 */
export const PRINTERS_MODULE_KEY = "system.printers";

/**
 * 店內代理程式(docs/modules/printers.md):裝在分店電腦上,
 * 主動向 API 拿列印工作。一家店通常一個;它只能領自己分店(`orgId`)印表機的工作。
 *
 * 金鑰與配對碼都**只存雜湊**(SHA-256;兩者都是高熵亂數,不需要慢雜湊):
 * - 配對碼:8 碼、10 分鐘,用過即清空(換到金鑰的那一次條件更新同時清掉)
 * - 金鑰:配對成功時產生,只回給代理程式一次;重新配對 / 停用時清空 = 立即失效
 */
@Schema({ collection: PRINT_AGENTS_COLLECTION, timestamps: true })
export class PrintAgent {
  /** 所在分店(租戶隔離,ADR-0005)。 */
  @Prop({ type: Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  /** 名稱(如「收銀電腦」)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** 長期代理程式金鑰的 SHA-256(hex);還沒配對 / 已撤銷為 null。 */
  @Prop({ type: String, default: null })
  keyHash!: string | null;

  /** 有效配對碼的 SHA-256(hex);沒有等待中的配對為 null。 */
  @Prop({ type: String, default: null })
  pairingCodeHash!: string | null;

  /** 配對碼到期時間。 */
  @Prop({ type: Date, default: null })
  pairingExpiresAt!: Date | null;

  /** 最後一次帶金鑰呼叫 API 的時間(輪詢、心跳、認領、回報);超過 2 分鐘 = 離線。 */
  @Prop({ type: Date, default: null })
  lastSeenAt!: Date | null;

  /** 代理程式回報的版本(semver);沒回報過為 null。 */
  @Prop({ type: String, default: null })
  version!: string | null;

  /** 停用 = 金鑰失效、旗下印表機不能選、等待中的工作標失敗;停用後不能再配對。 */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 模組 key(`tenantScopePlugin({ moduleData: true })` 宣告;固定 `PRINTERS_MODULE_KEY`)。 */
  moduleKey!: string;

  /** 租戶頂層 id(同上 plugin 宣告;`BaseRepository.create` 推導):即時信號送到哪個租戶。 */
  tenantId!: Types.ObjectId | null;
}

export const PrintAgentSchema = SchemaFactory.createForClass(PrintAgent);

PrintAgentSchema.index({ orgId: 1, createdAt: 1 });
// 以金鑰 / 配對碼的雜湊找代理程式(唯一;沒有值的不進索引)
PrintAgentSchema.index(
  { keyHash: 1 },
  { unique: true, partialFilterExpression: { keyHash: { $type: "string" } } },
);
PrintAgentSchema.index(
  { pairingCodeHash: 1 },
  {
    unique: true,
    partialFilterExpression: { pairingCodeHash: { $type: "string" } },
  },
);
PrintAgentSchema.plugin(baseFieldsPlugin);
PrintAgentSchema.plugin(tenantScopePlugin, { moduleData: true });
PrintAgentSchema.path("moduleKey").default(PRINTERS_MODULE_KEY);
