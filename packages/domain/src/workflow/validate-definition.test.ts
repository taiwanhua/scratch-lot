import { describe, expect, it } from "@jest/globals";

import { field } from "../form/form-test-support";
import type { FieldDef } from "../form/types";
import {
  type SubmitCheckInput,
  checkSubmitCompatibility,
} from "./submit-check";
import type {
  ReviewStepDef,
  StepDef,
  WorkflowDefinition,
  WorkflowEdge,
} from "./types";
import {
  type ValidateWorkflowOptions,
  validateWorkflowDefinition,
} from "./validate-definition";
import { LINEAR, PURCHASE, join, review } from "./workflow-test-support";

const CUSTOM: ValidateWorkflowOptions = { isShared: false };
const SHARED: ValidateWorkflowOptions = { isShared: true };

function codesOf(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = CUSTOM,
): string[] {
  return validateWorkflowDefinition(definition, options).errors.map(
    (issue) => issue.code,
  );
}

function warningsOf(
  definition: WorkflowDefinition,
  options: ValidateWorkflowOptions = CUSTOM,
): string[] {
  return validateWorkflowDefinition(definition, options).warnings.map(
    (issue) => issue.code,
  );
}

const graph = (
  steps: StepDef[],
  edges: WorkflowEdge[],
): WorkflowDefinition => ({
  steps,
  edges,
});

const edge = (from: string, to: string): WorkflowEdge => ({ from, to });

/** 一關、審核者來源 = 某表單的某欄位。 */
const source = (formKey: string, fieldKey: string): WorkflowDefinition => ({
  steps: [review("a", { assignee: { kind: "field", formKey, fieldKey } })],
});

/** 一關、帶跳過條件。 */
const withSkip = (skipWhen: unknown): WorkflowDefinition => ({
  steps: [review("hr", { skipWhen: skipWhen as never })],
});

const ROLE_ID = "65a000000000000000000001";
const ORG_ID = "65a000000000000000000002";
const USER_ID = "65a000000000000000000003";

const roleRow = {
  field: "role",
  cond: "in",
  value: { kind: "static", values: [ROLE_ID] },
};
const userRow = {
  field: "user",
  cond: "in",
  value: { kind: "static", values: [USER_ID] },
};
const orgRow = {
  field: "org",
  cond: "in",
  value: { kind: "static", values: [ORG_ID] },
  range: "self",
};
const permissionRow = {
  field: "permission",
  cond: "in",
  value: { kind: "static", values: ["accounts.close-period"] },
};
const dynamicOrg = (ref: string) => ({
  field: "org",
  cond: "in",
  value: { kind: "dynamic", ref },
  range: "self",
});
const match = (...children: unknown[]) => ({
  mode: "match",
  filter: { op: "AND", children },
});

/** 一關、審核者來源 = 人員條件(原樣放進去,讓檢查器自己驗格式)。 */
const byAudience = (audience: unknown): WorkflowDefinition => ({
  steps: [
    review("a", {
      assignee: { kind: "audience", audience: audience as never },
    }),
  ],
});

/** 病假單:審核主管(使用者引用)、天數、受保護的內部備註、計算欄位引用受保護欄位。 */
const SICK_LEAVE_FIELDS: FieldDef[] = [
  field("approver", "reference", {
    source: { provider: "user", labelField: "name" },
  }),
  field("store", "reference", {
    source: { provider: "org", labelField: "name" },
  }),
  field("days", "number"),
  field("secret", "number", { permission: { show: true, edit: true } }),
  field("secret_twice", "number", {
    valueSource: { kind: "computed", expr: { "*": [{ var: "secret" }, 2] } },
  }),
];

