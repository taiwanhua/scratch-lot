import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import {
  ASSIGN,
  CREATE_FORM,
  DELETE_SUBMISSION,
  FORM_SUBMISSIONS,
  UPDATE_SUBMISSION,
  call,
  column,
  createDraft,
  definitionOf,
  field,
  ok,
  publishDefinition,
} from "../../forms/test-support/form-fixtures";
import { MailService } from "../../mail/mail.service";
import { RecordingMailService } from "../../mail/recording-mail.service";
import { createRole } from "../../permission/test-support/fixtures";
import { RecordingStorageService } from "../../storage/recording-storage.service";
import { StorageService } from "../../storage/storage.service";
import { interleaveAt, interruptAt } from "../test-support/hooks-fixture";
import {
  ADD_ASSIGNEE,
  APPLICABLE_FORMS,
  BLOCKED_INSTANCES,
  COPY,
  DECIDE,
  FORM_KEY,
  type InstanceRow,
  MY_APPLICATIONS,
  PERSON_SCOPES,
  type Person,
  REASSIGN,
  SAVE_SUBMISSION,
  SUBMISSION,
  type TaskRow,
  UNBIND,
  VOID,
  WITHDRAW,
  WORKFLOW_INSTANCE,
  WORKFLOW_MODULE,
  WORKFLOW_TEST_TIMEOUT_MS,
  type WfSubmissionRow,
  type World,
  bindForm,
  byText,
  currentInstance,
  decide,
  decideOn,
  errorCode,
  errorReason,
  joinStep,
  pendingTaskOf,
  person,
  rawTasks,
  retryAdvance,
  reviewStep,
  roleSource,
  setupWorld,
  stepOfRow,
  submission,
  submissionStatus,
  submitExisting,
  submitLeave,
  taskStatuses,
  tasksOf,
  uploadValue,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

async function setEnabled(
  world: World,
  who: Person,
  enabled: boolean,
): Promise<void> {
  await ok(world.api, world.root, SET_USER_ENABLED, {
    input: { id: String(who.userId), enabled },
  });
}

async function blockedFlagOf(
  world: World,
  submissionId: string,
): Promise<boolean | undefined> {
  const data = await ok<{
    myApplications: { items: { id: string; blocked: boolean }[] };
  }>(world.api, world.applicant.token, MY_APPLICATIONS, {
    input: { pageSize: 100 },
  });
  return data.myApplications.items.find((row) => row.id === submissionId)
    ?.blocked;
}

const SET_USER_ENABLED = /* GraphQL */ `
  mutation SetUserEnabled($input: SetUserEnabledInput!) {
    setUserEnabled(input: $input) {
      user {
        id
      }
    }
  }
`;

const SET_USER_ORGS = /* GraphQL */ `
  mutation SetUserOrgs($input: SetUserOrgsInput!) {
    setUserOrgs(input: $input) {
      removedOrgs {
        id
      }
    }
  }
`;

const ATTACHMENT_URL = /* GraphQL */ `
  query Attachment($id: ID!, $fieldKey: String!, $revision: Int) {
    formSubmissionAttachmentUrl(
      id: $id
      fieldKey: $fieldKey
      revision: $revision
    ) {
      url
    }
  }
`;

const RUNTIME_VERSION = /* GraphQL */ `
  query RuntimeVersion($formKey: ID!, $version: Int!) {
    formRuntimeVersion(formKey: $formKey, version: $version) {
      formVersion {
        version
      }
    }
  }
`;

interface ApplicationRow {
  id: string;
  moduleKey: string;
  status: string;
  blocked: boolean;
  summary: { title: string | null } | null;
  activeSteps: { stepKey: string }[];
}

/**
 * 讀取授權(`canReadSubmissionRevision`)、申請中心、提交狀態的二值假設、作廢 / 複製為新單、
 * 審核者失效 / 改派 / 新增審核者、阻擋清單、通知關閉(真 Mongo,Spec 6b §3、§6、§7、§10)。
 */
describe("申請中心與讀取授權", () => {
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

  /** 只有申請中心權限的審核者(沒有示範表單模組的任何權限)。 */
  /**
   * 明細列的複製為新單:建一張有明細的表單、送出、核准、作廢;`nextColumns` 給了就先發布新版(子欄改了)
   * 再複製。回複製出的新單的列與原本的列。
   */
  /**
   * 建一張有明細的單、核准後作廢,再複製為新單。`setup` 可換子欄與列,`beforeCopy` 在複製前跑
   * (例:刪掉被引用的人)。
   */
  async function copyArraySubmission(
    nextColumns: ReturnType<typeof column>[] | null,
    setup: {
      columns?: ReturnType<typeof column>[];
      rows?: ({ rowId: string } & Record<string, unknown>)[];
      beforeCopy?: () => Promise<void>;
    } = {},
  ): Promise<{
    rows: { rowId: string }[];
    copied: Record<string, unknown>[];
    clearedFields: string[];
  }> {
    const formKey = nextKey("copy_array");
    const columns = setup.columns ?? [
      column("name", "text"),
      column("qty", "number"),
    ];
    await ok(api, world.root, CREATE_FORM, {
      input: { key: formKey, moduleKey: WORKFLOW_MODULE, name: "明細複製" },
    });
    await publishDefinition(
      api,
      world.root,
      formKey,
      definitionOf([
        field("title", "text"),
        field("items", "array", { columns }),
      ]),
      null,
    );
    await ok(api, world.root, ASSIGN, {
      input: { formKey, tenantOrgIds: [String(world.tenant)] },
    });
    const key = nextKey("copy_array_flow");
    const reviewer = await reviewerOnly();
    await useWorkflow(world, key, { steps: [usersStep("one", [reviewer])] });
    await bindForm(world, key, formKey);
    const rows = setup.rows ?? [
      { rowId: randomUUID(), name: "甲", qty: 1 },
      { rowId: randomUUID(), name: "乙", qty: 2 },
    ];
    const draft = await createDraft(api, world.applicant.token, formKey, {
      title: "有明細的單",
      items: rows,
    });
    const submitted = await submitExisting(world, draft);
    await decideOn(world, reviewer, submitted.id, "APPROVE");
    const approved = await submission(world, world.applicant, submitted.id);
    await ok(api, world.applicant.token, VOID, {
      input: {
        id: submitted.id,
        expectedEditVersion: approved.editVersion,
        reason: "重開",
      },
    });
    if (nextColumns !== null) {
      await publishDefinition(
        api,
        world.root,
        formKey,
        definitionOf([
          field("title", "text"),
          field("items", "array", { columns: nextColumns }),
        ]),
        1,
      );
    }
    await setup.beforeCopy?.();
    const copied = await ok<{
      copySubmissionToDraft: { submission: WfSubmissionRow };
    }>(api, world.applicant.token, COPY, {
      input: { id: submitted.id, clientRequestId: nextKey("copy_array") },
    });
    await bindForm(world, key, FORM_KEY);
    return {
      rows,
      copied: copied.copySubmissionToDraft.submission.values.items as Record<
        string,
        unknown
      >[],
      clearedFields: copied.copySubmissionToDraft.submission.clearedFields,
    };
  }

  async function reviewerOnly(): Promise<Person> {
    return person(api, world.connection, world.tenant, world.tenant, {
      moduleKeys: ["apply-center", "apply-center.view-page"],
      permissionKeys: ["apply-center.view"],
    });
  }

  async function applications(who: Person): Promise<ApplicationRow[]> {
    const data = await ok<{ myApplications: { items: ApplicationRow[] } }>(
      api,
      who.token,
      MY_APPLICATIONS,
      { input: { pageSize: 100 } },
    );
    return data.myApplications.items;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_apply_center", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 6);
  });

  afterAll(async () => {
    await api.close();
  });

  describe("canReadSubmissionRevision", () => {
    let reviewerA: Person;
    let reviewerB: Person;
    let reviewerC: Person;
    let submitted: WfSubmissionRow;
    let firstInstanceId: string;

    beforeAll(async () => {
      reviewerA = await reviewerOnly();
      reviewerB = await reviewerOnly();
      reviewerC = await reviewerOnly();
      await useWorkflow(world, nextKey("scope_a"), {
        steps: [usersStep("one", [reviewerA])],
      });
      submitted = await submitLeave(world, {
        title: "第一版",
        days: 3,
        attachment: uploadValue(randomUUID()),
      });
      const firstInstance = await currentInstance(world, submitted.id);
      firstInstanceId = firstInstance.id;
      await decideOn(world, reviewerA, submitted.id, "RETURN");
      const returned = await submission(world, world.applicant, submitted.id);
      const saved = await ok<{
        saveFormDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, SAVE_SUBMISSION, {
        input: {
          id: submitted.id,
          expectedEditVersion: returned.editVersion,
          values: {
            title: "第二版",
            days: 3,
            attachment: uploadValue(randomUUID()),
          },
        },
      });
      // 申請人正在改(還沒再送出):審過修訂 1 的人讀到的仍是修訂 1 的快照
      const whileEditing = await submission(world, reviewerA, submitted.id);
      expect(whileEditing.values.title).toBe("第一版");
      await useWorkflow(world, nextKey("scope_b"), {
        steps: [usersStep("one", [reviewerB])],
      });
      await submitExisting(world, saved.saveFormDraft.submission);
    });

    it("任務持有者只讀得到他審的那個修訂(摘要也是那個修訂的),讀不到之後的修訂", async () => {
      const row = await submission(world, reviewerA, submitted.id);
      expect(row.viewedRevision).toBe(1);
      expect(row.values.title).toBe("第一版");
      expect(row.summary?.title).toBe("第一版");
      expect(row.revisions.map((entry) => entry.revision)).toEqual([1]);
      expect(row.abilities).toMatchObject({
        canEdit: false,
        canDelete: false,
        canVoid: false,
      });
      // 提交層的現況(目前實例、作廢、複製)不給只審過某修訂的人
      expect(row).toMatchObject({
        currentInstanceId: null,
        blocked: false,
        voidReason: null,
        replacedById: null,
        copiedFrom: null,
      });
      const own = await submission(world, world.applicant, submitted.id);
      expect(own.currentInstanceId).not.toBeNull();
      const later = await call(api, reviewerA.token, SUBMISSION, {
        id: submitted.id,
        revision: 2,
      });
      expect(errorCode(later)).toBe("FORBIDDEN");
    });

    it("附件簽名網址同一個範圍;沒有模組權限也拿得到該版表單定義", async () => {
      const own = await call(api, reviewerA.token, ATTACHMENT_URL, {
        id: submitted.id,
        fieldKey: "attachment",
        revision: 1,
      });
      expect(own.errors).toBeUndefined();
      const other = await call(api, reviewerA.token, ATTACHMENT_URL, {
        id: submitted.id,
        fieldKey: "attachment",
        revision: 2,
      });
      expect(errorCode(other)).toBe("FORBIDDEN");
      const definition = await call(api, reviewerA.token, RUNTIME_VERSION, {
        formKey: FORM_KEY,
        version: 1,
      });
      expect(definition.errors).toBeUndefined();
    });

    it("實例詳情:審過修訂 1 的人讀得到修訂 1 的實例、讀不到修訂 2 的;列表不放寬", async () => {
      const first = await call(api, reviewerA.token, WORKFLOW_INSTANCE, {
        id: firstInstanceId,
      });
      expect(first.errors).toBeUndefined();
      const current = await currentInstance(world, submitted.id);
      const second = await call(api, reviewerA.token, WORKFLOW_INSTANCE, {
        id: current.id,
      });
      expect(errorCode(second)).toBe("NOT_FOUND");
      const list = await call(api, reviewerA.token, FORM_SUBMISSIONS, {
        input: { moduleKey: WORKFLOW_MODULE, pageSize: 100 },
      });
      expect(errorCode(list)).toBe("FORBIDDEN");
    });

    it("「待我審核」已處理列表在單據重送後仍顯示舊修訂的標題", async () => {
      const done = await tasksOf(world, reviewerA, true);
      const task = done.find((one) => one.submissionId === submitted.id);
      expect(task?.status).toBe("RETURNED");
      expect(task?.summary?.title).toBe("第一版");
    });

    it("曾持有(被改派走)的人仍可讀該修訂;申請人讀得到全部修訂", async () => {
      const task = await pendingTaskOf(world, reviewerB, submitted.id);
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: task.id, toUserId: String(reviewerC.userId) },
      });
      const row = await submission(world, reviewerB, submitted.id);
      expect(row.viewedRevision).toBe(2);
      expect(row.values.title).toBe("第二版");
      const first = await submission(world, world.applicant, submitted.id, 1);
      expect(first.values.title).toBe("第一版");
      const second = await submission(world, world.applicant, submitted.id, 2);
      expect(second.revisions.map((entry) => entry.revision)).toEqual([1, 2]);
    });
  });

  describe("申請中心", () => {
    it("我的申請 / 待我審核 / 新申請:跨模組、以租戶為邊界", async () => {
      const both = await person(
        api,
        world.connection,
        world.kitchen,
        world.tenant,
        {
          moduleKeys: [...PERSON_SCOPES.userModules, "demo-form"],
          permissionKeys: [...PERSON_SCOPES.userPermissions, "demo-form.*"],
        },
      );
      const shoppingForm = nextKey("shopping_bound");
      await ok(api, world.root, CREATE_FORM, {
        input: { key: shoppingForm, moduleKey: "demo-form", name: "採購" },
      });
      await publishDefinition(
        api,
        world.root,
        shoppingForm,
        definitionOf([field("title", "text"), field("days", "number")]),
        null,
      );
      await ok(api, world.root, ASSIGN, {
        input: { formKey: shoppingForm, tenantOrgIds: [String(world.tenant)] },
      });
      const key = nextKey("cross_module");
      await useWorkflow(world, key, { steps: [usersStep("one", [staff(0)])] });
      await bindForm(world, key, shoppingForm);
      const leave = await submitLeave(world, null, both);
      const shoppingDraft = await createDraft(api, both.token, shoppingForm, {
        title: "買菜",
        days: 1,
      });
      const shopping = await submitExisting(world, shoppingDraft, both);
      const mine = await applications(both);
      expect(mine.map((row) => row.moduleKey).toSorted(byText)).toEqual(
        [WORKFLOW_MODULE, "demo-form"].toSorted(byText),
      );
      expect(mine.every((row) => row.status === "REVIEWING")).toBe(true);
      expect(mine[0]?.activeSteps).toEqual([{ stepKey: "one" }]);
      const forms = await ok<{
        applicableForms: { moduleKey: string; forms: { key: string }[] }[];
      }>(api, both.token, APPLICABLE_FORMS);
      expect(
        forms.applicableForms.map((group) => group.moduleKey).toSorted(byText),
      ).toEqual([WORKFLOW_MODULE, "demo-form"].toSorted(byText));
      const tasks = await tasksOf(world, staff(0));
      expect(
        tasks
          .filter(
            (task) =>
              task.submissionId === leave.id ||
              task.submissionId === shopping.id,
          )
          .map((task) => task.formKey)
          .toSorted(byText),
      ).toEqual([FORM_KEY, shoppingForm].toSorted(byText));
      // 別的租戶的人:什麼都看不到
      const otherTenant = await createOrg(world.connection, { name: "別租戶" });
      const stranger = await person(
        api,
        world.connection,
        otherTenant,
        otherTenant,
      );
      expect(await applications(stranger)).toEqual([]);
      const instance = await currentInstance(world, leave.id);
      const denied = await call(api, stranger.token, WORKFLOW_INSTANCE, {
        id: instance.id,
      });
      expect(errorCode(denied)).toBe("NOT_FOUND");
      await bindForm(world, key, FORM_KEY);
    });
  });

  describe("提交狀態的二值假設與作廢 / 複製", () => {
    it("綁流程的 completed 不可 updateFormSubmission,不綁的可;審核中的單出現在有 view 者的列表;已駁回可刪、審核中不可刪", async () => {
      await useWorkflow(world, nextKey("locked"), {
        steps: [usersStep("one", [staff(0)])],
      });
      const bound = await submitLeave(world);
      await decideOn(world, staff(0), bound.id, "APPROVE");
      const approved = await submission(world, world.applicant, bound.id);
      const locked = await call(api, world.applicant.token, UPDATE_SUBMISSION, {
        input: {
          id: bound.id,
          expectedEditVersion: approved.editVersion,
          expectedRevision: approved.revision,
          values: { title: "偷改", days: 3 },
        },
      });
      expect(errorCode(locked)).toBe("CONFLICT");
      const reviewing = await submitLeave(world);
      const listed = await ok<{ formSubmissions: { items: { id: string }[] } }>(
        api,
        world.applicant.token,
        FORM_SUBMISSIONS,
        {
          input: {
            moduleKey: WORKFLOW_MODULE,
            status: "REVIEWING",
            pageSize: 100,
          },
        },
      );
      expect(listed.formSubmissions.items.map((row) => row.id)).toContain(
        reviewing.id,
      );
      const notDeletable = await call(
        api,
        world.applicant.token,
        DELETE_SUBMISSION,
        {
          input: { id: reviewing.id },
        },
      );
      expect(errorCode(notDeletable)).toBe("CONFLICT");
      await decideOn(world, staff(0), reviewing.id, "REJECT");
      const deleted = await call(
        api,
        world.applicant.token,
        DELETE_SUBMISSION,
        {
          input: { id: reviewing.id },
        },
      );
      expect(deleted.errors).toBeUndefined();
      // 不綁流程:6a 的已完成後修改照舊
      await ok(api, world.admin.token, UNBIND, {
        input: { formKey: FORM_KEY },
      });
      const plain = await submitLeave(world);
      expect(plain.status).toBe("COMPLETED");
      const plainRow = await submission(world, world.applicant, plain.id);
      const edited = await call(api, world.applicant.token, UPDATE_SUBMISSION, {
        input: {
          id: plain.id,
          expectedEditVersion: plainRow.editVersion,
          expectedRevision: plainRow.revision,
          values: { title: "可以改", days: 3 },
        },
      });
      expect(edited.errors).toBeUndefined();
    });

    it("作廢不需審核;複製為新單:欄位篩選、引用失效清空、附件複製、clientRequestId 去重", async () => {
      const formKey = nextKey("copy_form");
      const v1 = [
        field("title", "text"),
        field("days", "number"),
        field("start", "date"),
        field("approver", "reference", {
          source: { provider: "user", labelField: "name" },
        }),
        field("attachment", "upload"),
        field("scan", "upload"),
        field("extra", "text"),
      ];
      await ok(api, world.root, CREATE_FORM, {
        input: { key: formKey, moduleKey: WORKFLOW_MODULE, name: "複製測試" },
      });
      await publishDefinition(
        api,
        world.root,
        formKey,
        definitionOf(v1, { summaryMap: { title: "title", date: "start" } }),
        null,
      );
      await ok(api, world.root, ASSIGN, {
        input: { formKey, tenantOrgIds: [String(world.tenant)] },
      });
      const key = nextKey("copy_flow");
      const copyReviewer = await reviewerOnly();
      await useWorkflow(world, key, {
        steps: [usersStep("one", [copyReviewer])],
      });
      await bindForm(world, key, formKey);
      const colleague = await person(
        api,
        world.connection,
        world.kitchen,
        world.tenant,
      );
      const attachment = uploadValue(randomUUID());
      const draft = await createDraft(api, world.applicant.token, formKey, {
        title: "要作廢的",
        days: 3,
        start: "2026-09-26T00:00:00+08:00",
        approver: { id: String(colleague.userId), label: null },
        attachment,
        scan: uploadValue(randomUUID()),
        extra: "舊欄位",
      });
      const submitted = await submitExisting(world, draft);
      // 送出建的流程實例:摘要槽 date(對日期欄)存 Mongo Date,和提交的摘要同一個時點
      const instance = await world.connection
        .collection("workflow_instances")
        .findOne({ submissionId: new Types.ObjectId(submitted.id) });
      const instanceDate = (instance?.summary as { date?: unknown } | null)
        ?.date;
      expect(instanceDate).toBeInstanceOf(Date);
      expect((instanceDate as Date).toISOString()).toBe(draft.values.start);
      await decideOn(world, copyReviewer, submitted.id, "APPROVE");
      const approved = await submission(world, world.applicant, submitted.id);
      // 沒有 edit 的別人不能作廢
      const outsider = await reviewerOnly();
      const denied = await call(api, outsider.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "不是我的",
        },
      });
      expect(denied.errors).toBeDefined();
      const voided = await ok<{
        voidSubmission: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "日期填錯",
        },
      });
      expect(voided.voidSubmission.submission).toMatchObject({
        status: "VOIDED",
        voidReason: "日期填錯",
      });
      expect(voided.voidSubmission.submission.abilities.canCopy).toBe(true);
      // 表單改版:extra 刪掉(目標版本沒有的欄位不複製);title 加預設值(不覆蓋複製來的值)、
      // 新欄位 memo 有預設值(來源沒有 → 填預設值);scan 改成只收 PNG(舊的 PDF 不符 → 清空)
      await publishDefinition(
        api,
        world.root,
        formKey,
        definitionOf([
          field("title", "text", {
            default: { kind: "constant", value: "預設標題" },
          }),
          field("memo", "text", {
            default: { kind: "constant", value: "新欄位的預設值" },
          }),
          field("days", "number"),
          field("start", "date"),
          field("approver", "reference", {
            source: { provider: "user", labelField: "name" },
          }),
          field("attachment", "upload"),
          field("scan", "upload", { rules: { accept: ["image/png"] } }),
        ]),
        1,
      );
      // 引用的同事被刪 → 引用失效
      await world.connection
        .collection("users")
        .updateOne(
          { _id: colleague.userId },
          { $set: { deletedAt: new Date() } },
        );
      const requestId = nextKey("copy_request");
      const copied = await ok<{
        copySubmissionToDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, COPY, {
        input: { id: submitted.id, clientRequestId: requestId },
      });
      const fresh = copied.copySubmissionToDraft.submission;
      expect(fresh.status).toBe("DRAFT");
      expect(fresh.copiedFrom).toBe(submitted.id);
      expect(fresh.clearedFields).toEqual(["approver", "scan"]);
      expect(fresh.values.scan ?? null).toBeNull();
      expect(fresh.values.title).toBe("要作廢的");
      expect(fresh.values.memo).toBe("新欄位的預設值");
      // 數字存十進位字串
      expect(fresh.values.days).toBe("3");
      // 日期:複製來的仍存 Date(GraphQL 讀回同一個 ISO 時點)
      expect(fresh.values.start).toMatch(/^2026-09-2\dT\d{2}:00:00\.000Z$/);
      expect(fresh.values.start).toBe(approved.values.start);
      const rawCopy = await world.connection
        .collection("form_submissions")
        .findOne({ _id: new Types.ObjectId(fresh.id) });
      expect((rawCopy?.values as Record<string, unknown>).start).toBeInstanceOf(
        Date,
      );
      expect(fresh.values.extra).toBeUndefined();
      const copiedPath = (fresh.values.attachment as { path: string }).path;
      expect(copiedPath).not.toBe(attachment.path);
      const storage = api.app.get(StorageService);
      if (!(storage instanceof RecordingStorageService)) {
        throw new TypeError("測試應使用記錄用儲存 adapter");
      }
      expect(storage.copied).toContainEqual({
        from: attachment.path,
        to: copiedPath,
      });
      const again = await ok<{
        copySubmissionToDraft: { submission: WfSubmissionRow };
      }>(api, world.applicant.token, COPY, {
        input: { id: submitted.id, clientRequestId: requestId },
      });
      expect(again.copySubmissionToDraft.submission.id).toBe(fresh.id);
      const source = await submission(world, world.applicant, submitted.id);
      expect(source.replacedById).toBe(fresh.id);
      // 審過這筆的人讀得到那個修訂,但看不到作廢理由與複製去向
      const reviewerView = await submission(world, copyReviewer, submitted.id);
      expect(reviewerView).toMatchObject({
        voidReason: null,
        replacedById: null,
        currentInstanceId: null,
      });
      // 已複製過 → 第二次(不同 clientRequestId)擋下
      const second = await call(api, world.applicant.token, COPY, {
        input: { id: submitted.id, clientRequestId: nextKey("copy_again") },
      });
      expect(errorCode(second)).toBe("CONFLICT");
      expect(errorReason(second)).toBe("ALREADY_COPIED");
      const audit = await world.connection.collection("audit_logs").findOne({
        action: "submission.copy",
        targetId: new Types.ObjectId(fresh.id),
      });
      expect(audit?.after).toMatchObject({
        sourceId: submitted.id,
        newId: fresh.id,
      });
      await bindForm(world, key, FORM_KEY);
    });

    it("複製為新單:明細列每一列換新的 rowId", async () => {
      const { rows, copied } = await copyArraySubmission(null);
      expect(
        copied.filter((row) =>
          rows.some((source) => source.rowId === row.rowId),
        ),
      ).toEqual([]);
    });

    it("複製為新單:明細的引用子欄重驗來源,讀不到的格清空、明細欄列進 clearedFields,其他格照原值", async () => {
      const [kept, gone] = await Promise.all([
        person(api, world.connection, world.kitchen, world.tenant),
        person(api, world.connection, world.kitchen, world.tenant),
      ]);
      const who = column("who", "reference", {
        source: { provider: "user", labelField: "name" },
      });
      const { copied, clearedFields } = await copyArraySubmission(null, {
        columns: [column("name", "text"), who],
        rows: [
          {
            rowId: randomUUID(),
            name: "甲",
            who: { id: String(kept.userId), label: null },
          },
          {
            rowId: randomUUID(),
            name: "乙",
            who: { id: String(gone.userId), label: null },
          },
        ],
        beforeCopy: async () => {
          await world.connection
            .collection("users")
            .updateOne(
              { _id: gone.userId },
              { $set: { deletedAt: new Date() } },
            );
        },
      });
      expect(clearedFields).toEqual(["items"]);
      expect(copied.map((row) => [row.name, row.who])).toEqual([
        ["甲", expect.objectContaining({ id: String(kept.userId) })],
        ["乙", null],
      ]);
    });

    it("複製為新單:明細只留目標版本仍有且型別相同的子欄", async () => {
      // 新版:qty 改成文字、多一個 note;name 不變
      const { copied } = await copyArraySubmission([
        column("name", "text"),
        column("qty", "text"),
        column("note", "text"),
      ]);
      expect(
        copied.map((row) => [row.name, row.qty ?? null, row.note ?? null]),
      ).toEqual([
        ["甲", null, null],
        ["乙", null, null],
      ]);
    });
  });

  describe("附件複製失敗與退回 / 撤回的刪除", () => {
    it("複製為新單時附件複製失敗 → 該欄清空並列進 clearedFields,新單照建", async () => {
      await useWorkflow(world, nextKey("copy_fail"), {
        steps: [usersStep("one", [staff(4)])],
      });
      const submitted = await submitLeave(world, {
        title: "附件會複製失敗",
        days: 2,
        attachment: uploadValue(randomUUID()),
      });
      await decideOn(world, staff(4), submitted.id, "APPROVE");
      const approved = await submission(world, world.applicant, submitted.id);
      await ok(api, world.applicant.token, VOID, {
        input: {
          id: submitted.id,
          expectedEditVersion: approved.editVersion,
          reason: "重來",
        },
      });
      const storage = api.app.get(StorageService);
      const spy = jest
        .spyOn(storage, "copyPrivateObject")
        .mockRejectedValue(new Error("模擬供應商失敗"));
      let copied: WfSubmissionRow;
      try {
        const data = await ok<{
          copySubmissionToDraft: { submission: WfSubmissionRow };
        }>(api, world.applicant.token, COPY, {
          input: { id: submitted.id, clientRequestId: nextKey("copy_fail") },
        });
        copied = data.copySubmissionToDraft.submission;
      } finally {
        spy.mockRestore();
      }
      expect(copied.status).toBe("DRAFT");
      expect(copied.clearedFields).toEqual(["attachment"]);
      expect(copied.values.attachment ?? null).toBeNull();
      expect(copied.values.title).toBe("附件會複製失敗");
    });

    it("被退回 / 撤回的單:申請人本人可刪;有 delete 的別人不行;審核中不可刪", async () => {
      await useWorkflow(world, nextKey("delete_returned"), {
        steps: [usersStep("one", [staff(4)])],
      });
      const returned = await submitLeave(world);
      await decideOn(world, staff(4), returned.id, "RETURN");
      const byOther = await call(api, world.admin.token, DELETE_SUBMISSION, {
        input: { id: returned.id },
      });
      expect(byOther.errors).toBeDefined();
      const ownReturned = await submission(world, world.applicant, returned.id);
      expect(ownReturned.abilities.canDelete).toBe(true);
      await ok(api, world.applicant.token, DELETE_SUBMISSION, {
        input: { id: returned.id },
      });
      const withdrawn = await submitLeave(world);
      await ok(api, world.applicant.token, WITHDRAW, {
        input: { id: withdrawn.id, expectedEditVersion: withdrawn.editVersion },
      });
      await ok(api, world.applicant.token, DELETE_SUBMISSION, {
        input: { id: withdrawn.id },
      });
      const deleted = await world.connection
        .collection("form_submissions")
        .countDocuments({
          _id: {
            $in: [
              new Types.ObjectId(returned.id),
              new Types.ObjectId(withdrawn.id),
            ],
          },
          deletedAt: { $ne: null },
        });
      expect(deleted).toBe(2);
      const reviewing = await submitLeave(world);
      const blocked = await call(
        api,
        world.applicant.token,
        DELETE_SUBMISSION,
        {
          input: { id: reviewing.id },
        },
      );
      expect(errorCode(blocked)).toBe("CONFLICT");
    });
  });

  describe("審核者失效、改派、新增審核者、阻擋清單", () => {
    it("any:停用其中一人 → 他的任務 blocked,實例不阻擋,另一人照審", async () => {
      const [a, b] = [await reviewerOnly(), await reviewerOnly()];
      await useWorkflow(world, nextKey("any_invalid"), {
        steps: [usersStep("one", [a, b])],
      });
      const submitted = await submitLeave(world);
      await pendingTaskOf(world, a, submitted.id);
      await setEnabled(world, a, false);
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(stepOfRow(instance, "one").plan[0]?.assigneeState).toBe("invalid");
      // 關卡可否退回從版本定義抄(省略 = true),審核區塊依它決定出不出現「退回修改」
      expect(stepOfRow(instance, "one").allowReturn).toBe(true);
      const tasks = await rawTasks(world.connection, instance.id);
      expect(tasks.map((task) => task.status)).toEqual(["blocked", "pending"]);
      await decideOn(world, b, submitted.id, "APPROVE");
      expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
    });

    it("all:兩人都失效 → 阻擋;改派一人仍阻擋、兩人都改派才解除;改派給同關已有的人 → 拒;改派後補建不會把原承辦人建回來", async () => {
      const [a, b, c, d] = [
        await reviewerOnly(),
        await reviewerOnly(),
        await reviewerOnly(),
        await reviewerOnly(),
      ];
      await useWorkflow(world, nextKey("all_invalid"), {
        steps: [usersStep("one", [a, b], { mode: "all", allowReturn: false })],
      });
      const submitted = await submitLeave(world);
      expect(
        stepOfRow(await currentInstance(world, submitted.id), "one")
          .allowReturn,
      ).toBe(false);
      await setEnabled(world, a, false);
      await setEnabled(world, b, false);
      let instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("BLOCKED");
      expect(await blockedFlagOf(world, submitted.id)).toBe(true);
      const blockedList = await ok<{
        blockedInstances: { items: InstanceRow[]; truncated: boolean };
      }>(api, world.admin.token, BLOCKED_INSTANCES, {
        input: { filter: "BLOCKED", pageSize: 100 },
      });
      expect(
        blockedList.blockedInstances.items.map((item) => item.id),
      ).toContain(instance.id);
      expect(blockedList.blockedInstances.truncated).toBe(false);
      const listed = blockedList.blockedInstances.items.find(
        (item) => item.id === instance.id,
      );
      // 流程管理者只看標題槽,不看日期 / 金額;申請人自己的詳情照給
      expect(listed?.summary).toEqual({ title: "病假三天", date: null });
      expect(instance.summary?.date).not.toBeNull();
      const tasks = await rawTasks(world.connection, instance.id);
      const [taskA, taskB] = tasks.map((task) => String(task._id));
      // 流程管理者從阻擋清單就拿得到計畫項目的任務 id(改派要它);其他讀者一律 null
      const listedPlan =
        listed?.steps.find((one) => one.stepKey === "one")?.plan ?? [];
      expect(listedPlan.map((item) => item.taskId)).toEqual(
        tasks.map((task) => String(task._id)),
      );
      expect(
        stepOfRow(instance, "one").plan.every((item) => item.taskId === null),
      ).toBe(true);
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: taskA, toUserId: String(c.userId) },
      });
      instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("BLOCKED");
      const duplicate = await call(api, world.admin.token, REASSIGN, {
        input: { taskId: taskB, toUserId: String(c.userId) },
      });
      expect(errorReason(duplicate)).toBe("ALREADY_IN_STEP");
      await ok(api, world.admin.token, REASSIGN, {
        input: { taskId: taskB, toUserId: String(d.userId) },
      });
      instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      expect(await blockedFlagOf(world, submitted.id)).toBe(false);
      await retryAdvance(world, instance.id);
      const after = await rawTasks(world.connection, instance.id);
      expect(after).toHaveLength(2);
      expect(
        after.map((task) => String(task.assigneeId)).toSorted(byText),
      ).toEqual([String(c.userId), String(d.userId)].toSorted(byText));
      expect(stepOfRow(instance, "one").plan[0]?.previousAssignees).toEqual([
        { id: String(a.userId) },
      ]);
    });

    it("移出租戶(所屬組織改到別的租戶)→ 他在這個租戶的待審任務 blocked", async () => {
      const mover = await reviewerOnly();
      await useWorkflow(world, nextKey("moved_out"), {
        steps: [usersStep("one", [mover], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const elsewhere = await createOrg(world.connection, {
        name: "搬去的租戶",
      });
      await ok(api, world.root, SET_USER_ORGS, {
        input: { userId: String(mover.userId), orgIds: [String(elsewhere)] },
      });
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("BLOCKED");
      const [task] = await rawTasks(world.connection, instance.id);
      expect(task?.status).toBe("blocked");
    });

    it("解析為空 → 實例阻擋;all 空計畫不會被判定完成、重試也不會自動解除;新增審核者後繼續", async () => {
      const emptyRole = await createRole(api.app, world.connection, {
        name: nextKey("空角色"),
        ownerOrgId: world.tenant,
      });
      await useWorkflow(world, nextKey("empty"), {
        steps: [reviewStep("nobody", roleSource(emptyRole), { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      let instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("BLOCKED");
      expect(stepOfRow(instance, "nobody").plan).toEqual([]);
      instance = await retryAdvance(world, instance.id);
      expect(instance.status).toBe("BLOCKED");
      expect(stepOfRow(instance, "nobody").status).toBe("ACTIVE");
      const added = await ok<{ addStepAssignee: { task: TaskRow } }>(
        api,
        world.admin.token,
        ADD_ASSIGNEE,
        {
          input: {
            instanceId: instance.id,
            stepKey: "nobody",
            userId: String(staff(1).userId),
          },
        },
      );
      expect(added.addStepAssignee.task.taskKey).toBe("nobody-1");
      instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("RUNNING");
      await decideOn(world, staff(1), submitted.id, "APPROVE");
      expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
    });

    it("新增審核者與審核者失效並發(失效先提交、寫同一份實例)→ 新增審核者的交易寫入衝突、重跑後照常加入;兩邊的變更都在", async () => {
      const emptyRole = await createRole(api.app, world.connection, {
        name: nextKey("空角色並發"),
        ownerOrgId: world.tenant,
      });
      const [a, b, added] = [
        await reviewerOnly(),
        await reviewerOnly(),
        await reviewerOnly(),
      ];
      await useWorkflow(world, nextKey("add_vs_invalidate"), {
        steps: [
          usersStep("init", [staff(0)]),
          usersStep("pair", [a, b], { mode: "all" }),
          reviewStep("nobody", roleSource(emptyRole), { mode: "all" }),
          joinStep("merge"),
        ],
        edges: [
          { from: "init", to: "pair" },
          { from: "init", to: "nobody" },
          { from: "pair", to: "merge" },
          { from: "nobody", to: "merge" },
        ],
      });
      const submitted = await submitLeave(world);
      await decideOn(world, staff(0), submitted.id, "APPROVE");
      const before = await currentInstance(world, submitted.id);
      expect(before.status).toBe("BLOCKED");
      expect(stepOfRow(before, "nobody").plan).toEqual([]);
      const restore = interleaveAt(
        api,
        "add-assignee:before-write",
        async () => {
          await setEnabled(world, a, false);
        },
      );
      try {
        await ok(api, world.admin.token, ADD_ASSIGNEE, {
          input: {
            instanceId: before.id,
            stepKey: "nobody",
            userId: String(added.userId),
          },
        });
      } finally {
        restore();
      }
      const instance = await currentInstance(world, submitted.id);
      expect(instance.status).toBe("BLOCKED");
      expect(stepOfRow(instance, "nobody").plan).toHaveLength(1);
      expect(stepOfRow(instance, "pair").blocked).toBe(true);
      expect(
        instance.history.filter((event) => event.kind === "assignee_added"),
      ).toHaveLength(1);
      expect(
        instance.history.filter(
          (event) => event.kind === "blocked" && event.stepKey === "pair",
        ),
      ).toHaveLength(1);
      expect(await taskStatuses(world.connection, instance.id)).toMatchObject({
        "nobody-1": "pending",
        "pair-1": "blocked",
        "pair-2": "pending",
      });
    });

    it("阻擋中被接受的駁回照樣終局;推進前中斷 → 整個決定回復,再駁回一次 → rejected", async () => {
      const [a, b] = [await reviewerOnly(), await reviewerOnly()];
      await useWorkflow(world, nextKey("blocked_reject"), {
        steps: [usersStep("one", [a, b], { mode: "all" })],
      });
      const submitted = await submitLeave(world);
      const task = await pendingTaskOf(world, a, submitted.id);
      await setEnabled(world, b, false);
      const blocked = await currentInstance(world, submitted.id);
      expect(blocked.status).toBe("BLOCKED");
      const restore = interruptAt(api, "decide:accepted");
      try {
        const result = await call(api, a.token, DECIDE, {
          input: {
            taskId: task.id,
            expectedEditVersion: task.editVersion,
            decision: "REJECT",
            comment: "阻擋中駁回",
          },
        });
        expect(result.errors).toBeDefined();
      } finally {
        restore();
      }
      const rolledBack = await currentInstance(world, submitted.id);
      expect(rolledBack.status).toBe("BLOCKED");
      expect(stepOfRow(rolledBack, "one").decisions).toHaveLength(0);
      const again = await decide(world, a, task, "REJECT", "阻擋中駁回");
      expect(again.result).toBe("ACCEPTED");
      const rejected = await currentInstance(world, submitted.id);
      expect(rejected.status).toBe("REJECTED");
      expect(await submissionStatus(world, submitted.id)).toBe("REJECTED");
    });

    it("需要推進:任務投影被弄亂的實例列進來、健康的不列", async () => {
      await useWorkflow(world, nextKey("needs_advance"), {
        steps: [usersStep("one", [staff(2)])],
      });
      const healthy = await submitLeave(world);
      const broken = await submitLeave(world);
      const brokenInstance = await currentInstance(world, broken.id);
      await world.connection
        .collection("workflow_tasks")
        .updateOne(
          { instanceId: new Types.ObjectId(brokenInstance.id) },
          { $set: { status: "cancelled" } },
        );
      const listed = await ok<{ blockedInstances: { items: InstanceRow[] } }>(
        api,
        world.admin.token,
        BLOCKED_INSTANCES,
        { input: { filter: "NEEDS_ADVANCE", pageSize: 100 } },
      );
      const ids = listed.blockedInstances.items.map((item) => item.id);
      expect(ids).toContain(brokenInstance.id);
      const healthyInstance = await currentInstance(world, healthy.id);
      expect(ids).not.toContain(healthyInstance.id);
    });
  });

  it("通知關閉(WORKFLOW_MAIL_ENABLED = false):不寄信、只記 log,但照樣記 notified 標記", async () => {
    const service = api.app.get(MailService);
    if (!(service instanceof RecordingMailService)) {
      throw new TypeError("測試應使用記錄用寄信 adapter");
    }
    const before = service.sent.length;
    await useWorkflow(world, nextKey("mail_off"), {
      steps: [usersStep("one", [staff(3)])],
    });
    const submitted = await submitLeave(world);
    await decideOn(world, staff(3), submitted.id, "APPROVE");
    const workflowMails = service.sent
      .slice(before)
      .filter((message) => message.kind.startsWith("workflow-"));
    expect(workflowMails).toEqual([]);
    const instance = await currentInstance(world, submitted.id);
    expect(
      instance.history.some(
        (event) => event.kind === "notified" && event.result === "approved",
      ),
    ).toBe(true);
  });
});
