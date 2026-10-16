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

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import {
  LIFECYCLE_BLOCKED_CODE,
  lifecycleProbe,
  resetLifecycleProbe,
} from "../../workflows/test-support/lifecycle-fixture";
import {
  COPY,
  FORM_KEY,
  VOID,
  WITHDRAW,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decideOn,
  setupWorld,
  submitLeave,
  useWorkflow,
  usersStep,
} from "../../workflows/test-support/workflow-fixtures";
import {
  DELETE_SUBMISSION,
  UPDATE_FORM,
  call,
  codeOf,
  createDraft,
  extensionsOf,
  nextRequestId,
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

const FIELDS = /* GraphQL */ `
  fragment AllowDraftSubmission on FormSubmissionModel {
    id
    status
    revision
    editVersion
    values
    currentInstanceId
    abilities {
      canEdit
      canSaveDraft
      canDelete
    }
  }
`;

const CREATE_AND_SUBMIT = /* GraphQL */ `
  ${FIELDS}
  mutation CreateAndSubmit($input: CreateAndSubmitFormSubmissionInput!) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        ...AllowDraftSubmission
      }
    }
  }
`;

const CREATE_DRAFT = /* GraphQL */ `
  ${FIELDS}
  mutation CreateDraft($input: CreateFormDraftInput!) {
    createFormDraft(input: $input) {
      submission {
        ...AllowDraftSubmission
      }
    }
  }
`;

const SAVE_DRAFT = /* GraphQL */ `
  ${FIELDS}
  mutation SaveDraft($input: SaveFormDraftInput!) {
    saveFormDraft(input: $input) {
      submission {
        ...AllowDraftSubmission
      }
    }
  }
`;

const SUBMIT = /* GraphQL */ `
  ${FIELDS}
  mutation Submit($input: SubmitFormSubmissionInput!) {
    submitFormSubmission(input: $input) {
      submission {
        ...AllowDraftSubmission
      }
    }
  }
`;

const GET = /* GraphQL */ `
  ${FIELDS}
  query Get($id: ID!) {
    formSubmission(id: $id) {
      submission {
        ...AllowDraftSubmission
      }
    }
  }
`;

const MODULE_FORMS = /* GraphQL */ `
  query ModuleForms($moduleKey: ID!) {
    moduleForms(moduleKey: $moduleKey) {
      key
      allowDraft
    }
  }
`;

interface Row {
  id: string;
  status: string;
  revision: number;
  editVersion: number;
  values: Record<string, unknown>;
  currentInstanceId: string | null;
  abilities: { canEdit: boolean; canSaveDraft: boolean; canDelete: boolean };
}

type Result = Awaited<ReturnType<typeof call>>;

function expectDraftDisabled(result: Result): void {
  expect(codeOf(result)).toBe("FORBIDDEN");
  expect(extensionsOf(result).reason).toBe("DRAFT_DISABLED");
}

function submittedRow(result: Result): Row {
  expect(result.errors).toBeUndefined();
  return (result.data as { createAndSubmitFormSubmission: { submission: Row } })
    .createAndSubmitFormSubmission.submission;
}

/**
 * 表單設定「允許存草稿」與直接送出(底座規格 10.10,真 Mongo):情境表每一列一個測試,
 * 另驗 `createAndSubmitFormSubmission` 走與 `submitFormSubmission` 同一條送出路徑(守門、事後動作、進流程)。
 */
describe("表單設定:允許存草稿 / 直接送出", () => {
  let api: AuthTestApp;
  let world: World;

  const applicant = () => world.applicant.token;
  const reviewer = () => world.staff[0] ?? world.manager;

  async function createAndSubmit(
    values: Record<string, unknown>,
    clientRequestId = nextRequestId(),
  ): Promise<Result> {
    return call(api, applicant(), CREATE_AND_SUBMIT, {
      input: { formKey: FORM_KEY, clientRequestId, values },
    });
  }

  async function get(id: string): Promise<Row> {
    const data = await ok<{ formSubmission: { submission: Row } }>(
      api,
      applicant(),
      GET,
      { id },
    );
    return data.formSubmission.submission;
  }

  /** 申請人的提交數(含草稿;依標題找)。 */
  function countByTitle(title: string): Promise<number> {
    return api.connection
      .collection("form_submissions")
      .countDocuments({ formKey: FORM_KEY, "values.title": title });
  }

  function auditCount(id: string, action: string): Promise<number> {
    return api.connection
      .collection("audit_logs")
      .countDocuments({ targetId: new Types.ObjectId(id), action });
  }

  /** root 改共用病假表單的「允許存草稿」(表單設定,`updateForm`)。 */
  async function setAllowDraft(allowDraft: boolean): Promise<void> {
    await ok(api, world.root, UPDATE_FORM, {
      input: { key: FORM_KEY, allowDraft },
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_allow_draft", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 1);
  });

  beforeEach(async () => {
    resetLifecycleProbe();
    await setAllowDraft(true);
  });

  afterAll(async () => {
    await api.close();
  });

  describe("沒綁流程", () => {
    it("既有表單(沒有這個設定)視為開:moduleForms.allowDraft = true,可建草稿", async () => {
      await api.connection
        .collection("forms")
        .updateOne({ key: FORM_KEY }, { $unset: { allowDraft: "" } });

      const data = await ok<{
        moduleForms: { key: string; allowDraft: boolean }[];
      }>(api, applicant(), MODULE_FORMS, { moduleKey: WORKFLOW_MODULE });
      expect(data.moduleForms).toContainEqual({
        key: FORM_KEY,
        allowDraft: true,
      });
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "舊表單的草稿",
      });
      expect(draft.status).toBe("DRAFT");
    });

    it("新增頁按 [送出]、守門通過 → 一個交易建立並送出,沒有產生草稿;守門與事後動作照常", async () => {
      const done = submittedRow(
        await createAndSubmit({ title: "直接送出", days: 2 }),
      );

      expect(done).toMatchObject({ status: "COMPLETED", revision: 1 });
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeSubmit",
      ]);
      expect(lifecycleProbe.guards[0]?.context.values).toMatchObject({
        title: "直接送出",
      });
      expect(lifecycleProbe.effects.map((one) => one.event)).toEqual([
        "submitted",
        "completed",
      ]);
      // 稽核只記送出(direct),沒有「建草稿」
      expect(await auditCount(done.id, "submission.create-draft")).toBe(0);
      expect(await auditCount(done.id, "submission.submit")).toBe(1);
    });

    it("新增頁按 [送出]、守門擋下 → 整個交易回復,資料庫不留任何資料", async () => {
      lifecycleProbe.blockOn = "beforeSubmit";
      const result = await createAndSubmit({ title: "被守門擋下", days: 1 });

      expect(codeOf(result)).toBe("FORBIDDEN");
      expect(extensionsOf(result).reason).toBe(LIFECYCLE_BLOCKED_CODE);
      expect(await countByTitle("被守門擋下")).toBe(0);
      expect(lifecycleProbe.effects).toEqual([]);
    });

    it("新增頁按 [送出]、驗證失敗 → 整個交易回復,資料庫不留任何資料", async () => {
      const result = await createAndSubmit({ title: "驗證失敗", days: "三天" });

      expect(codeOf(result)).toBe("VALIDATION_FAILED");
      expect(await countByTitle("驗證失敗")).toBe(0);
      expect(lifecycleProbe.guards).toEqual([]);
    });

    it("同一個 clientRequestId 重送:回原本那一筆,不建第二筆", async () => {
      const requestId = nextRequestId();
      const first = submittedRow(
        await createAndSubmit({ title: "重送", days: 1 }, requestId),
      );
      const again = submittedRow(
        await createAndSubmit({ title: "重送", days: 1 }, requestId),
      );

      expect(again.id).toBe(first.id);
      expect(await countByTitle("重送")).toBe(1);
    });

    it("重送命中先前存的草稿:沒被改過(editVersion 0)就送出它;已被改過 → CONFLICT EDIT_VERSION_MISMATCH", async () => {
      const fresh = nextRequestId();
      const draft = await createDraft(
        api,
        applicant(),
        FORM_KEY,
        { title: "先存的草稿" },
        fresh,
      );
      const sent = submittedRow(
        await createAndSubmit({ title: "先存的草稿(送出)", days: 1 }, fresh),
      );
      expect(sent).toMatchObject({ id: draft.id, status: "COMPLETED" });
      expect(sent.values.title).toBe("先存的草稿(送出)");

      const edited = nextRequestId();
      const other = await createDraft(
        api,
        applicant(),
        FORM_KEY,
        { title: "被改過的草稿" },
        edited,
      );
      await ok(api, applicant(), SAVE_DRAFT, {
        input: {
          id: other.id,
          expectedEditVersion: other.editVersion,
          values: { title: "別處改過" },
        },
      });
      const result = await createAndSubmit({ title: "重送蓋掉" }, edited);
      expect(codeOf(result)).toBe("CONFLICT");
      expect(extensionsOf(result).reason).toBe("EDIT_VERSION_MISMATCH");
      const kept = await get(other.id);
      expect(kept).toMatchObject({ status: "DRAFT" });
      expect(kept.values.title).toBe("別處改過");
    });

    it("新增頁按 [存草稿](允許存草稿開)→ 建草稿;草稿不觸發任何事後動作", async () => {
      const result = await call(api, applicant(), CREATE_DRAFT, {
        input: {
          formKey: FORM_KEY,
          clientRequestId: nextRequestId(),
          values: { title: "存草稿" },
        },
      });

      expect(result.errors).toBeUndefined();
      const draft = (result.data as { createFormDraft: { submission: Row } })
        .createFormDraft.submission;
      expect(draft.status).toBe("DRAFT");
      expect(draft.abilities.canSaveDraft).toBe(true);
      expect(lifecycleProbe.effects).toEqual([]);
      expect(lifecycleProbe.guards).toEqual([]);
    });

    it("允許存草稿關:新增頁 / 編輯頁不顯示 [存草稿](moduleForms.allowDraft、abilities.canSaveDraft 為 false)", async () => {
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "關掉前的草稿(按鈕)",
      });
      await setAllowDraft(false);

      const data = await ok<{
        moduleForms: { key: string; allowDraft: boolean }[];
      }>(api, applicant(), MODULE_FORMS, { moduleKey: WORKFLOW_MODULE });
      expect(data.moduleForms).toContainEqual({
        key: FORM_KEY,
        allowDraft: false,
      });
      const row = await get(draft.id);
      expect(row.abilities).toMatchObject({
        canEdit: true,
        canSaveDraft: false,
      });
    });

    it("允許存草稿關:createFormDraft / saveFormDraft(狀態草稿)→ FORBIDDEN DRAFT_DISABLED", async () => {
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "關掉前的草稿(存)",
      });
      await setAllowDraft(false);

      expectDraftDisabled(
        await call(api, applicant(), CREATE_DRAFT, {
          input: {
            formKey: FORM_KEY,
            clientRequestId: nextRequestId(),
            values: { title: "不能建" },
          },
        }),
      );
      expectDraftDisabled(
        await call(api, applicant(), SAVE_DRAFT, {
          input: {
            id: draft.id,
            expectedEditVersion: draft.editVersion,
            values: { title: "不能存" },
          },
        }),
      );
      expect(await countByTitle("不能建")).toBe(0);
      const kept = await get(draft.id);
      expect(kept.values.title).toBe("關掉前的草稿(存)");
      // 直接送出不受影響
      expect(
        submittedRow(await createAndSubmit({ title: "關掉後直接送出" })).status,
      ).toBe("COMPLETED");
    });

    it("允許存草稿關:關掉前已經存在的草稿照樣可以打開、送出(帶畫面上的值)、刪除", async () => {
      const toSubmit = await createDraft(api, applicant(), FORM_KEY, {
        title: "舊草稿",
        days: 1,
      });
      const toDelete = await createDraft(api, applicant(), FORM_KEY, {
        title: "要刪的舊草稿",
      });
      await setAllowDraft(false);

      const opened = await get(toSubmit.id);
      expect(opened.status).toBe("DRAFT");
      const submitted = await ok<{
        submitFormSubmission: { submission: Row };
      }>(api, applicant(), SUBMIT, {
        input: {
          id: toSubmit.id,
          expectedEditVersion: toSubmit.editVersion,
          values: { title: "舊草稿(改過再送)", days: 2 },
        },
      });
      expect(submitted.submitFormSubmission.submission).toMatchObject({
        status: "COMPLETED",
        values: expect.objectContaining({ title: "舊草稿(改過再送)" }),
      });

      const removed = await call(api, applicant(), DELETE_SUBMISSION, {
        input: { id: toDelete.id },
      });
      expect(removed.errors).toBeUndefined();
    });
  });

  describe("綁了流程", () => {
    beforeAll(async () => {
      await useWorkflow(world, "allow_draft_review", {
        steps: [usersStep("review", [world.staff[0] ?? world.manager])],
      });
    });

    it("新增頁按 [送出] → 一個交易建立並送審(reviewing、有實例),守門照常", async () => {
      const sent = submittedRow(
        await createAndSubmit({ title: "直接送審", days: 3 }),
      );

      expect(sent.status).toBe("REVIEWING");
      expect(sent.currentInstanceId).not.toBeNull();
      expect(lifecycleProbe.guards.map((one) => one.guard)).toEqual([
        "beforeSubmit",
      ]);
      expect(lifecycleProbe.effects.map((one) => one.event)).toContain(
        "submitted",
      );
    });

    it("新增頁按 [送出]、守門擋下(綁流程)→ 沒有提交、也沒有實例", async () => {
      lifecycleProbe.blockOn = "beforeSubmit";
      const result = await createAndSubmit({ title: "送審被擋", days: 1 });

      expect(codeOf(result)).toBe("FORBIDDEN");
      expect(await countByTitle("送審被擋")).toBe(0);
      expect(
        await api.connection
          .collection("workflow_instances")
          .countDocuments({ "summary.title": "送審被擋" }),
      ).toBe(0);
    });

    it("允許存草稿關:被退回 / 撤回的單只能修改後重新送出,不顯示 [存草稿]", async () => {
      const returned = await submitLeave(world, { title: "會被退回", days: 1 });
      await decideOn(world, reviewer(), returned.id, "RETURN");
      const withdrawn = await submitLeave(world, { title: "會撤回", days: 1 });
      await ok(api, applicant(), WITHDRAW, {
        input: { id: withdrawn.id, expectedEditVersion: withdrawn.editVersion },
      });
      await setAllowDraft(false);

      for (const id of [returned.id, withdrawn.id]) {
        const row = await get(id);
        expect(["RETURNED", "WITHDRAWN"]).toContain(row.status);
        expect(row.abilities).toMatchObject({
          canEdit: true,
          canSaveDraft: false,
        });
        const resent = await ok<{
          submitFormSubmission: { submission: Row };
        }>(api, applicant(), SUBMIT, {
          input: {
            id,
            expectedEditVersion: row.editVersion,
            values: { ...row.values, note: "改好了" },
          },
        });
        expect(resent.submitFormSubmission.submission).toMatchObject({
          status: "REVIEWING",
          values: expect.objectContaining({ note: "改好了" }),
        });
      }
    });

    it("允許存草稿關:複製為新單不受影響(複製出來的草稿照常建立)", async () => {
      const approved = await submitLeave(world, { title: "要作廢", days: 1 });
      await decideOn(world, reviewer(), approved.id, "APPROVE");
      const latest = await get(approved.id);
      await ok(api, applicant(), VOID, {
        input: {
          id: approved.id,
          expectedEditVersion: latest.editVersion,
          reason: "填錯",
        },
      });
      await setAllowDraft(false);

      const copied = await ok<{
        copySubmissionToDraft: { submission: Row };
      }>(api, applicant(), COPY, {
        input: { id: approved.id, clientRequestId: nextRequestId() },
      });
      expect(copied.copySubmissionToDraft.submission.status).toBe("DRAFT");
    });
  });
});