describe("validateWorkflowDefinition:基本與審核者來源", () => {
  it("合法的直線與平行流程沒有錯誤", () => {
    expect(codesOf(LINEAR)).toEqual([]);
    expect(codesOf(PURCHASE)).toEqual([]);
  });

  it("至少一關", () => {
    expect(codesOf({ steps: [] })).toEqual(["WORKFLOW_EMPTY"]);
  });

  it("step key 重複 / 格式", () => {
    expect(codesOf({ steps: [review("boss"), review("boss")] })).toEqual([
      "STEP_KEY_DUPLICATE",
    ]);
    expect(codesOf({ steps: [review("Boss-1")] })).toEqual(["STEP_KEY_FORMAT"]);
  });

  it("會簽模式與來源種類不明", () => {
    expect(
      codesOf({
        steps: [review("a", { mode: "most" as unknown as "any" })],
      }),
    ).toEqual(["MODE_INVALID"]);
    expect(
      codesOf({
        steps: [
          review("a", {
            assignee: { kind: "job" } as unknown as ReviewStepDef["assignee"],
          }),
        ],
      }),
    ).toEqual(["ASSIGNEE_KIND_UNKNOWN"]);
  });

  it("audience:格式不對 → AUDIENCE_INVALID(指到出錯的條件列);不能選所有人", () => {
    expect(codesOf(byAudience({ mode: "all" }))).toEqual(["AUDIENCE_INVALID"]);
    const report = validateWorkflowDefinition(
      byAudience(match({ ...roleRow, value: { kind: "static", values: [] } })),
      CUSTOM,
    );
    expect(report.errors.map((issue) => issue.code)).toEqual([
      "AUDIENCE_INVALID",
    ]);
    expect(report.errors[0]?.location.property).toBe(
      "assignee.audience.filter.children[0].value.values",
    );
    expect(codesOf(byAudience(null))).toEqual(["AUDIENCE_INVALID"]);
  });

  it("共用流程:使用者 / 角色 / 指定組織 → AUDIENCE_IN_SHARED;權限與非指定的組織來源可用", () => {
    const report = validateWorkflowDefinition(
      byAudience(match(roleRow, userRow, orgRow)),
      SHARED,
    );
    expect(report.errors.map((issue) => issue.code)).toEqual([
      "AUDIENCE_IN_SHARED",
      "AUDIENCE_IN_SHARED",
      "AUDIENCE_IN_SHARED",
    ]);
    expect(report.errors.map((issue) => issue.location.property)).toEqual([
      "assignee.audience.filter.children[0]",
      "assignee.audience.filter.children[1]",
      "assignee.audience.filter.children[2]",
    ]);
    expect(
      codesOf(
        byAudience(
          match(
            permissionRow,
            dynamicOrg("submission-org"),
            dynamicOrg("tenant"),
          ),
        ),
        SHARED,
      ),
    ).toEqual([]);
  });

  it("客製流程:角色 / 指定組織要屬本租戶;指定使用者不存在或停用 → 警告", () => {
    const definition = byAudience(match(roleRow, orgRow, userRow));
    expect(
      codesOf(definition, {
        isShared: false,
        tenantRoleIds: new Set(["65a000000000000000000099"]),
        tenantOrgIds: new Set(["65a000000000000000000099"]),
      }),
    ).toEqual(["ROLE_NOT_IN_TENANT", "ORG_NOT_IN_TENANT"]);
    expect(
      codesOf(definition, {
        isShared: false,
        tenantRoleIds: new Set([ROLE_ID]),
        tenantOrgIds: new Set([ORG_ID]),
      }),
    ).toEqual([]);
    const users = new Map([[USER_ID, { isEnabled: false }]]);
    expect(warningsOf(definition, { isShared: false, users })).toEqual([
      "USER_INVALID",
    ]);
  });

  it("表單的組織欄位:對檢查用表單驗;不是組織引用欄 → FIELD_NOT_ORG_REFERENCE", () => {
    const options = { isShared: true, checkFormFields: SICK_LEAVE_FIELDS };
    expect(
      codesOf(byAudience(match(dynamicOrg("form-field:store"))), options),
    ).toEqual([]);
    expect(
      codesOf(byAudience(match(dynamicOrg("form-field:approver"))), options),
    ).toEqual(["FIELD_NOT_ORG_REFERENCE"]);
    expect(
      codesOf(byAudience(match(dynamicOrg("form-field:ghost"))), options),
    ).toEqual(["FIELD_MISSING"]);
    // 沒有可對照的表單 → 只驗格式
    expect(
      codesOf(byAudience(match(dynamicOrg("form-field:ghost"))), SHARED),
    ).toEqual([]);
  });

  it("field:表單不存在;欄位不在目前版本或不是使用者型引用欄", () => {
    const forms = new Map([["sick_leave", SICK_LEAVE_FIELDS]]);
    expect(
      codesOf(source("sick_leave", "approver"), { isShared: true, forms }),
    ).toEqual([]);
    expect(
      codesOf(source("nope", "approver"), { isShared: false, forms }),
    ).toEqual(["FIELD_FORM_MISSING"]);
    expect(
      codesOf(source("sick_leave", "ghost"), { isShared: false, forms }),
    ).toEqual(["FIELD_MISSING"]);
    expect(
      codesOf(source("sick_leave", "store"), { isShared: false, forms }),
    ).toEqual(["FIELD_NOT_USER_REFERENCE"]);
  });

  it("manager.level 不是正整數", () => {
    expect(
      codesOf({
        steps: [review("a", { assignee: { kind: "manager", level: 1.5 } })],
      }),
    ).toEqual(["MANAGER_LEVEL_INVALID"]);
  });

  it("skipWhen:未知運算子 / 形狀不合法 / 不存在欄位 / 受保護欄位(對檢查用表單)", () => {
    const options = { isShared: false, checkFormFields: SICK_LEAVE_FIELDS };
    expect(codesOf(withSkip({ "<=": [{ var: "days" }, 1] }), options)).toEqual(
      [],
    );
    expect(codesOf(withSkip({ regex: ["a", "b"] }), options)).toEqual([
      "SKIP_UNKNOWN_OPERATOR",
    ]);
    expect(codesOf(withSkip({ "<=": [{ var: 3 }, 1] }), options)).toEqual([
      "SKIP_INVALID",
    ]);
    expect(codesOf(withSkip({ "<=": [{ var: "hours" }, 1] }), options)).toEqual(
      ["SKIP_UNKNOWN_FIELD"],
    );
    expect(codesOf(withSkip({ ">": [{ var: "secret" }, 1] }), options)).toEqual(
      ["SKIP_PROTECTED_FIELD"],
    );
    // 受保護依賴鏈:計算欄位引用受保護欄位,也算受保護
    expect(
      codesOf(withSkip({ ">": [{ var: "secret_twice" }, 1] }), options),
    ).toEqual(["SKIP_PROTECTED_FIELD"]);
    // 沒有檢查用表單也沒有 field 來源 → 只檢查形狀
    expect(codesOf(withSkip({ "<=": [{ var: "hours" }, 1] }))).toEqual([]);
  });

  it("檢查用表單對不到(不存在 / 看不到 / 沒有目前版本)→ CHECK_FORM_UNAVAILABLE,跳過條件只驗形狀", () => {
    const options = {
      isShared: false,
      unavailableCheckFormKey: "gone_form",
      // 即使有 field 來源的表單可退回對照,也不拿它硬比
      forms: new Map([["sick_leave", SICK_LEAVE_FIELDS]]),
    };
    expect(codesOf(withSkip({ "<=": [{ var: "hours" }, 1] }), options)).toEqual(
      ["CHECK_FORM_UNAVAILABLE"],
    );
    expect(codesOf(withSkip({ regex: ["a", "b"] }), options)).toEqual([
      "CHECK_FORM_UNAVAILABLE",
      "SKIP_UNKNOWN_OPERATOR",
    ]);
  });

  it("所有關卡都可能被跳過 → 警告(可發布)", () => {
    const definition = {
      steps: [
        review("a", { skipWhen: true }),
        review("b", { skipWhen: { "==": [1, 1] } }),
      ],
    };
    expect(codesOf(definition)).toEqual([]);
    expect(warningsOf(definition)).toEqual(["ALL_STEPS_SKIPPABLE"]);
  });
});

