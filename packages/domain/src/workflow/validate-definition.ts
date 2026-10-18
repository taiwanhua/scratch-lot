import { validateAudience } from "../audience/schema";
import type { Audience } from "../audience/types";
import { FIELD_KEY_PATTERN } from "../form/keys";
import type { FieldDef } from "../form/types";
import {
  APPROVER_AUDIENCE_OPTIONS,
  audienceFormFieldRefsOf,
  audienceLeavesOf,
  sharedAudienceViolations,
} from "./approver-audience";
import {
  assigneeFieldProblem,
  audienceOrgFieldProblem,
  skipWhenProblems,
} from "./form-refs";
import { hasEdges } from "./graph";
import {
  WorkflowIssueCollector,
  type WorkflowIssueLocation,
  type WorkflowValidationReport,
} from "./issues";
import {
  APPROVAL_MODES,
  ASSIGNEE_KINDS,
  type AssigneeSource,
  type OverdueReminderDef,
  REVIEW_STEP_PROPS,
  type ReviewStepDef,
  SKIP_ORG_TENANT,
  STEP_KINDS,
  type StepDef,
  type WorkflowDefinition,
  isJoinStep,
} from "./types";
import { validateWorkflowStructure } from "./validate-structure";

/** 使用者目錄的一筆(只放本租戶的使用者;不在目錄裡 = 不存在或不在本租戶)。 */
export interface WorkflowUserFact {
  isEnabled: boolean;
}

export interface ValidateWorkflowOptions {
  /**
   * 共用流程(`ownerOrgId = null`):人員條件只能用權限與非指定的組織來源(`AUDIENCE_IN_SHARED`);
   * 「申請人屬於這些組織」只能用租戶(`SKIP_ORGS_IN_SHARED`)。
   */
  isShared: boolean;
  /** 本租戶的角色 id;不給就不檢查 `ROLE_NOT_IN_TENANT`。 */
  tenantRoleIds?: ReadonlySet<string>;
  /** 本租戶子樹的組織 id(人員條件與「申請人屬於這些組織」共用);不給就不檢查 `ORG_NOT_IN_TENANT`。 */
  tenantOrgIds?: ReadonlySet<string>;
  /** 本租戶使用者目錄;不給就不出 `USER_INVALID`。 */
  users?: ReadonlyMap<string, WorkflowUserFact>;
  /**
   * 表單 key → 該表單**目前版本**的欄位(`null` = 表單存在但沒有目前版本);
   * map 裡沒有的 key = 表單不存在。不給就不檢查 `field` 來源的表單與欄位。
   */
  forms?: ReadonlyMap<string, readonly FieldDef[] | null>;
  /**
   * 設計器選的「檢查用表單」目前版本的欄位:`skipWhen` 與人員條件的表單組織欄位對它驗。
   * 不給時改用定義裡第一個 `field` 來源的表單;兩者都沒有 → 只檢查表達式形狀。
   */
  checkFormFields?: readonly FieldDef[] | null;
  /**
   * 設計器選的「檢查用表單」key 對不到可用的表單(不存在、看不到或沒有目前版本):出一筆
   * `CHECK_FORM_UNAVAILABLE`,跳過條件只檢查形狀 —— 不拿別張表單硬比,免得冒出一堆 `SKIP_UNKNOWN_FIELD`。
   */
  unavailableCheckFormKey?: string;
}

