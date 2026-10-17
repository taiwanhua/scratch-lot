import { Injectable } from "@nestjs/common";
import { GraphQLError } from "graphql";
import type { Types } from "mongoose";

import {
  type FieldDef,
  type StoredValues,
  type ValueIssue,
  computeSummary,
  normalizeFieldValue,
  upgradeFillTargets,
  upgradeValues,
} from "@repo/domain/form";

import { AuditService } from "../../audit/audit.service";
import type { Persisted } from "../../database/base.repository";
import {
  AuditLogsRepository,
  type FormSubmissionDocument,
  FormSubmissionsRepository,
  FormVersionsRepository,
} from "../../database/database.module";
import {
  type FormRevision,
  revisionVersionOf,
} from "../../database/schemas/form-submission.schema";
import { TransactionService } from "../../database/transaction";
import { fieldGateOf } from "../field-permission-gate";
import {
  FormAccessService,
  type FormOperatorFacts,
  type FormRecord,
} from "../form-access.service";
import type { FormVersionRecord } from "../form-mapper";
import { SubmissionValuesService } from "../form-values/submission-values.service";
import { storedSummaryOf } from "../form-values/temporal-values";
import {
  conflictError,
  validationError,
  valuesInvalidError,
} from "../forms-error";
import type { UpgradeFormSubmissionsInput } from "./dto/form-runtime.input";
import {
  SUBMISSION_AUDIT,
  definitionOf,
  touchedKeysOf,
} from "./form-submissions.service";
import {
  type FormUpgradeGroup,
  type FormUpgradePayload,
  type FormUpgradePlan,
  type FormUpgradeSkipReason,
} from "./models/form-upgrade.model";
import { expressionContextOf } from "./revision-context";
import { assertSubmissionCapacity } from "./revision-limits";

type SubmissionRecord = Persisted<FormSubmissionDocument>;

/** 一批處理幾筆(每批先取 id,再在一個交易裡逐筆讀完整文件、條件更新)。 */
export const UPGRADE_BATCH_SIZE = 200;

const MAX_CLIENT_REQUEST_ID_LENGTH = 100;

/** 升級的對象狀態:草稿與不綁流程的已完成(走過流程的已完成鎖定、不動)。 */
const UPGRADABLE_STATUSES = ["draft", "completed"] as const;

/** 升級要用的表單與目標版。 */
interface UpgradeTarget {
  form: FormRecord;
  target: FormVersionRecord;
  targetVersion: number;
}

/** 一筆的結果:升級了(從哪一版)或跳過(原因)。 */
type UpgradeOutcome =
  | { kind: "upgraded"; fromVersion: number }
  | { kind: "skipped"; reason: FormUpgradeSkipReason };

/**
 * 舊版資料升級到新版(只限沒綁流程的表單,`docs/modules/forms.md`「舊版資料升級」):
 * **改綁版本 + 補值 + 重算,不驗證**。
 *
 * - 守門:表單讀得到(設計端)→ 模組 `edit` → 目標版已發布 → 本租戶沒綁流程(`FORM_HAS_WORKFLOW`)
 * - 範圍:操作者看得到(可見範圍 + 資料範圍)、本租戶(root 在根組織 = 根組織自己的資料)、
 *   狀態草稿 / 不綁流程的已完成、版本不是目標版
 * - 逐筆:`upgradeValues`(與複製為新單共用搬值)→ 現有的 settle(計算欄位、隱藏當 null)→ 已完成重算摘要、
 *   修訂 +1(`version` = 目標版、`ctx` 沿用上一筆修訂、`kind: "upgrade"`,誰與何時升級記在 `upgradedBy` / `upgradedAt`)→ 改綁;草稿只改綁與重算(草稿沒有修訂)
 * - 條件更新帶讀到的 `editVersion` 與 `version`:被人同時改的、超過容量的跳過並計數;已是目標版的不在範圍內(冪等)
 * - **每批一個交易**(ADR-0013):一批裡的改綁一起提交或一起回復;中途失敗時已提交的批次留著
 *   (已是目標版、不在範圍內),再送一次只處理剩下的
 * - 同 `(操作者, clientRequestId)` 重送回第一次的結果(記在稽核 `submission.upgrade` 那一筆)
 */