/** 一關、帶「申請人屬於這些組織」。 */
const withOrgs = (skipOrgs: unknown): WorkflowDefinition => ({
  steps: [review("hr", { skipOrgs: skipOrgs as never })],
});

describe("validateWorkflowDefinition:指定組織跳過與自動通過(B4 / B5)", () => {
  it("共用流程指定特定組織 → SKIP_ORGS_IN_SHARED;只選租戶可以", () => {
    expect(
      codesOf(withOrgs({ orgIds: [ORG_ID], includeDescendants: true }), SHARED),
    ).toEqual(["SKIP_ORGS_IN_SHARED"]);
    expect(
      codesOf(
        withOrgs({ orgIds: ["tenant", ORG_ID], includeDescendants: false }),
        SHARED,
      ),
    ).toEqual(["SKIP_ORGS_IN_SHARED"]);
    expect(
      codesOf(
        withOrgs({ orgIds: ["tenant"], includeDescendants: true }),
        SHARED,
      ),
    ).toEqual([]);
  });

  it("客製流程:指定組織要在本租戶(ORG_NOT_IN_TENANT,property = skipOrgs)", () => {
    const options = { isShared: false, tenantOrgIds: new Set([ORG_ID]) };
    expect(
      codesOf(
        withOrgs({ orgIds: [ORG_ID], includeDescendants: false }),
        options,
      ),
    ).toEqual([]);
    const report = validateWorkflowDefinition(
      withOrgs({
        orgIds: ["65a000000000000000000009"],
        includeDescendants: false,
      }),
      options,
    );
    expect(report.errors).toEqual([
      expect.objectContaining({
        code: "ORG_NOT_IN_TENANT",
        location: { stepKey: "hr", stepIndex: 0, property: "skipOrgs" },
      }),
    ]);
  });

  it("形狀不對(沒選組織、含下層不是布林)→ SKIP_ORGS_INVALID;沒設 / null = 不看組織", () => {
    expect(
      codesOf(withOrgs({ orgIds: [], includeDescendants: false })),
    ).toEqual(["SKIP_ORGS_INVALID"]);
    expect(codesOf(withOrgs({ orgIds: [ORG_ID] }))).toEqual([
      "SKIP_ORGS_INVALID",
    ]);
    expect(codesOf(withOrgs(null))).toEqual([]);
  });

  it("自動通過只能是布林;不認得的值 → AUTO_APPROVE_INVALID", () => {
    expect(
      codesOf({
        steps: [
          review("hr", {
            autoApprove: { applicant: true, priorApprover: false },
          }),
        ],
      }),
    ).toEqual([]);
    expect(
      codesOf({
        steps: [review("hr", { autoApprove: { applicant: "yes" } as never })],
      }),
    ).toEqual(["AUTO_APPROVE_INVALID"]);
  });

  it("匯合節點帶了指定組織跳過 / 自動通過 → JOIN_HAS_REVIEW_PROPS", () => {
    const definition = graph(
      [
        review("a"),
        review("b"),
        review("c"),
        {
          ...join("j"),
          autoApprove: { applicant: true },
        } as unknown as StepDef,
      ],
      [edge("a", "b"), edge("a", "c"), edge("b", "j"), edge("c", "j")],
    );
    expect(codesOf(definition)).toContain("JOIN_HAS_REVIEW_PROPS");
  });

  it("所有關卡都可能被跳過(含指定組織跳過)→ 警告", () => {
    expect(
      warningsOf({
        steps: [
          review("a", { skipWhen: true }),
          review("b", {
            skipOrgs: { orgIds: ["tenant"], includeDescendants: true },
          }),
        ],
      }),
    ).toEqual(["ALL_STEPS_SKIPPABLE"]);
  });
});