/**
 * 流程定義檢查器:發布前跑,設計器即時也跑。**有錯不能發布,警告可發布**。
 * 有 `edges` 的版本另跑結構檢查;沒有 `edges` 的版本只允許審核關卡、不做結構檢查。
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions,
): WorkflowValidationReport {
  const collector = new WorkflowIssueCollector();
  const { steps } = definition;
  if (steps.length === 0) {
    collector.error("WORKFLOW_EMPTY", "流程至少要有一個關卡", {});
    return { errors: collector.errors, warnings: collector.warnings };
  }
  checkKeys(steps, collector);
  const isGraph = hasEdges(definition);
  if (options.unavailableCheckFormKey !== undefined) {
    collector.error(
      "CHECK_FORM_UNAVAILABLE",
      `檢查用表單 ${options.unavailableCheckFormKey} 不存在、看不到或還沒有發布版本,跳過條件無法對照欄位`,
      { property: "checkFormKey" },
    );
  }
  const skipFields =
    options.unavailableCheckFormKey === undefined
      ? skipWhenFieldsOf(definition, options)
      : null;
  for (const [stepIndex, step] of steps.entries()) {
    const location: WorkflowIssueLocation = { stepKey: step.key, stepIndex };
    if (!(STEP_KINDS as readonly string[]).includes(step.kind ?? "review")) {
      collector.error(
        "STEP_KIND_UNKNOWN",
        `關卡 ${step.key} 的種類不明`,
        location,
      );
      continue;
    }
    if (isJoinStep(step)) {
      checkJoin(step, isGraph, collector, location);
      continue;
    }
    checkReviewStep(step, options, skipFields, collector, location);
  }
  const reviewSteps = steps.filter((step) => !isJoinStep(step));
  if (
    reviewSteps.length > 0 &&
    reviewSteps.every(
      (step) =>
        !isJoinStep(step) &&
        ((step.skipWhen !== undefined && step.skipWhen !== null) ||
          (step.skipOrgs !== undefined && step.skipOrgs !== null)),
    )
  ) {
    collector.warn(
      "ALL_STEPS_SKIPPABLE",
      "所有關卡都設了跳過條件或指定組織跳過,可能整張單不經任何人審核就完成",
      {},
    );
  }
  if (definition.cc !== undefined && definition.cc !== null) {
    checkPeopleSource(
      definition.cc,
      { owner: FLOW_OWNER, role: "知會對象", property: "cc", location: {} },
      options,
      skipFields,
      collector,
    );
  }
  if (isGraph) {
    validateWorkflowStructure(steps, definition.edges, collector);
  }
  return { errors: collector.errors, warnings: collector.warnings };
}

/** step key:格式同欄位 key、版本內唯一。 */
function checkKeys(
  steps: readonly StepDef[],
  collector: WorkflowIssueCollector,
): void {
  const seen = new Set<string>();
  for (const [stepIndex, step] of steps.entries()) {
    const location = { stepKey: step.key, stepIndex, property: "key" };
    if (!FIELD_KEY_PATTERN.test(step.key)) {
      collector.error(
        "STEP_KEY_FORMAT",
        `關卡 key ${step.key} 格式不符(小寫開頭,只允許小寫、數字、底線,最長 40)`,
        location,
      );
    }
    if (seen.has(step.key)) {
      collector.error(
        "STEP_KEY_DUPLICATE",
        `關卡 key ${step.key} 重複`,
        location,
      );
    }
    seen.add(step.key);
  }
}

/** 匯合節點:只在有 `edges` 的版本出現,且不帶審核關卡的屬性。 */
function checkJoin(
  step: StepDef,
  isGraph: boolean,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  if (!isGraph) {
    collector.error(
      "JOIN_IN_LINEAR",
      `直線流程不能有匯合節點(${step.key})`,
      location,
    );
  }
  const extra = REVIEW_STEP_PROPS.filter(
    (property) =>
      property in step &&
      (step as unknown as Record<string, unknown>)[property] !== undefined &&
      (step as unknown as Record<string, unknown>)[property] !== null,
  );
  if (extra.length > 0) {
    collector.error(
      "JOIN_HAS_REVIEW_PROPS",
      `匯合節點 ${step.key} 不能設定 ${extra.join("、")}`,
      { ...location, property: extra[0] },
    );
  }
}

function checkReviewStep(
  step: ReviewStepDef,
  options: ValidateWorkflowOptions,
  skipFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  if (!(APPROVAL_MODES as readonly string[]).includes(step.mode)) {
    collector.error("MODE_INVALID", `關卡 ${step.key} 的會簽模式不明`, {
      ...location,
      property: "mode",
    });
  }
  checkAssignee(step, options, skipFields, collector, location);
  if (step.skipWhen !== undefined && step.skipWhen !== null) {
    for (const problem of skipWhenProblems(step.skipWhen, skipFields)) {
      const code = {
        UNKNOWN_OPERATOR: "SKIP_UNKNOWN_OPERATOR",
        INVALID: "SKIP_INVALID",
        UNKNOWN_FIELD: "SKIP_UNKNOWN_FIELD",
        PROTECTED_FIELD: "SKIP_PROTECTED_FIELD",
      } as const;
      collector.error(
        code[problem.problem],
        `關卡 ${step.key} 的跳過條件:${problem.detail}`,
        { ...location, property: "skipWhen", exprPath: problem.path },
      );
    }
  }
  checkSkipOrgs(step, options, collector, location);
  checkAutoApprove(step, collector, location);
  checkOverdue(step, options, skipFields, collector, location);
  checkStepCc(step, options, skipFields, collector, location);
}

