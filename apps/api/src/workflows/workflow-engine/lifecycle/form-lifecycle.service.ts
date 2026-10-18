import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { GraphQLError } from "graphql";
import type { ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";

import { OperatorContextService } from "../../../auth/operator-context.service";
import type { OperatorContext } from "../../../database/operator-context";
import { currentSession } from "../../../database/transaction";
import { NotificationService } from "../../../notifications/notification.service";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  FORM_LIFECYCLES,
  type FormEffectContext,
  type FormEffectName,
  type FormGuardName,
  type FormLifecycleRegistration,
  type FormLifecycles,
  type LifecycleResolver,
  type LifecycleSubmission,
  resolveLifecycleInjections,
} from "./form-lifecycle-registration";

/** 專案錯誤碼:大寫英數與底線(同底座的 reason)。 */
const PROJECT_REASON_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** 守門的輸入(`guard` 與 `session` 由這裡補)。 */
export interface GuardInput {
  operator: OperatorContext;
  submission: LifecycleSubmission;
  /** 這一版的值;不給 = 提交目前的值。 */
  values?: StoredValues;
  stepKey?: string | null;
}

/** `runApproveGuard` 的輸入:核准(某人按核准、批次核准的每一筆、B5 自動通過)都經它。 */
export interface ApproveGuardInput {
  operator: OperatorContext;
  submission: LifecycleSubmission;
  stepKey: string;
}

/** 守門擋下的結果(專案錯誤碼 + 訊息)。 */
export interface GuardBlocked {
  code: string;
  message: string;
}

/** 事後動作要知道的單據(提交或實例都有這些欄位)。 */
export interface EffectSubject {
  submissionId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  orgId: Types.ObjectId;
  moduleKey: string;
  formKey: string;
  revision: number;
}

/**
 * 守門擋下:`FORBIDDEN` + `reason` = 專案錯誤碼;使用者文案由前端依 reason 走 i18n。
 * 獨立的類別讓批次核准分得出「被守門擋下」與其他 `FORBIDDEN`(`projectReason` = 專案錯誤碼)。
 */
export class LifecycleBlockedError extends GraphQLError {
  constructor(
    readonly projectReason: string,
    message: string,
  ) {
    super(message, {
      extensions: { code: "FORBIDDEN", reason: projectReason },
    });
  }
}

export function lifecycleBlockedError(
  code: string,
  message: string,
): LifecycleBlockedError {
  return new LifecycleBlockedError(code, message);
}

function sessionOf(what: string): ClientSession {
  const session = currentSession();
  if (session === undefined) {
    // 掛接點只在動作的交易內呼叫;走到這裡是呼叫端的程式錯誤
    throw new Error(`${what} 只能在動作的交易內呼叫`);
  }
  return session;
}

/**
 * 掛接點的執行(登記見 `form-lifecycle-registration.ts`):
 *
 * - `guard`:動作的交易內、寫入之前呼叫;沒登記 → 通過。擋下 → 拋 `lifecycleBlockedError`(交易回復,
 *   此時還沒有任何寫入)。守門的例外照樣往外拋(TX-04:不吞)
 * - `runApproveGuard` / `checkApproveGuard`:`beforeApprove` 的入口(某人按核准、批次核准 → 擋下拋錯;
 *   B5 自動通過 → 擋下以回傳值表示,留給他照常審核)
 * - `emit`:狀態改變後在同一個交易內呼叫事後動作(系統身分);拋錯往外拋 = 整個動作回復
 */
@Injectable()
export class FormLifecycleService implements OnModuleInit {
  private resolvers: ReadonlyMap<FormLifecycleRegistration, LifecycleResolver> =
    new Map();

  constructor(
    @Inject(FORM_LIFECYCLES) private readonly lifecycles: FormLifecycles,
    private readonly operators: OperatorContextService,
    private readonly realtime: RealtimePublisher,
    private readonly moduleRef: ModuleRef,
    private readonly notifications: NotificationService,
  ) {}

