import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Types } from "mongoose";

import { AuditService } from "../../audit/audit.service";
import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { FormSubmissionsRepository } from "../../database/database.module";
import { currentSession } from "../../database/transaction";
import { StorageService } from "../../storage/storage.service";
import {
  COPY,
  FORM_KEY,
  type Person,
  VOID,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  decideOn,
  setupWorld,
  submission,
  submitLeave,
  uploadValue,
  useWorkflow,
  usersStep,
} from "../../workflows/test-support/workflow-fixtures";
import {
  CREATE_FORM_DRAFT,
  DELETE_SUBMISSION,
  SAVE_FORM_DRAFT,
  SUBMIT,
  UPDATE_SUBMISSION,
  call,
  codeOf,
  createDraft,
  createSubmitted,
  extensionsOf,
  ok,
} from "../test-support/form-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

/**
 * 表單提交的動作都是一個交易(ADR-0013):任一筆寫入失敗(以稽核失敗模擬,它是每個動作交易內的
 * 最後一筆寫入)→ 動作的寫入全部回復;複製為新單的 GCS 複製排在交易成功之後。
 * 「資料庫寫到一半失敗」在 GraphQL 端點上沒有辦法觸發,以 spy 讓 `AuditService.record` 在指定動作丟錯
 * (TEST-07 的第二個接縫)。
 */