/**
 * 「申請人屬於這些組織」:形狀(`SKIP_ORGS_INVALID`:至少一個組織、id 是非空字串、「包含下層」是布林);
 * 共用流程只能選租戶(`SKIP_ORGS_IN_SHARED`);客製流程選的組織要在本租戶(`ORG_NOT_IN_TENANT`)。
 */
function checkSkipOrgs(
  step: ReviewStepDef,
  options: ValidateWorkflowOptions,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  const raw: unknown = step.skipOrgs;
  if (raw === undefined || raw === null) {
    return;
  }
  const at = { ...location, property: "skipOrgs" };
  const candidate = raw as { orgIds?: unknown; includeDescendants?: unknown };
  const orgIds = candidate.orgIds;
  if (
    typeof raw !== "object" ||
    !Array.isArray(orgIds) ||
    orgIds.length === 0 ||
    !orgIds.every((id) => typeof id === "string" && id !== "") ||
    typeof candidate.includeDescendants !== "boolean"
  ) {
    collector.error(
      "SKIP_ORGS_INVALID",
      `關卡 ${step.key} 的「申請人屬於這些組織」要至少選一個組織`,
      at,
    );
    return;
  }
  const specific = (orgIds as string[]).filter((id) => id !== SKIP_ORG_TENANT);
  if (options.isShared) {
    if (specific.length > 0) {
      collector.error(
        "SKIP_ORGS_IN_SHARED",
        `共用流程的「申請人屬於這些組織」只能選最上層組織(關卡 ${step.key})`,
        at,
      );
    }
    return;
  }
  if (
    options.tenantOrgIds !== undefined &&
    specific.some((id) => !options.tenantOrgIds?.has(id))
  ) {
    collector.error(
      "ORG_NOT_IN_TENANT",
      `關卡 ${step.key} 的「申請人屬於這些組織」選的組織不在這個最上層組織之下`,
      at,
    );
  }
}

/** 自動通過:兩項都是布林(省略 = 照常審核)。 */
function checkAutoApprove(
  step: ReviewStepDef,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  const raw: unknown = step.autoApprove;
  if (raw === undefined || raw === null) {
    return;
  }
  const candidate = raw as Record<string, unknown>;
  const isValid =
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    ["applicant", "priorApprover"].every(
      (key) =>
        candidate[key] === undefined || typeof candidate[key] === "boolean",
    );
  if (!isValid) {
    collector.error(
      "AUTO_APPROVE_INVALID",
      `關卡 ${step.key} 的自動通過設定不對(只能是照常審核或自動通過)`,
      { ...location, property: "autoApprove" },
    );
  }
}

/**
 * 一個「找人」的設定位置(審核者 / 知會對象 / 逾時通知對象),訊息與定位都從這裡來:
 * `owner` = 「關卡 <key>」或「流程」;`role` = 畫面上的名詞;`property` = 屬性路徑前綴。
 */
interface PeopleSlot {
  owner: string;
  role: "審核者" | "知會對象" | "逾時通知對象";
  property: string;
  location: WorkflowIssueLocation;
}

const FLOW_OWNER = "流程";

function stepSlot(
  step: ReviewStepDef,
  role: PeopleSlot["role"],
  property: string,
  location: WorkflowIssueLocation,
): PeopleSlot {
  return { owner: `關卡 ${step.key}`, role, property, location };
}

/** 「關卡 k 的審核者」/「流程的知會對象」。 */
function slotLabel(slot: PeopleSlot): string {
  return slot.owner === FLOW_OWNER
    ? `${FLOW_OWNER}的${slot.role}`
    : `${slot.owner} 的${slot.role}`;
}

function checkAssignee(
  step: ReviewStepDef,
  options: ValidateWorkflowOptions,
  checkFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  checkPeopleSource(
    step.assignee,
    stepSlot(step, "審核者", "assignee", location),
    options,
    checkFields,
    collector,
  );
}

/**
 * 找人的來源(審核者三種:人員條件 / 表單欄位 / 主管;知會對象同這三種)。
 * 審核者、知會對象共用這一份檢查,錯誤碼相同、`property` 指到各自的位置。
 */