  /** 啟動時解析每筆登記的 `inject`;宣告的 token 找不到 → app 起不來。 */
  onModuleInit(): void {
    this.resolvers = resolveLifecycleInjections(
      this.lifecycles.registrations,
      (token) => this.moduleRef.get(token, { strict: false }),
    );
  }

  private resolverOf(
    registration: FormLifecycleRegistration,
  ): LifecycleResolver {
    const resolver = this.resolvers.get(registration);
    if (resolver === undefined) {
      throw new Error(`掛接點 ${registration.moduleKey} 的 inject 尚未解析`);
    }
    return resolver;
  }

  async guard(name: FormGuardName, input: GuardInput): Promise<void> {
    const blocked = await this.check(name, input);
    if (blocked !== null) {
      throw lifecycleBlockedError(blocked.code, blocked.message);
    }
  }

  /**
   * 跑守門、回結果(不拋):通過 / 沒登記 → null;擋下 → 專案的錯誤碼與訊息。錯誤碼不合格、
   * handler 拋錯照樣往外拋(程式錯誤,不是「擋下」)。
   */
  private async check(
    name: FormGuardName,
    input: GuardInput,
  ): Promise<GuardBlocked | null> {
    const { submission } = input;
    const registration = this.lifecycles.lookup(
      submission.moduleKey,
      submission.formKey,
    );
    const handler = registration?.guards?.[name];
    if (registration === null || handler === undefined) {
      return null;
    }
    const blocked = await handler({
      guard: name,
      operator: input.operator,
      submission,
      values: input.values ?? submission.values,
      stepKey: input.stepKey ?? null,
      session: sessionOf(`守門 ${name}`),
      get: this.resolverOf(registration),
    });
    if (blocked === null) {
      return null;
    }
    if (!PROJECT_REASON_PATTERN.test(blocked.code)) {
      throw new Error(
        `守門 ${name}(${submission.moduleKey} / ${submission.formKey})回的錯誤碼「${blocked.code}」不是大寫英數與底線`,
      );
    }
    return { code: blocked.code, message: blocked.message };
  }

  /** 核准的守門(單一入口;某人按核准、批次核准的每一筆):擋下 → 拋 `lifecycleBlockedError`。 */
  runApproveGuard(input: ApproveGuardInput): Promise<void> {
    return this.guard("beforeApprove", input);
  }

  /**
   * 同一個 `beforeApprove`,但以回傳值表示擋下(B5 自動通過:擋下不是錯誤,是「停在這一關等人處理」,
   * 推進照常寫入)。
   */
  checkApproveGuard(input: ApproveGuardInput): Promise<GuardBlocked | null> {
    return this.check("beforeApprove", input);
  }

  async emit(
    event: FormEffectName,
    subject: EffectSubject,
    detail: { stepKey?: string | null; skipped?: boolean } = {},
  ): Promise<void> {
    const registration = this.lifecycles.lookup(
      subject.moduleKey,
      subject.formKey,
    );
    const handler = registration?.effects?.[event];
    if (registration === null || handler === undefined) {
      return;
    }
    const session = sessionOf(`事後動作 ${event}`);
    const context: FormEffectContext = {
      event,
      submissionId: subject.submissionId,
      tenantId: subject.tenantId,
      orgId: subject.orgId,
      moduleKey: subject.moduleKey,
      formKey: subject.formKey,
      revision: subject.revision,
      stepKey: detail.stepKey ?? null,
      skipped: detail.skipped ?? false,
      operator: await this.operators.systemOperatorOfOrg(subject.orgId),
      session,
      get: this.resolverOf(registration),
      notify: (input) => this.notifications.notify(input),
      realtime: {
        publishAfterCommit: (topics, signal) => {
          this.realtime.publishAfterCommit(subject.tenantId, topics, signal);
        },
      },
    };
    await handler(context);
  }
}
