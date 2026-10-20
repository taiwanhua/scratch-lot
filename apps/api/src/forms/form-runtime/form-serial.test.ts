import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import {
  COPY,
  FORM_KEY,
  VOID,
  WITHDRAW,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decideOn,
  setupWorld,
  submitExisting,
  useWorkflow,
  usersStep,
} from "../../workflows/test-support/workflow-fixtures";
import {
  call,
  codeOf,
  createDraft,
  extensionsOf,
  nextRequestId,
  ok,
} from "../test-support/form-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const SERIAL_FORM = /* GraphQL */ `
  mutation SetSerial($input: UpdateFormInput!) {
    updateForm(input: $input) {
      form {
        key
        serial {
          prefix
          period
          digits
          separator
        }
      }
    }
  }
`;

const SUBMISSION_FIELDS = /* GraphQL */ `
  fragment SerialSubmission on FormSubmissionModel {
    id
    status
    editVersion
    serialNo
    values
  }
`;

const GET = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  query Get($id: ID!) {
    formSubmission(id: $id) {
      submission {
        ...SerialSubmission
      }
    }
  }
`;

const SUBMIT = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation Submit($input: SubmitFormSubmissionInput!) {
    submitFormSubmission(input: $input) {
      submission {
        ...SerialSubmission
      }
    }
  }
`;

const CREATE_AND_SUBMIT = /* GraphQL */ `
  ${SUBMISSION_FIELDS}
  mutation CreateAndSubmit($input: CreateAndSubmitFormSubmissionInput!) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        ...SerialSubmission
      }
    }
  }
`;

interface Row {
  id: string;
  status: string;
  editVersion: number;
  serialNo: string | null;
  values: Record<string, unknown>;
}

/** 本月在租戶時區(示範租戶沒設 = Asia/Taipei)的期間段。 */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}${part("month")}`;
}

/** 本月的單號長相:`SL-<yyyymm>-<4 位>`。 */
function serialPattern(): RegExp {
  return new RegExp(String.raw`^SL-${currentMonth()}-\d{4}$`);
}

/**
 * 表單的單號(真 Mongo):表單設計設格式 → 草稿不給號、第一次送出給號、退回 / 撤回再送不換號、
 * 作廢保留、複製為新單的草稿沒有號;格式不合法 → VALIDATION_FAILED。
 */