function checkPeopleSource(
  raw: unknown,
  slot: PeopleSlot,
  options: ValidateWorkflowOptions,
  checkFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
): void {
  const at = (property: string): WorkflowIssueLocation => ({
    ...slot.location,
    property: `${slot.property}.${property}`,
  });
  const source = raw as AssigneeSource | null;
  if (
    typeof source !== "object" ||
    source === null ||
    !(ASSIGNEE_KINDS as readonly string[]).includes(source.kind)
  ) {
    collector.error(
      "ASSIGNEE_KIND_UNKNOWN",
      `${slotLabel(slot)}來源不明`,
      at("kind"),
    );
    return;
  }
  switch (source.kind) {
    case "audience": {
      checkAudience(slot, source.audience, options, checkFields, collector, at);
      return;
    }
    case "field": {
      checkFieldSource(slot, source, options, collector, at);
      return;
    }
    case "manager": {
      if (!Number.isInteger(source.level) || source.level < 1) {
        collector.error(
          "MANAGER_LEVEL_INVALID",
          slot.role === "審核者"
            ? `${slot.owner} 的主管層級必須是正整數`
            : `${slotLabel(slot)}主管層級必須是正整數`,
          at("level"),
        );
      }
      return;
    }
  }
}

/** 某條件列的屬性路徑(`assignee.audience.<人員條件裡的路徑>`)。 */
function audienceProperty(path: string): string {
  return path === "" ? "audience" : `audience.${path}`;
}

/**
 * 人員條件:先驗格式(`AUDIENCE_INVALID`,只報第一個);共用流程再找不能用的條件列
 * (`AUDIENCE_IN_SHARED`);客製流程的角色 / 指定組織要屬本租戶(`ROLE_NOT_IN_TENANT` /
 * `ORG_NOT_IN_TENANT`)、指定的使用者不在 / 停用 → 警告(解析時會被略過);表單組織欄位對檢查用表單驗。
 * `at` 收的是相對於 `slot.property` 的路徑(`audience.filter…`)。
 */
function checkAudience(
  slot: PeopleSlot,
  raw: unknown,
  options: ValidateWorkflowOptions,
  checkFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
  at: (property: string) => WorkflowIssueLocation,
): void {
  const label = slotLabel(slot);
  const validation = validateAudience(raw, APPROVER_AUDIENCE_OPTIONS);
  if (!validation.ok) {
    collector.error(
      "AUDIENCE_INVALID",
      `${label}條件不完整或格式不對:${validation.issue.message}`,
      at(audienceProperty(validation.issue.path)),
    );
    return;
  }
  const audience = validation.audience;
  if (options.isShared) {
    for (const { path } of sharedAudienceViolations(audience)) {
      collector.error(
        "AUDIENCE_IN_SHARED",
        slot.owner === FLOW_OWNER
          ? `共用流程的${slot.role}條件只能用權限與非指定的組織來源`
          : `共用流程的${slot.role}條件只能用權限與非指定的組織來源(${slot.owner})`,
        at(audienceProperty(path)),
      );
    }
  } else {
    checkAudienceTenant(slot, audience, options, collector, at);
  }
  if (checkFields === null) {
    return;
  }
  for (const { fieldKey, path } of audienceFormFieldRefsOf(audience)) {
    const problem = audienceOrgFieldProblem(checkFields, fieldKey);
    if (problem !== null) {
      collector.error(
        problem,
        problem === "FIELD_MISSING"
          ? `${label}條件用的組織欄位 ${fieldKey} 不在檢查用表單`
          : `${label}條件用的欄位 ${fieldKey} 不是組織引用欄`,
        at(audienceProperty(path)),
      );
    }
  }
}

/** 客製流程:角色 / 指定組織要屬本租戶;指定使用者不存在 / 不在本租戶 / 停用 → 警告。 */
function checkAudienceTenant(
  slot: PeopleSlot,
  audience: Audience,
  options: ValidateWorkflowOptions,
  collector: WorkflowIssueCollector,
  at: (property: string) => WorkflowIssueLocation,
): void {
  const label = slotLabel(slot);
  for (const { leaf, path } of audienceLeavesOf(audience)) {
    if (leaf.value.kind !== "static") {
      continue;
    }
    const property = audienceProperty(`${path}.value`);
    const ids = leaf.value.values;
    if (
      leaf.field === "role" &&
      options.tenantRoleIds !== undefined &&
      ids.some((id) => !options.tenantRoleIds?.has(id))
    ) {
      collector.error(
        "ROLE_NOT_IN_TENANT",
        `${label}條件選的角色不屬於這個最上層組織`,
        at(property),
      );
    }
    if (
      leaf.field === "org" &&
      options.tenantOrgIds !== undefined &&
      ids.some((id) => !options.tenantOrgIds?.has(id))
    ) {
      collector.error(
        "ORG_NOT_IN_TENANT",
        `${label}條件選的組織不在這個最上層組織之下`,
        at(property),
      );
    }
    if (leaf.field === "user") {
      checkUsers(slot, ids, options, collector, () => at(property));
    }
  }
}

