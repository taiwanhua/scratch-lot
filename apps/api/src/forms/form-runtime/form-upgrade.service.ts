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
import type {
  BulkUpdateByIdItem,
  Persisted,
  RepositoryFilter,
  RepositoryUpdate,
} from "../../database/base.repository";
import {
  AuditLogsRepository,
  type FormSubmissionDocument,
  FormSubmissionsRepository,
  FormVersionsRepository,
} from "../../database/database.module";
import {
  type FormRevision,
  type FormSubmission,
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
import { sharedOrgIdsFor } from "../form-values/shared-org-ids";
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

/** 一批最多幾筆(每批先取 id 與大小,再在一個交易裡整批讀完整文件、整批條件更新)。 */
// 一批的完整文件會同時留在記憶體裡,取保守的 50(每批仍是 3 次往返)
export const UPGRADE_BATCH_SIZE = 50;

/** 一批的完整文件合計最多幾位元組(BSON);單筆就超過時自成一批。與筆數上限先到先切。 */
export const UPGRADE_BATCH_BYTES = 32 * 1024 * 1024;

/** 取 id 那次讀到的一筆:id 與存放的 BSON 大小。 */
export interface UpgradeBatchCandidate {
  _id: Types.ObjectId;
  size: number;
}

/**
 * 依序累加大小切出這一批:滿 `maxCount` 筆或再加一筆會超過 `maxBytes` 就停;
 * 第一筆一定收(單筆超過也自成一批,不會卡住)。回傳收進這批的筆數。
 */
export function upgradeBatchLength(
  candidates: readonly Pick<UpgradeBatchCandidate, "size">[],
  maxCount: number = UPGRADE_BATCH_SIZE,
  maxBytes: number = UPGRADE_BATCH_BYTES,
): number {
  let total = 0;
  let taken = 0;
  for (const candidate of candidates) {
    if (taken >= maxCount || (taken > 0 && total + candidate.size > maxBytes)) {
      break;
    }
    total += candidate.size;
    taken += 1;
  }
  return taken;
}

/** 整批寫回最多試幾次(筆數不符 = 有一筆被人同時改了,重讀再試);仍不符就改逐筆。 */
const BATCH_ATTEMPTS = 2;

const MAX_CLIENT_REQUEST_ID_LENGTH = 100;

/** 升級的對象狀態:草稿與不綁流程的已完成(走過流程的已完成鎖定、不動)。 */
const UPGRADABLE_STATUSES = ["draft", "completed"] as const;

/** 升級要用的表單與目標版。 */
interface UpgradeTarget {
  form: FormRecord;
  target: FormVersionRecord;
  targetVersion: number;
  /** 寫入範圍(可見範圍 + 資料範圍,不含共用分支):升級範圍只含寫得到的。 */
  writable: RepositoryFilter<FormSubmission>;
}

/** 一筆的結果:升級了(從哪一版)或跳過(原因)。 */
type UpgradeOutcome =
  | { kind: "upgraded"; fromVersion: number }
  | { kind: "skipped"; reason: FormUpgradeSkipReason };

/** 一筆算好的升級:跳過(原因),或要寫回的條件與更新。 */
type PlannedUpgrade =
  | { kind: "skipped"; reason: FormUpgradeSkipReason }
  | {
      kind: "write";
      fromVersion: number;
      filter: RepositoryFilter<FormSubmission>;
      update: RepositoryUpdate<FormSubmission>;
    };

/** 整批寫回筆數不符(`bulkUpdateByIds` 的 `CONFLICT` / `EDIT_VERSION_MISMATCH`)。 */
function isWriteCountConflict(error: unknown): boolean {
  return (
    error instanceof GraphQLError &&
    error.extensions.code === "CONFLICT" &&
    error.extensions.reason === "EDIT_VERSION_MISMATCH"
  );
}

/**
 * 舊版資料升級到新版(只限沒綁流程的表單,`docs/modules/forms.md`「舊版資料升級」):
 * **改綁版本 + 補值 + 重算,不驗證**。
 *
 * - 守門:表單讀得到(設計端)→ 模組 `edit` → 目標版已發布 → 本租戶沒綁流程(`FORM_HAS_WORKFLOW`)
 * - 範圍:操作者寫得到(可見範圍 + 資料範圍;依欄位共用過來的唯讀資料不含)、本租戶(root 在根組織 = 根組織自己的資料)、
 *   狀態草稿 / 不綁流程的已完成、版本不是目標版
 * - 每一筆:`upgradeValues`(與複製為新單共用搬值)→ 現有的 settle(計算欄位、隱藏當 null)→ 已完成重算摘要、
 *   修訂 +1(`version` = 目標版、`ctx` 沿用上一筆修訂、`kind: "upgrade"`,誰與何時升級記在 `upgradedBy` / `upgradedAt`)→ 改綁;草稿只改綁與重算(草稿沒有修訂)
 * - 條件更新帶讀到的 `editVersion` 與 `version`:被人同時改的、超過容量的跳過並計數;已是目標版的不在範圍內(冪等)
 * - **每批一個交易**(ADR-0013):一批裡的改綁一起提交或一起回復;中途失敗時已提交的批次留著
 *   (已是目標版、不在範圍內),再送一次只處理剩下的
 * - **整批讀寫**(TX-06):一批一次 `findMany` 讀完整文件、缺的版本定義一次讀、一次 `bulkUpdateByIds` 寫回;
 *   算值(`evaluate` 草稿模式)不讀資料庫。整批寫回筆數不符(有一筆被人改了)→ 整批回復、重讀這批再跑一次;
 *   仍不符 → 這批改逐筆升級,衝突的那一筆跳過(`EDIT_CONFLICT`)、其他照升
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
      const candidates = await this.batchCandidates(facts, upgrade, lastId);
      const batch = candidates.slice(0, upgradeBatchLength(candidates));
      // 計數在交易提交後才累加:寫入衝突時整批自動重跑,不能把丟掉的那一輪算進去
      const outcomes = await this.upgradeIds(
        facts,
        upgrade,
        batch.map(({ _id }) => _id),
        fills,
        sources,
      );
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
      // 因大小提早切批時後面還有;沒切而且不滿筆數上限 = 已讀到尾
      if (
        last === undefined ||
        (batch.length === candidates.length &&
          candidates.length < UPGRADE_BATCH_SIZE)
      ) {
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
    const writable = await this.submissions.writableFilterOf(facts.operator);
    return { form, target, targetVersion, writable };
  }

  /**
   * 升級範圍:讀取中介層照套,再收窄到寫入範圍(可見範圍 + 資料範圍)—— 別組織依欄位共用過來的
   * 唯讀資料不在範圍內(不算進計畫筆數,也不會讓整批寫回筆數不符)。
   */
  private scopeOf(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
  ): Record<string, unknown> {
    return {
      ...upgrade.writable,
      formKey: upgrade.form.key,
      // 只動本租戶的資料:root 在根組織 = 根組織自己的(租戶 = null)
      tenantId: facts.tenantId,
      version: { $ne: upgrade.targetVersion },
      status: { $in: UPGRADABLE_STATUSES },
      currentInstanceId: null,
    };
  }

  /**
   * 下一批的候選:id 與存放的 BSON 大小(`$bsonSize`,MongoDB 4.4+),最多 `UPGRADE_BATCH_SIZE` 筆。
   * 一次 aggregate 取回,不讀完整文件;切批由 `upgradeBatchLength` 依大小決定。
   */
  private async batchCandidates(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    lastId: Types.ObjectId | null,
  ): Promise<UpgradeBatchCandidate[]> {
    const rows = await this.submissions.aggregate(facts.operator, [
      {
        $match: {
          ...this.scopeOf(facts, upgrade),
          ...(lastId === null ? {} : { _id: { $gt: lastId } }),
        },
      },
      { $sort: { _id: 1 } },
      { $limit: UPGRADE_BATCH_SIZE },
      { $project: { _id: 1, size: { $bsonSize: "$ROOT" } } },
    ]);
    return rows.map((row) => ({
      _id: row._id as Types.ObjectId,
      size: row.size as number,
    }));
  }

  /** 各舊版本的筆數(版本小的在前;0 筆的不列)。一次 aggregate 分組計數,不逐版本 count(TX-07)。 */
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
    const versions = others
      .map((other) => other.version)
      .filter((version): version is number => version !== null);
    if (versions.length === 0) {
      return [];
    }
    const rows = await this.submissions.aggregate(facts.operator, [
      {
        $match: {
          ...this.scopeOf(facts, upgrade),
          version: { $in: versions },
        },
      },
      { $group: { _id: "$version", count: { $sum: 1 } } },
    ]);
    const countOf = new Map(
      rows.map((row) => [row._id as number, row.count as number]),
    );
    return versions.flatMap((fromVersion) => {
      const count = countOf.get(fromVersion) ?? 0;
      return count > 0 ? [{ fromVersion, count }] : [];
    });
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

  /**
   * 一批 id 升級,一個交易:先整批讀寫;整批寫回筆數不符 → 重讀這批再試一次;仍不符 → 改逐筆
   * (一筆衝突跳過、其他照升,與整批之前的語意相同)。已不在範圍內(剛被改綁 / 刪)的回 null。
   */
  private async upgradeIds(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    ids: readonly Types.ObjectId[],
    fills: StoredValues,
    sources: Map<number, FormVersionRecord>,
  ): Promise<(UpgradeOutcome | null)[]> {
    for (let attempt = 0; attempt < BATCH_ATTEMPTS; attempt += 1) {
      try {
        return await this.transactions.withTransaction(() =>
          this.upgradeBatch(facts, upgrade, ids, fills, sources),
        );
      } catch (error) {
        if (!isWriteCountConflict(error)) {
          throw error;
        }
      }
    }
    return this.transactions.withTransaction(async () => {
      const results: (UpgradeOutcome | null)[] = [];
      for (const id of ids) {
        results.push(await this.upgradeOne(facts, upgrade, id, fills, sources));
      }
      return results;
    });
  }

  /**
   * 整批:一次讀完整文件 → 缺的版本定義一次讀 → 逐筆算(不讀資料庫)→ 一次 `bulkUpdateByIds`
   * (筆數不符整批拋 `CONFLICT`、交易回復)。
   */
  private async upgradeBatch(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    ids: readonly Types.ObjectId[],
    fills: StoredValues,
    sources: Map<number, FormVersionRecord>,
  ): Promise<(UpgradeOutcome | null)[]> {
    const records = await this.submissions.findMany(facts.operator, {
      ...this.scopeOf(facts, upgrade),
      _id: { $in: ids },
    });
    await this.loadSources(facts, upgrade, records, sources);
    const byId = new Map(records.map((record) => [String(record._id), record]));
    const outcomes: (UpgradeOutcome | null)[] = [];
    const items: BulkUpdateByIdItem<FormSubmission>[] = [];
    for (const id of ids) {
      const record = byId.get(String(id));
      if (!record) {
        outcomes.push(null);
        continue;
      }
      const planned = await this.planOne(
        facts,
        upgrade,
        record,
        fills,
        this.sourceOf(record, sources),
      );
      if (planned.kind === "skipped") {
        outcomes.push(planned);
        continue;
      }
      items.push({
        id: record._id,
        filter: planned.filter,
        update: planned.update,
      });
      outcomes.push({ kind: "upgraded", fromVersion: planned.fromVersion });
    }
    await this.submissions.bulkUpdateByIds(facts.operator, items);
    return outcomes;
  }

  /** 逐筆(整批衝突後的退路):讀完整文件 → 算 → 條件更新;沒命中 = 被人同時改了,跳過。 */
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
    await this.loadSources(facts, upgrade, [record], sources);
    const planned = await this.planOne(
      facts,
      upgrade,
      record,
      fills,
      this.sourceOf(record, sources),
    );
    if (planned.kind === "skipped") {
      return planned;
    }
    const updated = await this.submissions.findOneAndUpdate(
      facts.operator,
      { ...planned.filter, _id: record._id },
      planned.update,
    );
    if (!updated) {
      return { kind: "skipped", reason: "EDIT_CONFLICT" };
    }
    return { kind: "upgraded", fromVersion: planned.fromVersion };
  }

  /** 一筆:搬值 + 補值 → 重算 → 容量檢查 → 寫回的條件與更新(不讀寫資料庫)。 */
  private async planOne(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    record: SubmissionRecord,
    fills: StoredValues,
    source: FormVersionRecord,
  ): Promise<PlannedUpgrade> {
    const at = new Date();
    // 重算用這筆資料自己的上下文(不是操作者此刻):`ctx.now` / `ctx.user` 的計算欄位與條件升級後不變
    const ctx = this.contextOf(facts, record);
    const target = upgrade.target;
    let values: StoredValues;
    try {
      // 草稿模式不讀資料庫:類別 / lookup 的快照只在 `complete` 模式重取
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
    const filter: RepositoryFilter<FormSubmission> = {
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
    // 依欄位共用跟著升級後的值重算(目標版沒有那一欄 = 不再共用)
    const sharedOrgIds = sharedOrgIdsFor(upgrade.form, values, record.status);
    const update: RepositoryUpdate<FormSubmission> = isCompleted
      ? {
          ...revisionsUpdate,
          $set: {
            values,
            summary,
            revision,
            version: upgrade.targetVersion,
            sharedOrgIds,
            ...("$set" in revisionsUpdate ? revisionsUpdate.$set : {}),
          },
          $inc: { editVersion: 1 },
        }
      : {
          $set: {
            values,
            version: upgrade.targetVersion,
            sharedOrgIds,
            touched: touchedKeysOf(target.fields, record.touched),
          },
          $inc: { editVersion: 1 },
        };
    return { kind: "write", fromVersion: record.version, filter, update };
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

  /** 這些資料綁的版本定義,快取裡沒有的一次讀進來(同一次升級內快取)。 */
  private async loadSources(
    facts: FormOperatorFacts,
    upgrade: UpgradeTarget,
    records: readonly SubmissionRecord[],
    sources: Map<number, FormVersionRecord>,
  ): Promise<void> {
    const missing = [
      ...new Set(
        records
          .map((record) => record.version)
          .filter((version) => !sources.has(version)),
      ),
    ];
    if (missing.length === 0) {
      return;
    }
    const found = await this.versions.findMany(facts.operator, {
      formKey: upgrade.form.key,
      version: { $in: missing },
    });
    for (const source of found) {
      if (source.version !== null) {
        sources.set(source.version, source);
      }
    }
  }

  /** 這筆目前綁的版本定義(`loadSources` 讀過的)。 */
  private sourceOf(
    record: SubmissionRecord,
    sources: ReadonlyMap<number, FormVersionRecord>,
  ): FormVersionRecord {
    const source = sources.get(record.version);
    if (!source) {
      throw new Error(
        `提交 ${String(record._id)} 綁的版本 ${record.formKey}@${String(record.version)} 不存在`,
      );
    }
    return source;
  }
}