describe("validateWorkflowDefinition:匯合節點與結構(每種錯誤各一例)", () => {
  it("直線版本只允許審核關卡,且不做結構檢查", () => {
    expect(codesOf({ steps: [review("a"), join("j")] })).toEqual([
      "JOIN_IN_LINEAR",
    ]);
  });

  it("匯合節點不能帶審核關卡的屬性", () => {
    const badJoin = {
      ...join("merge"),
      mode: "any",
      skipWhen: true,
    } as unknown as StepDef;
    const steps = PURCHASE.steps.map((step) =>
      step.key === "merge" ? badJoin : step,
    );
    expect(codesOf({ steps, edges: PURCHASE.edges ?? null })).toEqual([
      "JOIN_HAS_REVIEW_PROPS",
    ]);
  });

  it("連線引用不存在的關卡", () => {
    expect(
      codesOf(
        graph([review("a"), review("b")], [edge("a", "b"), edge("b", "x")]),
      ),
    ).toContain("EDGE_UNKNOWN_STEP");
  });

  it("同一對節點重複連線", () => {
    expect(
      codesOf(
        graph([review("a"), review("b")], [edge("a", "b"), edge("a", "b")]),
      ),
    ).toEqual(["EDGE_DUPLICATE"]);
  });

  it("多起點 / 多終點", () => {
    expect(
      codesOf(
        graph(
          [review("a"), review("b"), review("c")],
          [edge("a", "c"), edge("b", "c")],
        ),
      ),
    ).toEqual(expect.arrayContaining(["START_NOT_UNIQUE"]));
    expect(
      codesOf(
        graph(
          [review("a"), review("b"), review("c")],
          [edge("a", "b"), edge("a", "c")],
        ),
      ),
    ).toEqual(expect.arrayContaining(["END_NOT_UNIQUE"]));
  });

  it("迴圈", () => {
    expect(
      codesOf(
        graph(
          [review("a"), review("b"), review("c"), review("d")],
          [edge("a", "b"), edge("b", "c"), edge("c", "b"), edge("c", "d")],
        ),
      ),
    ).toContain("CYCLE");
  });

  it("不可達(從起點走不到 / 走不到終點)", () => {
    expect(
      codesOf(
        graph(
          [review("a"), review("b"), review("c"), review("d")],
          [edge("a", "b"), edge("c", "d"), edge("d", "c")],
        ),
      ),
    ).toContain("UNREACHABLE");
  });

  it("審核關卡入線 > 1(多條分支要先匯合)", () => {
    expect(
      codesOf(
        graph(
          [review("a"), review("b"), review("c"), review("d")],
          [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
        ),
      ),
    ).toContain("REVIEW_MULTIPLE_INCOMING");
  });

  it("匯合入線 < 2", () => {
    expect(
      codesOf(
        graph(
          [review("a"), join("j"), review("b")],
          [edge("a", "j"), edge("j", "b")],
        ),
      ),
    ).toContain("JOIN_TOO_FEW_INCOMING");
  });

  it("匯合節點之後分流或接匯合", () => {
    const steps = [
      review("a"),
      review("b"),
      review("c"),
      join("j"),
      review("x"),
      review("y"),
    ];
    expect(
      codesOf(
        graph(steps, [
          edge("a", "b"),
          edge("a", "c"),
          edge("b", "j"),
          edge("c", "j"),
          edge("j", "x"),
          edge("j", "y"),
        ]),
      ),
    ).toContain("JOIN_OUTGOING_INVALID");
  });

  it("分流 / 匯合不配對:分支匯到不同的匯合節點", () => {
    const steps = [
      review("f"),
      review("b1"),
      review("b2"),
      review("b3"),
      join("j1"),
      join("j2"),
      review("end"),
    ];
    const codes = codesOf(
      graph(steps, [
        edge("f", "b1"),
        edge("f", "b2"),
        edge("f", "b3"),
        edge("b1", "j1"),
        edge("b2", "j1"),
        edge("b3", "j2"),
        edge("j1", "j2"),
        edge("j2", "end"),
      ]),
    );
    expect(codes).toContain("FORK_JOIN_MISMATCH");
  });

  it("分流直接連到匯合(空分支)", () => {
    expect(
      codesOf(
        graph(
          [review("f"), review("b1"), join("j")],
          [edge("f", "b1"), edge("f", "j"), edge("b1", "j")],
        ),
      ),
    ).toContain("BRANCH_EMPTY");
  });

  it("巢狀分流", () => {
    const steps = [
      review("f"),
      review("b1"),
      review("b2"),
      review("n1"),
      review("n2"),
      join("inner"),
      join("outer"),
    ];
    expect(
      codesOf(
        graph(steps, [
          edge("f", "b1"),
          edge("f", "b2"),
          edge("b1", "n1"),
          edge("b1", "n2"),
          edge("n1", "inner"),
          edge("n2", "inner"),
          edge("inner", "outer"),
          edge("b2", "outer"),
        ]),
      ),
    ).toContain("NESTED_FORK");
  });

  it("分支之間交叉連線", () => {
    const steps = [
      review("f"),
      review("a1"),
      review("a2"),
      review("b1"),
      review("b2"),
      join("j"),
    ];
    expect(
      codesOf(
        graph(steps, [
          edge("f", "a1"),
          edge("f", "b1"),
          edge("a1", "a2"),
          edge("a1", "b2"),
          edge("b1", "b2"),
          edge("a2", "j"),
          edge("b2", "j"),
        ]),
      ),
    ).toContain("CROSS_BRANCH");
  });

  it("一條路徑上可以有多組分流 → 匯合(不巢狀)", () => {
    const steps = [
      review("f1"),
      review("a"),
      review("b"),
      join("j1"),
      review("f2"),
      review("c"),
      review("d"),
      join("j2"),
    ];
    expect(
      codesOf(
        graph(steps, [
          edge("f1", "a"),
          edge("f1", "b"),
          edge("a", "j1"),
          edge("b", "j1"),
          edge("j1", "f2"),
          edge("f2", "c"),
          edge("f2", "d"),
          edge("c", "j2"),
          edge("d", "j2"),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("checkSubmitCompatibility:送出時檢查每一列", () => {
  const FLOW: WorkflowDefinition = {
    steps: [
      review("boss", {
        assignee: {
          kind: "field",
          formKey: "sick_leave",
          fieldKey: "approver",
        },
      }),
      review("hr", { skipWhen: { "<=": [{ var: "days" }, 1] } }),
    ],
  };
  const base: SubmitCheckInput = {
    formKey: "sick_leave",
    formFields: SICK_LEAVE_FIELDS,
    hasBeenReviewed: false,
    binding: { workflowKey: "leave_review" },
    workflow: { key: "leave_review", currentVersion: 3, isAssigned: true },
    definition: FLOW,
  };

  it("相容 → 走這一版流程", () => {
    expect(checkSubmitCompatibility(base)).toEqual({
      kind: "workflow",
      workflowKey: "leave_review",
      workflowVersion: 3,
    });
  });

  it("沒進過審核、也沒綁定 → 不走流程(6a)", () => {
    expect(checkSubmitCompatibility({ ...base, binding: null })).toEqual({
      kind: "noWorkflow",
    });
  });

  it("field 來源的欄位在這個表單版本不存在 / 不是使用者型引用欄 → 流程設定有誤,指出第幾關", () => {
    const withoutApprover = SICK_LEAVE_FIELDS.filter(
      (candidate) => candidate.key !== "approver",
    );
    const result = checkSubmitCompatibility({
      ...base,
      formFields: withoutApprover,
    });
    expect(result).toMatchObject({
      kind: "blocked",
      code: "WORKFLOW_MISCONFIGURED",
      message: "流程設定有誤,請聯絡管理員",
      issues: [
        {
          stepNumber: 1,
          slot: "assignee",
          fieldKey: "approver",
          problem: "FIELD_MISSING",
          detail: "關卡「boss」的審核者欄位 approver 不在這個表單版本",
        },
      ],
    });
    const notUser = SICK_LEAVE_FIELDS.map((candidate) =>
      candidate.key === "approver" ? field("approver", "text") : candidate,
    );
    expect(
      checkSubmitCompatibility({ ...base, formFields: notUser }),
    ).toMatchObject({ issues: [{ problem: "FIELD_NOT_USER_REFERENCE" }] });
  });

  it("人員條件的表單組織欄位不是組織引用欄 → FIELD_NOT_ORG_REFERENCE(送出時)", () => {
    const definition = byAudience(
      match(permissionRow, dynamicOrg("form-field:store")),
    );
    expect(checkSubmitCompatibility({ ...base, definition })).toMatchObject({
      kind: "workflow",
    });
    const storeAsText = SICK_LEAVE_FIELDS.map((candidate) =>
      candidate.key === "store" ? field("store", "text") : candidate,
    );
    expect(
      checkSubmitCompatibility({
        ...base,
        definition,
        formFields: storeAsText,
      }),
    ).toMatchObject({
      kind: "blocked",
      code: "WORKFLOW_MISCONFIGURED",
      issues: [
        {
          stepNumber: 1,
          slot: "assignee",
          fieldKey: "store",
          problem: "FIELD_NOT_ORG_REFERENCE",
        },
      ],
    });
  });

  it("skipWhen 用到的欄位不存在或受保護 → 流程設定有誤;舊版草稿仍有該欄位 → 通過", () => {
    const withoutDays = SICK_LEAVE_FIELDS.filter(
      (candidate) => candidate.key !== "days",
    );
    expect(
      checkSubmitCompatibility({ ...base, formFields: withoutDays }),
    ).toMatchObject({
      code: "WORKFLOW_MISCONFIGURED",
      issues: [{ stepNumber: 2, slot: "skipWhen", problem: "UNKNOWN_FIELD" }],
    });
    const protectedDays = SICK_LEAVE_FIELDS.map((candidate) =>
      candidate.key === "days"
        ? { ...candidate, permission: { show: true, edit: false } }
        : candidate,
    );
    expect(
      checkSubmitCompatibility({ ...base, formFields: protectedDays }),
    ).toMatchObject({ issues: [{ problem: "PROTECTED_FIELD" }] });
  });

  it("綁的流程沒有已發布版本 → 流程尚未發布", () => {
    expect(
      checkSubmitCompatibility({
        ...base,
        workflow: {
          key: "leave_review",
          currentVersion: null,
          isAssigned: true,
        },
        definition: null,
      }),
    ).toMatchObject({ code: "WORKFLOW_UNPUBLISHED", message: "流程尚未發布" });
  });

  it("進過審核、但綁定被解除或流程被收回分派 → 審核流程已移除", () => {
    expect(
      checkSubmitCompatibility({
        ...base,
        hasBeenReviewed: true,
        binding: null,
      }),
    ).toMatchObject({
      code: "WORKFLOW_REMOVED",
      message: "此表單的審核流程已移除,請聯絡管理員",
    });
    expect(
      checkSubmitCompatibility({
        ...base,
        hasBeenReviewed: true,
        workflow: { key: "leave_review", currentVersion: 3, isAssigned: false },
      }),
    ).toMatchObject({ code: "WORKFLOW_REMOVED" });
  });

  it("沒進過審核、但綁定的流程已被收回分派 → 同樣擋下(不靜默免審)", () => {
    expect(
      checkSubmitCompatibility({
        ...base,
        workflow: { key: "leave_review", currentVersion: 3, isAssigned: false },
      }),
    ).toMatchObject({ code: "WORKFLOW_REMOVED" });
  });

  it("進過審核、現在綁到另一個有效流程 → 依新流程重跑", () => {
    expect(
      checkSubmitCompatibility({
        ...base,
        hasBeenReviewed: true,
        binding: { workflowKey: "leave_review_v2" },
        workflow: {
          key: "leave_review_v2",
          currentVersion: 1,
          isAssigned: true,
        },
      }),
    ).toEqual({
      kind: "workflow",
      workflowKey: "leave_review_v2",
      workflowVersion: 1,
    });
  });
});