/** 指定使用者:不存在 / 不在本租戶 / 已停用 → 警告(發布後解析時會被略過)。 */
function checkUsers(
  slot: PeopleSlot,
  userIds: readonly string[],
  options: ValidateWorkflowOptions,
  collector: WorkflowIssueCollector,
  at: () => WorkflowIssueLocation,
): void {
  const { users } = options;
  if (users === undefined) {
    return;
  }
  const who = slot.role === "審核者" ? slot.owner : `${slotLabel(slot)}條件`;
  for (const userId of userIds) {
    const fact = users.get(userId);
    if (fact?.isEnabled !== true) {
      collector.warn(
        "USER_INVALID",
        fact === undefined
          ? `${who} 指定的使用者 ${userId} 不存在或不在這個最上層組織`
          : `${who} 指定的使用者 ${userId} 已停用`,
        at(),
      );
    }
  }
}

function checkFieldSource(
  slot: PeopleSlot,
  source: { formKey: string; fieldKey: string },
  options: ValidateWorkflowOptions,
  collector: WorkflowIssueCollector,
  at: (property: string) => WorkflowIssueLocation,
): void {
  if (options.forms === undefined) {
    return;
  }
  const label = slotLabel(slot);
  if (!options.forms.has(source.formKey)) {
    collector.error(
      "FIELD_FORM_MISSING",
      `${label}欄位所屬表單 ${source.formKey} 不存在`,
      at("formKey"),
    );
    return;
  }
  const fields = options.forms.get(source.formKey) ?? [];
  const problem = assigneeFieldProblem(fields, source.fieldKey);
  if (problem !== null) {
    collector.error(
      problem,
      problem === "FIELD_MISSING"
        ? `${label}欄位 ${source.fieldKey} 不在表單 ${source.formKey} 的目前版本`
        : `${label}欄位 ${source.fieldKey} 不是使用者型引用欄`,
      at("fieldKey"),
    );
  }
}

/** 正整數小時。 */
function isWholeHours(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * 逾時提醒:N、M 是正整數小時且 M > N(`OVERDUE_INVALID`,設計器擋下、不能發布);
 * 通知對象是人員條件,與審核者同一套檢查(`AUDIENCE_INVALID`、`AUDIENCE_IN_SHARED`…)。
 */
function checkOverdue(
  step: ReviewStepDef,
  options: ValidateWorkflowOptions,
  checkFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  const raw: unknown = step.overdue;
  if (raw === undefined || raw === null) {
    return;
  }
  const candidate = raw as Partial<Record<keyof OverdueReminderDef, unknown>>;
  if (
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !isWholeHours(candidate.reviewerAfterHours) ||
    !isWholeHours(candidate.audienceAfterHours)
  ) {
    collector.error(
      "OVERDUE_INVALID",
      `關卡 ${step.key} 的逾時提醒時數要是正整數小時`,
      { ...location, property: "overdue" },
    );
    return;
  }
  if (candidate.audienceAfterHours <= candidate.reviewerAfterHours) {
    collector.error(
      "OVERDUE_INVALID",
      `關卡 ${step.key} 的逾時提醒:通知對象的時數要大於通知審核者的時數`,
      { ...location, property: "overdue.audienceAfterHours" },
    );
  }
  const slot = stepSlot(step, "逾時通知對象", "overdue", location);
  checkAudience(
    slot,
    candidate.audience,
    options,
    checkFields,
    collector,
    (property) => ({ ...location, property: `overdue.${property}` }),
  );
}

/** 關卡的知會對象(來源同審核者三種)。 */
function checkStepCc(
  step: ReviewStepDef,
  options: ValidateWorkflowOptions,
  checkFields: readonly FieldDef[] | null,
  collector: WorkflowIssueCollector,
  location: WorkflowIssueLocation,
): void {
  if (step.cc === undefined || step.cc === null) {
    return;
  }
  checkPeopleSource(
    step.cc,
    stepSlot(step, "知會對象", "cc", location),
    options,
    checkFields,
    collector,
  );
}

/** `skipWhen` 要對照的表單欄位:檢查用表單優先,否則第一個 `field` 來源的表單目前版本。 */
function skipWhenFieldsOf(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions,
): readonly FieldDef[] | null {
  if (
    options.checkFormFields !== undefined &&
    options.checkFormFields !== null
  ) {
    return options.checkFormFields;
  }
  for (const step of definition.steps) {
    if (!isJoinStep(step) && step.assignee.kind === "field") {
      const fields = options.forms?.get(step.assignee.formKey);
      if (fields !== undefined && fields !== null) {
        return fields;
      }
    }
  }
  return null;
}