describe("表單提交的交易(存草稿、刪除、複製為新單)", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  function nextKey(prefix: string): string {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  }

  function staff(index: number): Person {
    const found = world.staff[index];
    if (!found) {
      throw new Error(`staff[${String(index)}] 不存在`);
    }
    return found;
  }

  /** 讓 `action` 那一筆稽核丟錯(其他照常寫)。 */
  function failAuditOf(action: string): void {
    const audit = api.app.get(AuditService);
    const record = audit.record.bind(audit);
    jest
      .spyOn(audit, "record")
      .mockImplementation((operator, input) =>
        input.action === action
          ? Promise.reject(new Error(`injected failure at ${action}`))
          : record(operator, input),
      );
  }

  /** 讓交易前的重試核對漏看一次(模擬兩個請求同時通過核對),逼出交易內的重複鍵。 */
  function missRetryCheckOnce(): void {
    jest
      .spyOn(api.app.get(FormSubmissionsRepository), "findOwnOne")
      .mockResolvedValueOnce(null);
  }

  function rawSubmission(id: string) {
    return api.connection.collection("form_submissions").findOne<{
      values: Record<string, unknown>;
      editVersion: number;
      deletedAt: Date | null;
      replacedById: Types.ObjectId | null;
    }>({ _id: new Types.ObjectId(id) });
  }

  /** 走完流程後作廢的一筆(帶附件),複製為新單的來源。 */
  async function voidedWithAttachment(): Promise<WfSubmissionRow> {
    await useWorkflow(world, nextKey("tx_copy"), {
      steps: [usersStep("one", [staff(0)])],
    });
    const submitted = await submitLeave(world, {
      title: "附件要複製",
      days: 2,
      attachment: uploadValue(randomUUID()),
    });
    await decideOn(world, staff(0), submitted.id, "APPROVE");
    const approved = await submission(world, world.applicant, submitted.id);
    await ok(api, world.applicant.token, VOID, {
      input: {
        id: submitted.id,
        expectedEditVersion: approved.editVersion,
        reason: "重來",
      },
    });
    return approved;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_transactions", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  });

  it("存草稿中途失敗 → 值與 editVersion 都不變", async () => {
    const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
      title: "原本",
      days: 1,
    });
    failAuditOf("submission.save-draft");
    const failed = await call(api, world.applicant.token, SAVE_FORM_DRAFT, {
      input: {
        id: draft.id,
        expectedEditVersion: draft.editVersion,
        values: { title: "改過", days: 2 },
      },
    });
    expect(failed.errors).toBeDefined();
    const raw = await rawSubmission(draft.id);
    expect(raw?.values.title).toBe("原本");
    expect(raw?.editVersion).toBe(draft.editVersion);
  });

  it("刪除中途失敗 → 沒有被刪", async () => {
    const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
      title: "留著",
      days: 1,
    });
    failAuditOf("submission.delete");
    const failed = await call(api, world.applicant.token, DELETE_SUBMISSION, {
      input: { id: draft.id },
    });
    expect(failed.errors).toBeDefined();
    const kept = await rawSubmission(draft.id);
    expect(kept?.deletedAt).toBeNull();
  });

  it("不走流程的送出中途失敗 → 仍是草稿,修訂與 editVersion 都不變", async () => {
    const draft = await createDraft(api, world.applicant.token, FORM_KEY, {
      title: "送出會失敗",
      days: 1,
    });
    failAuditOf("submission.submit");
    const failed = await call(api, world.applicant.token, SUBMIT, {
      input: { id: draft.id, expectedEditVersion: draft.editVersion },
    });
    expect(failed.errors).toBeDefined();
    const raw = await rawSubmission(draft.id);
    expect(raw).toMatchObject({
      status: "draft",
      revision: 0,
      editVersion: draft.editVersion,
    });
  });

  it("修改已完成單中途失敗 → 值、修訂與 editVersion 都不變", async () => {
    const completed = await createSubmitted(
      api,
      world.applicant.token,
      FORM_KEY,
      { title: "原本", days: 1 },
    );
    failAuditOf("submission.update");
    const failed = await call(api, world.applicant.token, UPDATE_SUBMISSION, {
      input: {
        id: completed.id,
        expectedEditVersion: completed.editVersion,
        expectedRevision: completed.revision,
        values: { title: "改過", days: 2 },
      },
    });
    expect(failed.errors).toBeDefined();
    const raw = await rawSubmission(completed.id);
    expect(raw).toMatchObject({
      revision: completed.revision,
      editVersion: completed.editVersion,
    });
    expect(raw?.values.title).toBe("原本");
  });

  describe("clientRequestId 撞唯一索引(同一次請求的重試同時到)", () => {
    it("先建好的是同一張表單 → 交易回復後回那一筆", async () => {
      const clientRequestId = nextKey("race_same");
      const first = await createDraft(
        api,
        world.applicant.token,
        FORM_KEY,
        { title: "先到", days: 1 },
        clientRequestId,
      );
      missRetryCheckOnce();
      const second = await createDraft(
        api,
        world.applicant.token,
        FORM_KEY,
        { title: "後到", days: 1 },
        clientRequestId,
      );
      expect(second.id).toBe(first.id);
    });

    it("先建好的那一筆已刪除 → 409 CLIENT_REQUEST_REUSED(與交易前的核對同一條契約)", async () => {
      const clientRequestId = nextKey("race_deleted");
      const first = await createDraft(
        api,
        world.applicant.token,
        FORM_KEY,
        { title: "會刪", days: 1 },
        clientRequestId,
      );
      await ok(api, world.applicant.token, DELETE_SUBMISSION, {
        input: { id: first.id },
      });
      missRetryCheckOnce();
      const reused = await call(api, world.applicant.token, CREATE_FORM_DRAFT, {
        input: { formKey: FORM_KEY, clientRequestId, values: {} },
      });
      expect(codeOf(reused)).toBe("CONFLICT");
      expect(extensionsOf(reused).reason).toBe("CLIENT_REQUEST_REUSED");
    });
  });

  it("複製為新單:GCS 複製在交易提交之後才呼叫,新單帶的就是複製出來的路徑", async () => {
    const source = await voidedWithAttachment();
    const storage = api.app.get(StorageService);
    const copy = storage.copyPrivateObject.bind(storage);
    const seen: { inTransaction: boolean; draftCount: number }[] = [];
    const clientRequestId = nextKey("tx_copy_ok");
    const spy = jest
      .spyOn(storage, "copyPrivateObject")
      .mockImplementation(async (from, to) => {
        seen.push({
          inTransaction: currentSession() !== undefined,
          // 交易外讀得到新單 = 交易已提交
          draftCount: await api.connection
            .collection("form_submissions")
            .countDocuments({ clientRequestId }),
        });
        return copy(from, to);
      });
    const data = await ok<{
      copySubmissionToDraft: { submission: WfSubmissionRow };
    }>(api, world.applicant.token, COPY, {
      input: { id: source.id, clientRequestId },
    });
    const fresh = data.copySubmissionToDraft.submission;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ inTransaction: false, draftCount: 1 }]);
    const [from, to] = spy.mock.calls[0] ?? [];
    expect(from).toBe(
      (source.values.attachment as { path: string } | undefined)?.path,
    );
    expect((fresh.values.attachment as { path: string }).path).toBe(to);
    expect(fresh.clearedFields).toEqual([]);
  });

  it("複製為新單提交後附件複製失敗 → 那一欄清空、列進 clearedFields,並在交易外補記一筆稽核", async () => {
    const source = await voidedWithAttachment();
    const storage = api.app.get(StorageService);
    jest
      .spyOn(storage, "copyPrivateObject")
      .mockRejectedValue(new Error("模擬供應商失敗"));
    const data = await ok<{
      copySubmissionToDraft: { submission: WfSubmissionRow };
    }>(api, world.applicant.token, COPY, {
      input: { id: source.id, clientRequestId: nextKey("tx_copy_gcs_fail") },
    });
    const fresh = data.copySubmissionToDraft.submission;
    expect(fresh.clearedFields).toEqual(["attachment"]);
    expect(fresh.values.attachment ?? null).toBeNull();
    const audit = await api.connection.collection("audit_logs").findOne<{
      after: { clearedFields: string[] };
    }>({
      action: "submission.copy-attachments-failed",
      targetId: new Types.ObjectId(fresh.id),
    });
    expect(audit?.after.clearedFields).toEqual(["attachment"]);
  });

  it("複製為新單交易回復 → 沒有新單、來源沒被標記,GCS 複製一次都沒呼叫", async () => {
    const source = await voidedWithAttachment();
    const storage = api.app.get(StorageService);
    const spy = jest.spyOn(storage, "copyPrivateObject");
    failAuditOf("submission.copy");
    const clientRequestId = nextKey("tx_copy_fail");
    const failed = await call(api, world.applicant.token, COPY, {
      input: { id: source.id, clientRequestId },
    });
    expect(failed.errors).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
    expect(
      await api.connection
        .collection("form_submissions")
        .countDocuments({ clientRequestId }),
    ).toBe(0);
    const untouched = await rawSubmission(source.id);
    expect(untouched?.replacedById).toBeNull();

    // 同一個 clientRequestId 再送一次就成功(先前什麼都沒留下)
    jest.restoreAllMocks();
    const retried = await ok<{
      copySubmissionToDraft: { submission: WfSubmissionRow };
    }>(api, world.applicant.token, COPY, {
      input: { id: source.id, clientRequestId },
    });
    expect(retried.copySubmissionToDraft.submission.status).toBe("DRAFT");
  });
});
