import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Types } from "mongoose";

import { VOID_REASON_OTHER } from "@repo/domain/form";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import {
  lifecycleProbe,
  resetLifecycleProbe,
} from "../../workflows/test-support/lifecycle-fixture";
import {
  FORM_KEY,
  VOID,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  decideOn,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../../workflows/test-support/workflow-fixtures";
import {
  UPDATE_FORM,
  call,
  codeOf,
  extensionsOf,
  ok,
} from "../test-support/form-fixtures";

/** 掛接點固定入口換成探針(病假表單登記全部守門與事後動作)。 */
jest.mock("../../project/form-lifecycles", () => ({
  PROJECT_FORM_LIFECYCLES: jest.requireActual<{
    LIFECYCLE_FIXTURE_REGISTRATIONS: unknown;
  }>("../../workflows/test-support/lifecycle-fixture")
    .LIFECYCLE_FIXTURE_REGISTRATIONS,
}));

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/** 底座 seed 的「補印原因」類別(lost / damaged / other):本測試借它當作廢原因類別。 */
const CATEGORY = "reprint-reason";
/** 別的類別的選項值(不在作廢原因類別內)。 */
const FOREIGN_VALUE = "staple";

const VOID_REASON_OPTIONS = /* GraphQL */ `
  query FormVoidReasonOptions($formKey: ID!) {
    formVoidReasonOptions(formKey: $formKey) {
      categoryKey
      items {
        value
        label
      }
    }
  }
`;

interface OptionsPayload {
  formVoidReasonOptions: {
    categoryKey: string | null;
    items: { value: string; label: string }[];
  };
}

type VoidedRow = WfSubmissionRow & {
  voidReason: string | null;
  voidReasonKey: string | null;
  voidReasonLabel: string | null;
};

/**
 * 作廢原因(表單設定 `voidReasonCategoryKey`):沒設定 = 自由文字(既有行為);設定後原因必須是該類別
 * 啟用中的選項、選「其他」時說明必填;掛接點拿得到原因、稽核記原因(真 GraphQL + 真 Mongo)。
 */
describe("作廢原因(表單設定的欄位管理類別)", () => {
  let api: AuthTestApp;
  let world: World;

  const applicant = () => world.applicant.token;
  const reviewer = () => world.staff[0] ?? world.manager;

  async function setCategory(key: string | null): Promise<void> {
    await ok(api, world.root, UPDATE_FORM, {
      input: { key: FORM_KEY, voidReasonCategoryKey: key },
    });
  }

  async function approved(): Promise<WfSubmissionRow> {
    const submitted = await submitLeave(world, { title: "要作廢", days: 1 });
    await decideOn(world, reviewer(), submitted.id, "APPROVE");
    const row = await api.connection
      .collection<{ editVersion: number }>("form_submissions")
      .findOne({ _id: new Types.ObjectId(submitted.id) });
    return { ...submitted, editVersion: row?.editVersion ?? 0 };
  }

  function voidIt(
    row: WfSubmissionRow,
    reason: { reasonKey?: string | null; reasonNote: string },
  ) {
    return call<{ voidSubmission: { submission: VoidedRow } }>(
      api,
      applicant(),
      VOID,
      {
        input: {
          id: row.id,
          expectedEditVersion: row.editVersion,
          ...reason,
        },
      },
    );
  }

  function expectValidation(
    result: Awaited<ReturnType<typeof voidIt>>,
    field: string,
  ): void {
    expect(codeOf(result)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(result).fields).toEqual([field]);
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_void_reason", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 1);
    await useWorkflow(world, "void_reason_review", {
      steps: [usersStep("review", [world.staff[0] ?? world.manager])],
    });
  });

  beforeEach(async () => {
    resetLifecycleProbe();
    await setCategory(null);
  });

  afterAll(async () => {
    await api.close();
  });

  describe("沒設定類別(既有行為不變)", () => {
    it("自由文字理由必填;作廢後只有說明、沒有選項", async () => {
      const row = await approved();
      expectValidation(await voidIt(row, { reasonNote: "  " }), "reasonNote");
      const result = await voidIt(row, { reasonNote: "填錯" });
      expect(result.errors).toBeUndefined();
      expect(result.data?.voidSubmission.submission).toMatchObject({
        status: "VOIDED",
        voidReason: "填錯",
        voidReasonKey: null,
        voidReasonLabel: null,
      });
    });

    it("帶了選項 key → VALIDATION_FAILED(reasonKey)", async () => {
      const row = await approved();
      expectValidation(
        await voidIt(row, { reasonKey: "lost", reasonNote: "填錯" }),
        "reasonKey",
      );
    });

    it("formVoidReasonOptions:categoryKey = null、沒有選項", async () => {
      const data = await ok<OptionsPayload>(
        api,
        applicant(),
        VOID_REASON_OPTIONS,
        { formKey: FORM_KEY },
      );
      expect(data.formVoidReasonOptions).toEqual({
        categoryKey: null,
        items: [],
      });
    });
  });

  describe("表單設定", () => {
    it("不存在 / 格式不合的類別 key → VALIDATION_FAILED(voidReasonCategoryKey);空字串 = 清空", async () => {
      for (const key of ["no-such-category", "Bad Key"]) {
        const result = await call(api, world.root, UPDATE_FORM, {
          input: { key: FORM_KEY, voidReasonCategoryKey: key },
        });
        expect(codeOf(result)).toBe("VALIDATION_FAILED");
        expect(extensionsOf(result).fields).toEqual(["voidReasonCategoryKey"]);
      }
      const set = await ok<{
        updateForm: { form: { voidReasonCategoryKey: string | null } };
      }>(api, world.root, UPDATE_FORM, {
        input: { key: FORM_KEY, voidReasonCategoryKey: CATEGORY },
      });
      expect(set.updateForm.form.voidReasonCategoryKey).toBe(CATEGORY);
      const cleared = await ok<{
        updateForm: { form: { voidReasonCategoryKey: string | null } };
      }>(api, world.root, UPDATE_FORM, {
        input: { key: FORM_KEY, voidReasonCategoryKey: " " },
      });
      expect(cleared.updateForm.form.voidReasonCategoryKey).toBeNull();
    });
  });

  describe("設定了類別", () => {
    beforeEach(async () => {
      await setCategory(CATEGORY);
    });

    it("formVoidReasonOptions 列出該類別啟用中的選項(填寫者不需要欄位管理權限)", async () => {
      const data = await ok<OptionsPayload>(
        api,
        applicant(),
        VOID_REASON_OPTIONS,
        { formKey: FORM_KEY },
      );
      expect(data.formVoidReasonOptions.categoryKey).toBe(CATEGORY);
      expect(
        data.formVoidReasonOptions.items.map((item) => item.value),
      ).toEqual(["lost", "damaged", VOID_REASON_OTHER]);
    });

    it("沒選原因、選了不在類別內的 key → VALIDATION_FAILED(reasonKey),單據不動", async () => {
      const row = await approved();
      for (const reasonKey of [undefined, null, FOREIGN_VALUE, "nope"]) {
        expectValidation(
          await voidIt(row, {
            ...(reasonKey === undefined ? {} : { reasonKey }),
            reasonNote: "說明",
          }),
          "reasonKey",
        );
      }
      const stored = await api.connection
        .collection<{ status: string }>("form_submissions")
        .findOne({ _id: new Types.ObjectId(row.id) });
      expect(stored?.status).toBe("completed");
    });

    it("選「其他」時說明必填", async () => {
      const row = await approved();
      expectValidation(
        await voidIt(row, { reasonKey: VOID_REASON_OTHER, reasonNote: " " }),
        "reasonNote",
      );
      const result = await voidIt(row, {
        reasonKey: VOID_REASON_OTHER,
        reasonNote: "客人改期",
      });
      expect(result.data?.voidSubmission.submission).toMatchObject({
        voidReasonKey: VOID_REASON_OTHER,
        voidReasonLabel: "其他",
        voidReason: "客人改期",
      });
    });

    it("選一般選項:說明可空;存選項 key 與名稱;稽核記原因;掛接點拿得到原因", async () => {
      const row = await approved();
      const result = await voidIt(row, {
        reasonKey: "damaged",
        reasonNote: "",
      });
      expect(result.errors).toBeUndefined();
      expect(result.data?.voidSubmission.submission).toMatchObject({
        status: "VOIDED",
        voidReasonKey: "damaged",
        voidReasonLabel: "破損",
        voidReason: null,
      });
      const audit = await api.connection
        .collection<{ after?: Record<string, unknown> }>("audit_logs")
        .findOne({
          targetId: new Types.ObjectId(row.id),
          action: "submission.void",
        });
      expect(audit?.after).toMatchObject({
        status: "voided",
        reasonKey: "damaged",
        reason: null,
      });
      const guard = lifecycleProbe.guards.find(
        (entry) => entry.guard === "beforeVoid",
      );
      expect(guard?.context.voidReason).toEqual({
        reasonKey: "damaged",
        reasonLabel: "破損",
        reasonNote: null,
      });
      const effect = lifecycleProbe.effectContexts.find(
        (context) => context.event === "voided",
      );
      expect(effect?.voidReason).toEqual({
        reasonKey: "damaged",
        reasonLabel: "破損",
        reasonNote: null,
      });
    });
  });
});
