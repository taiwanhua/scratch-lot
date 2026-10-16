import { Inject, Injectable, Optional } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { GraphQLError } from "graphql";
import type { ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";

import { OperatorContextService } from "../../../auth/operator-context.service";
import type { OperatorContext } from "../../../database/operator-context";
import { currentSession } from "../../../database/transaction";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import {
  FORM_LIFECYCLES,
  FORM_LIFECYCLE_NOTIFY,
  type FormEffectContext,
  type FormEffectName,
  type FormGuardName,
  type FormLifecycles,
  type LifecycleNotify,
  type LifecycleResolver,
  type LifecycleSubmission,
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

/** 事後動作要知道的單據(提交或實例都有這些欄位)。 */
export interface EffectSubject {
  submissionId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  orgId: Types.ObjectId;
  moduleKey: string;
  formKey: string;
  revision: number;
}

/** 守門擋下:`FORBIDDEN` + `reason` = 專案錯誤碼;使用者文案由前端依 reason 走 i18n。 */
export function lifecycleBlockedError(
  code: string,
  message: string,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason: code },
  });
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
 * 掛接點的執行(底座規格 3.1 B1;登記見 `form-lifecycle-registration.ts`):
 *
 * - `guard`:動作的交易內、寫入之前呼叫;沒登記 → 通過。擋下 → 拋 `lifecycleBlockedError`(交易回復,
 *   此時還沒有任何寫入)。守門的例外照樣往外拋(TX-04:不吞)
 * - `runApproveGuard`:`beforeApprove` 的單一入口(某人按核准、批次核准、B5 自動通過都呼叫它)
 * - `emit`:狀態改變後在同一個交易內呼叫事後動作(系統身分);拋錯往外拋 = 整個動作回復
 */
@Injectable()
export class FormLifecycleService {
  private readonly get: LifecycleResolver;

  constructor(
    @Inject(FORM_LIFECYCLES) private readonly lifecycles: FormLifecycles,
    private readonly operators: OperatorContextService,
    private readonly realtime: RealtimePublisher,
    moduleRef: ModuleRef,
    @Optional()
    @Inject(FORM_LIFECYCLE_NOTIFY)
    private readonly notifier: LifecycleNotify | null = null,
  ) {
    this.get = (token) => moduleRef.get(token, { strict: false });
  }

  async guard(name: FormGuardName, input: GuardInput): Promise<void> {
    const { submission } = input;
    const handler = this.lifecycles.lookup(
      submission.moduleKey,
      submission.formKey,
    )?.guards?.[name];
    if (handler === undefined) {
      return;
    }
    const blocked = await handler({
      guard: name,
      operator: input.operator,
      submission,
      values: input.values ?? submission.values,
      stepKey: input.stepKey ?? null,
      session: sessionOf(`守門 ${name}`),
      get: this.get,
    });
    if (blocked === null) {
      return;
    }
    if (!PROJECT_REASON_PATTERN.test(blocked.code)) {
      throw new Error(
        `守門 ${name}(${submission.moduleKey} / ${submission.formKey})回的錯誤碼「${blocked.code}」不是大寫英數與底線`,
      );
    }
    throw lifecycleBlockedError(blocked.code, blocked.message);
  }

  /** 核准的守門(單一入口;批次核准、B5 自動通過直接呼叫它)。 */
  runApproveGuard(input: ApproveGuardInput): Promise<void> {
    return this.guard("beforeApprove", input);
  }

  async emit(
    event: FormEffectName,
    subject: EffectSubject,
    detail: { stepKey?: string | null; skipped?: boolean } = {},
  ): Promise<void> {
    const handler = this.lifecycles.lookup(subject.moduleKey, subject.formKey)
      ?.effects?.[event];
    if (handler === undefined) {
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
      get: this.get,
      notify: (notification) => {
        if (this.notifier === null) {
          return Promise.reject(
            new Error(
              "notify() 尚未提供(通知後端沒有登記 FORM_LIFECYCLE_NOTIFY)",
            ),
          );
        }
        return this.notifier(notification);
      },
      realtime: {
        publishAfterCommit: (topics, signal) => {
          this.realtime.publishAfterCommit(subject.tenantId, topics, signal);
        },
      },
    };
    await handler(context);
  }
}