@Injectable()
export class FormUpgradeService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly versions: FormVersionsRepository,
    private readonly access: FormAccessService,
    private readonly values: SubmissionValuesService,
    private readonly audit: AuditService,
    private readonly auditLogs: AuditLogsRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** 各舊版本的筆數 + 補值欄位(守門同 `upgrade`)。 */
  async plan(
    facts: FormOperatorFacts,
    formKey: string,
    targetVersion: number,
  ): Promise<FormUpgradePlan> {
    const upgrade = await this.guard(facts, formKey, targetVersion);
    const groups = await this.groupsOf(facts, upgrade);
    const fillTargets = await this.fillTargetsOf(facts, upgrade, groups);
    return {
      groups,
      fillTargets: fillTargets as unknown as Record<string, unknown>[],
    };
  }

  async upgrade(
    facts: FormOperatorFacts,
    input: UpgradeFormSubmissionsInput,
  ): Promise<FormUpgradePayload> {
    const clientRequestId = input.clientRequestId.trim();
    if (
      clientRequestId === "" ||
      clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH
    ) {
      throw validationError("clientRequestId must be 1-100 characters", [
        "clientRequestId",
      ]);
    }
    const upgrade = await this.guard(facts, input.formKey, input.targetVersion);
    const replayed = await this.replayOf(
      facts,
      upgrade,
      input.targetVersion,
      clientRequestId,
    );
    if (replayed) {
      return replayed;
    }
    const groups = await this.groupsOf(facts, upgrade);
    const fills = await this.normalizedFills(
      facts,
      upgrade,
      await this.fillTargetsOf(facts, upgrade, groups),
      input.fills,
    );

    const upgraded = new Map<number, number>();
    const skipped = new Map<FormUpgradeSkipReason, number>();
    const sources = new Map<number, FormVersionRecord>();
    let lastId: Types.ObjectId | null = null;
    for (;;) {
      const batch: SubmissionRecord[] = await this.submissions.findMany(
        facts.operator,
        {
          ...this.scopeOf(facts, upgrade),
          ...(lastId === null ? {} : { _id: { $gt: lastId } }),
        },
        { select: "_id", sort: { _id: 1 }, limit: UPGRADE_BATCH_SIZE },
      );
      // 計數在交易提交後才累加:寫入衝突時整批自動重跑,不能把丟掉的那一輪算進去
      const outcomes = await this.transactions.withTransaction(async () => {
        const results: (UpgradeOutcome | null)[] = [];
        for (const { _id } of batch) {
          results.push(
            await this.upgradeOne(facts, upgrade, _id, fills, sources),
          );
        }
        return results;
      });
      for (const outcome of outcomes) {
        if (outcome?.kind === "upgraded") {
          upgraded.set(
            outcome.fromVersion,
            (upgraded.get(outcome.fromVersion) ?? 0) + 1,
          );
        } else if (outcome?.kind === "skipped") {
          skipped.set(outcome.reason, (skipped.get(outcome.reason) ?? 0) + 1);
        }
      }
      const last = batch.at(-1);
      if (last === undefined || batch.length < UPGRADE_BATCH_SIZE) {
        break;
      }
      lastId = last._id;
    }

    const result: FormUpgradePayload = {
      upgraded: [...upgraded]
        .toSorted(([a], [b]) => a - b)
        .map(([fromVersion, count]) => ({ fromVersion, count })),
      skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    };
    await this.audit.record(facts.operator, {
      action: SUBMISSION_AUDIT.upgrade,
      targetType: "form",
      targetId: upgrade.form._id,
      after: {
        formKey: upgrade.form.key,
        targetVersion: upgrade.targetVersion,
        clientRequestId,
        upgraded: result.upgraded,
        skipped: result.skipped,
        fillKeys: Object.keys(fills),
      },
    });
    return result;
  }

  // ---- 內部 ----

  /** 守門順序:表單讀得到 → 模組 `edit` → 目標版已發布 → 本租戶沒綁流程。 */
  private async guard(
    facts: FormOperatorFacts,
    formKey: string,
    targetVersion: number,
  ): Promise<UpgradeTarget> {
    const form = await this.access.requireReadableForm(facts, formKey);
    this.access.assertModulePermission(facts, form.moduleKey, "edit");
    const target = await this.versions.findOne(facts.operator, {
      formKey: form.key,
      version: targetVersion,
      status: "published",
    });
    if (target === null) {
      throw conflictError(
        `Form version ${formKey}@${String(targetVersion)} is not published`,
        "VERSION_NOT_PUBLISHED",
      );
    }
    if (await this.access.hasWorkflowBinding(facts.tenantId, form._id)) {
      throw conflictError(
        `Form ${formKey} has a workflow bound in this tenant`,
        "FORM_HAS_WORKFLOW",
      );
    }
    return { form, target, targetVersion };
  }

  /** 升級範圍(`findMany` / `count` 再疊上可見範圍與資料範圍)。 */
  private scopeOf(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
  ): Record<string, unknown> {
    return {
      formKey: upgrade.form.key,
      // 只動本租戶的資料:root 在根組織 = 根組織自己的(租戶 = null)
      tenantId: facts.tenantId,
      version: { $ne: upgrade.targetVersion },
      status: { $in: UPGRADABLE_STATUSES },
      currentInstanceId: null,
    };
  }

  /** 各舊版本的筆數(版本小的在前;0 筆的不列)。 */
  private async groupsOf(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
  ): Promise<FormUpgradeGroup[]> {
    const others = await this.versions.findMany(
      facts.operator,
      {
        formKey: upgrade.form.key,
        version: { $ne: upgrade.targetVersion },
        status: { $in: ["published", "retired"] },
      },
      { select: "version", sort: { version: 1 } },
    );
    const groups: FormUpgradeGroup[] = [];
    for (const other of others) {
      if (other.version === null) {
        continue;
      }
      const count = await this.submissions.count(facts.operator, {
        ...this.scopeOf(facts, upgrade),
        version: other.version,
      });
      if (count > 0) {
        groups.push({ fromVersion: other.version, count });
      }
    }
    return groups;
  }

  /** 補值欄位:`upgradeFillTargets` 再篩操作者改得動的欄位。 */
  private async fillTargetsOf(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    groups: readonly FormUpgradeGroup[],
  ): Promise<FieldDef[]> {
    const sources = await this.versions.findMany(facts.operator, {
      formKey: upgrade.form.key,
      version: { $in: groups.map((group) => group.fromVersion) },
    });
    const gate = fieldGateOf(facts, upgrade.form.moduleKey, upgrade.form.key);
    const targetFields = upgrade.target.fields;
    return upgradeFillTargets(definitionOf(upgrade.target), sources).filter(
      (field) => gate.canEdit(targetFields, field),
    );
  }

  /**
   * 補值照型別正規化成存值,單選 / 多選再重取選項 label、驗選項存在(每欄一次);不合法 →
   * `VALIDATION_FAILED`(`fieldErrors`)。不是目標版的使用者填欄位 → `VALIDATION_FAILED`(`fills`);
   * 是目標版的使用者填欄位、但不在這一刻的補值清單內(計畫查完之後清單變了、或操作者改不動)→ 忽略。
   */
  private async normalizedFills(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    targets: readonly FieldDef[],
    fills: Record<string, unknown>,
  ): Promise<StoredValues> {
    const normalized: StoredValues = {};
    const issues: ValueIssue[] = [];
    const fields: FieldDef[] = [];
    for (const [key, raw] of Object.entries(fills)) {
      const isTargetInput = upgrade.target.fields.some(
        (field) => field.key === key && field.valueSource.kind === "input",
      );
      if (!isTargetInput) {
        throw validationError(
          `Field ${key} is not an input field of the target version`,
          ["fills"],
        );
      }
      const field = targets.find((target) => target.key === key);
      if (field === undefined || raw === null || raw === undefined) {
        continue;
      }
      const result = normalizeFieldValue(field, raw, facts.timezone);
      if (result.ok) {
        normalized[key] = result.value;
        fields.push(field);
      } else {
        issues.push(result.issue);
      }
    }
    if (issues.length > 0) {
      throw valuesInvalidError(issues);
    }
    const snapshot = await this.values.snapshotChoices(
      facts,
      fields,
      normalized,
    );
    if (snapshot.issues.length > 0) {
      throw valuesInvalidError(snapshot.issues);
    }
    return snapshot.values;
  }

  /**
   * 同一張表單、同 `(操作者, clientRequestId)` 已升級過 → 回那次記下的結果(守門之後才查;走稽核的
   * `{ targetType, targetId }` 索引);同一個 id 拿去升級這張表單的另一版 → 409。
   * 只保證資料不重複處理,不保證重送的結果與當下的資料一致(之後別人改的不會反映)。
   */
  private async replayOf(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    targetVersion: number,
    clientRequestId: string,
  ): Promise<FormUpgradePayload | null> {
    const actorId = facts.operator.actorId;
    if (actorId === null) {
      return null;
    }
    const log = await this.auditLogs.findOne(facts.operator, {
      targetType: "form",
      targetId: upgrade.form._id,
      action: SUBMISSION_AUDIT.upgrade,
      actorId,
      "after.clientRequestId": clientRequestId,
    });
    if (!log) {
      return null;
    }
    const after = (log.after ?? {}) as {
      targetVersion?: number;
      upgraded?: FormUpgradeGroup[];
      skipped?: FormUpgradePayload["skipped"];
    };
    if (after.targetVersion !== targetVersion) {
      throw conflictError(
        `clientRequestId ${clientRequestId} was already used`,
        "CLIENT_REQUEST_REUSED",
      );
    }
    return { upgraded: after.upgraded ?? [], skipped: after.skipped ?? [] };
  }

  /** 一筆:讀完整文件 → 搬值 + 補值 → 重算 → 條件更新;已不在範圍內(剛被改綁 / 刪)回 null。 */
  private async upgradeOne(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    id: Types.ObjectId,
    fills: StoredValues,
    sources: Map<number, FormVersionRecord>,
  ): Promise<UpgradeOutcome | null> {
    const record = await this.submissions.findOne(facts.operator, {
      ...this.scopeOf(facts, upgrade),
      _id: id,
    });
    if (!record) {
      return null;
    }
    const source = await this.sourceOf(facts, record, sources);
    const at = new Date();
    // 重算用這筆資料自己的上下文(不是操作者此刻):`ctx.now` / `ctx.user` 的計算欄位與條件升級後不變
    const ctx = this.contextOf(facts, record);
    const target = upgrade.target;
    let values: StoredValues;
    try {
      ({ values } = await this.values.evaluate({
        facts,
        moduleKey: record.moduleKey,
        formKey: record.formKey,
        fields: target.fields,
        base: upgradeValues(
          definitionOf(source),
          definitionOf(target),
          record.values,
          fills,
        ),
        sent: null,
        previous: null,
        ctx: expressionContextOf(ctx),
        // 不驗證:只做型別層與重算(計算欄位、摘要槽、隱藏當 null),規則留到下次編輯送出
        mode: "draft",
      }));
    } catch (error) {
      if (error instanceof GraphQLError) {
        return { kind: "skipped", reason: "VALUES_INVALID" };
      }
      throw error;
    }
    const isCompleted = record.status === "completed";
    const summary = isCompleted
      ? storedSummaryOf(
          computeSummary(definitionOf(target), values, {
            submittedAt: (record.submittedAt ?? ctx.at).toISOString(),
          }),
        )
      : null;
    const revision = record.revision + 1;
    const entry: FormRevision = {
      revision,
      version: upgrade.targetVersion,
      values,
      // ctx 沿用上一筆修訂(歷史重算條件用);誰、何時升級另記
      ctx,
      kind: "upgrade",
      upgradedBy: facts.operator.actorId,
      upgradedAt: at,
    };
    try {
      assertSubmissionCapacity(
        record,
        isCompleted
          ? { set: { values, summary }, pushRevision: entry }
          : { set: { values } },
        // guard 已確認本租戶沒綁流程:不限修訂次數,只看容量
        { isWorkflowBound: false },
      );
    } catch (error) {
      if (error instanceof GraphQLError) {
        return { kind: "skipped", reason: "DOCUMENT_TOO_LARGE" };
      }
      throw error;
    }
    const filter = {
      _id: record._id,
      status: record.status,
      version: record.version,
      editVersion: record.editVersion,
      currentInstanceId: null,
    };
    // 還沒有 `version` 的舊修訂(遷移還沒跑到)在同一次條件更新補成改綁前的版本,否則改綁後會被當成新版渲染。
    // 有要補的就整個 `revisions` 換掉(`$[legacy]` 與 `$push` 同一次更新會衝突;條件含 editVersion,不會蓋掉別人的)
    const legacy = record.revisions.some((item) => item.version === undefined);
    const revisionsUpdate = legacy
      ? {
          $set: {
            revisions: [
              ...record.revisions.map((item) => ({
                ...item,
                version: revisionVersionOf(record, item),
              })),
              entry,
            ],
          },
        }
      : { $push: { revisions: entry } };
    const updated = await this.submissions.findOneAndUpdate(
      facts.operator,
      filter,
      isCompleted
        ? {
            ...revisionsUpdate,
            $set: {
              values,
              summary,
              revision,
              version: upgrade.targetVersion,
              ...("$set" in revisionsUpdate ? revisionsUpdate.$set : {}),
            },
            $inc: { editVersion: 1 },
          }
        : {
            $set: {
              values,
              version: upgrade.targetVersion,
              touched: touchedKeysOf(target.fields, record.touched),
            },
            $inc: { editVersion: 1 },
          },
    );
    if (!updated) {
      return { kind: "skipped", reason: "EDIT_CONFLICT" };
    }
    return { kind: "upgraded", fromVersion: record.version };
  }

  /**
   * 重算用的上下文 = 這筆資料自己的:已完成 = 最後一筆修訂的 `ctx`;草稿(沒有修訂)= 建立者、建立時間、
   * 資料歸屬組織,時區用本租戶的(升級範圍限本租戶)。
   */
  private contextOf(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
  ): FormRevision["ctx"] {
    const latest = record.revisions.at(-1);
    if (latest) {
      return latest.ctx;
    }
    return {
      at: record.createdAt,
      timezone: facts.timezone,
      userId: record.createdBy,
      orgId: record.orgId,
    };
  }

  /** 這筆目前綁的版本定義(同一次升級內快取)。 */
  private async sourceOf(
    facts: FormOperatorFacts,
    record: SubmissionRecord,
    sources: Map<number, FormVersionRecord>,
  ): Promise<FormVersionRecord> {
    const cached = sources.get(record.version);
    if (cached) {
      return cached;
    }
    const source = await this.versions.findOne(facts.operator, {
      formKey: record.formKey,
      version: record.version,
    });
    if (!source) {
      throw new Error(
        `提交 ${String(record._id)} 綁的版本 ${record.formKey}@${String(record.version)} 不存在`,
      );
    }
    sources.set(record.version, source);
    return source;
  }
}
