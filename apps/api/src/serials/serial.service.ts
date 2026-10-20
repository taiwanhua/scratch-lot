import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  type SerialFormat,
  formatSerial,
  serialPeriodKeyOf,
} from "@repo/domain/form";

import { OrgsRepository } from "../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../database/operator-context";
import { TenantScopeError } from "../database/plugins/tenant-scope.plugin";
import { SerialCountersStore } from "../database/serial-counters.store";
import { tenantTimezoneOf } from "../database/tenant-timezone";
import { currentSession } from "../database/transaction";

export interface NextSerialOptions {
  /** 給號的時點(期間依它在租戶時區的當地日期切);缺席 = 現在。測試與補單注入。 */
  at?: Date;
  /**
   * 這張單歸屬的組織(單號依它的租戶分開計數);缺席 = 操作者的當前組織。
   * 必須在操作者的可見範圍內(取號的人就是建這張單的人)。
   */
  orgId?: Types.ObjectId;
  /** 交易的 session;缺席 = 目前進行中交易的(交易回復,這次取的號也回復)。 */
  session?: ClientSession | null;
}

/**
 * **單號**(`CONTEXT.md`「單號」;ADR-0015):底座共用的編號,格式由宣告給(`SerialFormat`)。
 *
 * - 各租戶分開計數(依單據歸屬組織的租戶),依期間(`none` / `year` / `month`)重新起算,期間以**租戶時區**切
 * - 計數器以 `$inc` + upsert 原子取號:同時取號不重複、連號;在交易內取號,交易回復就連號碼一起回復
 * - 表單在第一次送出時呼叫(`form:<formKey>`);非表單資料在新增時直接呼叫,`key` 自取(在同一個租戶內唯一)
 *
 * 操作者可以是登入的人,也可以是排程的租戶系統身分(`systemTenantReader`,當前組織 = 租戶頂層)。
 */
@Injectable()
export class SerialService {
  constructor(
    private readonly counters: SerialCountersStore,
    private readonly orgs: OrgsRepository,
  ) {}

  async next(
    operator: OperatorContext,
    key: string,
    format: SerialFormat,
    options: NextSerialOptions = {},
  ): Promise<string> {
    const orgId = options.orgId ?? operator.currentOrgId;
    if (orgId === null) {
      throw new TenantScopeError(`單號 ${key}:需要單據歸屬的組織`);
    }
    if (!isOrgVisible(operator, orgId)) {
      throw new TenantScopeError(`單號 ${key}:單據歸屬的組織不在可見範圍內`);
    }
    if (key.trim() === "") {
      throw new TenantScopeError("單號的 key 不可空白");
    }
    const session =
      options.session === undefined
        ? (currentSession() ?? null)
        : options.session;
    const tenantId = await this.counters.tenantIdOfOrg(orgId, session);
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    const at = options.at ?? new Date();
    const period = serialPeriodKeyOf(format.period, at.getTime(), timezone);
    const sequence = await this.counters.next(tenantId, key, period, session);
    return formatSerial(format, period, sequence);
  }
}