describe("表單單號(serialNo)", () => {
  let api: AuthTestApp;
  let world: World;
  const applicant = () => world.applicant.token;
  const reviewer = () => world.staff[0] ?? world.manager;

  async function get(id: string): Promise<Row> {
    const data = await ok<{ formSubmission: { submission: Row } }>(
      api,
      applicant(),
      GET,
      { id },
    );
    return data.formSubmission.submission;
  }

  async function serialOf(id: string): Promise<string | null> {
    const row = await get(id);
    return row.serialNo;
  }

  async function submit(row: Pick<Row, "id" | "editVersion">): Promise<Row> {
    const data = await ok<{ submitFormSubmission: { submission: Row } }>(
      api,
      applicant(),
      SUBMIT,
      { input: { id: row.id, expectedEditVersion: row.editVersion } },
    );
    return data.submitFormSubmission.submission;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("form_serial", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 1);
  });

  afterAll(async () => {
    await api.close();
  });

  it("格式不合法 → VALIDATION_FAILED(指到 serial 的鍵);合法的存起來回傳", async () => {
    const bad = await call(api, world.root, SERIAL_FORM, {
      input: {
        key: FORM_KEY,
        serial: { prefix: "S L", period: "week", digits: 4 },
      },
    });
    expect(codeOf(bad)).toBe("VALIDATION_FAILED");
    expect(extensionsOf(bad).fields).toEqual([
      "serial.prefix",
      "serial.period",
    ]);

    const saved = await ok<{
      updateForm: { form: { serial: Record<string, unknown> | null } };
    }>(api, world.root, SERIAL_FORM, {
      input: {
        key: FORM_KEY,
        serial: { prefix: "SL", period: "month", digits: 4 },
      },
    });
    expect(saved.updateForm.form.serial).toEqual({
      prefix: "SL",
      period: "month",
      digits: 4,
      separator: null,
    });
  });

  describe("沒綁流程", () => {
    it("存草稿不給號;第一次送出給號,連號", async () => {
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "單號一",
        days: 1,
      });
      expect(await serialOf(draft.id)).toBeNull();
      const first = await submit(draft);
      expect(first.status).toBe("COMPLETED");
      expect(first.serialNo).toMatch(serialPattern());

      const direct = await ok<{
        createAndSubmitFormSubmission: { submission: Row };
      }>(api, applicant(), CREATE_AND_SUBMIT, {
        input: {
          formKey: FORM_KEY,
          clientRequestId: nextRequestId(),
          values: { title: "單號二", days: 1 },
        },
      });
      const second = direct.createAndSubmitFormSubmission.submission;
      expect(Number(second.serialNo?.slice(-4))).toBe(
        Number(first.serialNo?.slice(-4)) + 1,
      );
    });
  });

  describe("綁了流程", () => {
    beforeAll(async () => {
      await useWorkflow(world, "serial_review", {
        steps: [usersStep("review", [world.staff[0] ?? world.manager])],
      });
    });

    it("退回再送、撤回再送都不換號", async () => {
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "會被退回",
        days: 1,
      });
      const sent = await submitExisting(world, draft);
      const serialNo = await serialOf(sent.id);
      expect(serialNo).toMatch(serialPattern());

      await decideOn(world, reviewer(), sent.id, "RETURN");
      const returned = await get(sent.id);
      expect(returned.status).toBe("RETURNED");
      expect(returned.serialNo).toBe(serialNo);
      const resent = await submit(returned);
      expect(resent.status).toBe("REVIEWING");
      expect(resent.serialNo).toBe(serialNo);

      const latest = await get(sent.id);
      await ok(api, applicant(), WITHDRAW, {
        input: { id: sent.id, expectedEditVersion: latest.editVersion },
      });
      const withdrawn = await get(sent.id);
      expect(withdrawn.status).toBe("WITHDRAWN");
      const again = await submit(withdrawn);
      expect(again.serialNo).toBe(serialNo);
    });

    it("核准後作廢保留原號;複製為新單的草稿沒有號", async () => {
      const draft = await createDraft(api, applicant(), FORM_KEY, {
        title: "要作廢",
        days: 1,
      });
      const sent = await submitExisting(world, draft);
      const serialNo = await serialOf(sent.id);
      await decideOn(world, reviewer(), sent.id, "APPROVE");
      const approved = await get(sent.id);
      await ok(api, applicant(), VOID, {
        input: {
          id: sent.id,
          expectedEditVersion: approved.editVersion,
          reason: "填錯",
        },
      });
      const voided = await get(sent.id);
      expect(voided.status).toBe("VOIDED");
      expect(voided.serialNo).toBe(serialNo);

      const copied = await ok<{ copySubmissionToDraft: { submission: Row } }>(
        api,
        applicant(),
        COPY,
        { input: { id: sent.id, clientRequestId: nextRequestId() } },
      );
      const copy = await get(copied.copySubmissionToDraft.submission.id);
      expect(copy.status).toBe("DRAFT");
      expect(copy.serialNo).toBeNull();
    });
  });

  it("清掉格式(serial: null)後送出不給號,已給的號保留", async () => {
    await ok(api, world.root, SERIAL_FORM, {
      input: { key: FORM_KEY, serial: null },
    });
    const draft = await createDraft(api, applicant(), FORM_KEY, {
      title: "沒有單號",
      days: 1,
    });
    const sent = await submitExisting(world, draft);
    expect(await serialOf(sent.id)).toBeNull();
    const kept = await api.connection
      .collection("form_submissions")
      .countDocuments({ formKey: FORM_KEY, serialNo: { $ne: null } });
    expect(kept).toBeGreaterThan(0);
  });
});
