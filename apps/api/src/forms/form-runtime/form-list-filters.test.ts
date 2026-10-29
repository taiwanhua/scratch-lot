import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import {
  FORM_SUBMISSIONS,
  FORM_TEST_TIMEOUT_MS,
  type FormOperator,
  M,
  MODULE_KEY,
  type SubmissionRow,
  assignForm,
  call,
  codeOf,
  createDraft,
  createOperator,
  createSubmitted,
  definitionOf,
  field,
  ok,
  publishNewForm,
  rootToken,
} from "../test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

interface ListData {
  formSubmissions: { items: SubmissionRow[]; totalCount: number };
}

/** 列表的摘要標題(排序後;還沒有摘要的草稿為空字串)。 */
function titlesOf(data: ListData): string[] {
  return data.formSubmissions.items
    .map((item) => item.summary?.title ?? "")
    .toSorted((left, right) => left.localeCompare(right));
}

/** 台北的當地日期 → 存值(當地 00:00 的時點)。 */
function taipeiDay(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

/**
 * 表單列表的組織與日期區間篩選(`FormSubmissionsInput.orgId` / `dateFrom` / `dateTo`):
 * 真 GraphQL + 真 MongoDB(TEST-07)。組織樹:租戶 T(可見範圍含下層)→ A → A1、T → B;另一個租戶 U。
 */
describe("表單列表:組織(含下層)與日期區間篩選", () => {
  let api: AuthTestApp;
  let root: string;
  let tenant: Types.ObjectId;
  let orgA: Types.ObjectId;
  let orgA1: Types.ObjectId;
  let orgB: Types.ObjectId;
  let otherTenant: Types.ObjectId;
  /** 租戶頂層的人:可見範圍 = 整棵 T。 */
  let manager: FormOperator;
  /** A 的人:可見範圍 = A + A1。 */
  let staffA: FormOperator;
  let staffU: FormOperator;
  let draftId: string;

  const FORM = "list_filter";
  const PERMISSIONS = [M.view, M.create, M.edit];

  const list = (token: string, input: Record<string, unknown>) =>
    ok<ListData>(api, token, FORM_SUBMISSIONS, {
      input: { moduleKey: MODULE_KEY, pageSize: 100, ...input },
    });

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-form-list-filters");
    const { connection } = api;
    root = await rootToken(api);
    tenant = await createOrg(connection, {
      name: "篩選租戶",
      settings: { visibility: "subtree", timezone: "Asia/Taipei" },
    });
    orgA = await createOrg(connection, { name: "A 區", parentId: tenant });
    orgA1 = await createOrg(connection, { name: "A1 店", parentId: orgA });
    orgB = await createOrg(connection, { name: "B 區", parentId: tenant });
    otherTenant = await createOrg(connection, { name: "另一個租戶" });

    const operatorOf = (orgId: Types.ObjectId, ownerOrgId: Types.ObjectId) =>
      createOperator(api, connection, {
        orgId,
        ownerOrgId,
        permissionKeys: PERMISSIONS,
      });
    manager = await operatorOf(tenant, tenant);
    staffA = await operatorOf(orgA, tenant);
    const staffA1 = await operatorOf(orgA1, tenant);
    const staffB = await operatorOf(orgB, tenant);
    staffU = await operatorOf(otherTenant, otherTenant);

    await publishNewForm(
      api,
      root,
      FORM,
      definitionOf([field("title", "text"), field("day", "date")], {
        summaryMap: { title: "title", date: "day" },
      }),
    );
    await assignForm(api, root, FORM, [tenant, otherTenant]);
    await createSubmitted(api, staffA.token, FORM, {
      title: "A-0301",
      day: taipeiDay("2026-03-01"),
    });
    await createSubmitted(api, staffA1.token, FORM, {
      title: "A1-0305",
      day: taipeiDay("2026-03-05"),
    });
    await createSubmitted(api, staffB.token, FORM, {
      title: "B-0310",
      day: taipeiDay("2026-03-10"),
    });
    await createSubmitted(api, staffU.token, FORM, {
      title: "U-0305",
      day: taipeiDay("2026-03-05"),
    });
    // 草稿還沒有摘要:有日期條件時不列
    const draft = await createDraft(api, manager.token, FORM, {
      title: "T-草稿",
      day: taipeiDay("2026-03-05"),
    });
    draftId = draft.id;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("組織含下層;不給 = 可見範圍內全部", async () => {
    // 草稿還沒有摘要(標題為空)
    expect(titlesOf(await list(manager.token, { formKey: FORM }))).toEqual([
      "",
      "A-0301",
      "A1-0305",
      "B-0310",
    ]);
    const underA = await list(manager.token, {
      formKey: FORM,
      orgId: String(orgA),
    });
    expect(titlesOf(underA)).toEqual(["A-0301", "A1-0305"]);
    expect(underA.formSubmissions.totalCount).toBe(2);
    expect(
      titlesOf(
        await list(manager.token, { formKey: FORM, orgId: String(orgA1) }),
      ),
    ).toEqual(["A1-0305"]);
    expect(
      titlesOf(
        await list(manager.token, { formKey: FORM, orgId: String(orgB) }),
      ),
    ).toEqual(["B-0310"]);
  });

  it("組織只收窄不放寬:可見範圍外 / 別的租戶 = 空清單", async () => {
    expect(
      titlesOf(
        await list(staffA.token, { formKey: FORM, orgId: String(orgB) }),
      ),
    ).toEqual([]);
    expect(
      titlesOf(
        await list(staffA.token, { formKey: FORM, orgId: String(tenant) }),
      ),
    ).toEqual(["A-0301", "A1-0305"]);
    expect(
      titlesOf(
        await list(manager.token, {
          formKey: FORM,
          orgId: String(otherTenant),
        }),
      ),
    ).toEqual([]);
    expect(
      titlesOf(
        await list(staffU.token, { formKey: FORM, orgId: String(tenant) }),
      ),
    ).toEqual([]);
  });

  it("日期區間比對摘要日期,含頭尾、以租戶時區切日;草稿(沒有摘要)不列", async () => {
    expect(
      titlesOf(
        await list(manager.token, {
          formKey: FORM,
          dateFrom: "2026-03-05",
          dateTo: "2026-03-05",
        }),
      ),
    ).toEqual(["A1-0305"]);
    expect(
      titlesOf(
        await list(manager.token, { formKey: FORM, dateFrom: "2026-03-02" }),
      ),
    ).toEqual(["A1-0305", "B-0310"]);
    expect(
      titlesOf(
        await list(manager.token, { formKey: FORM, dateTo: "2026-03-05" }),
      ),
    ).toEqual(["A-0301", "A1-0305"]);
    // 起日晚於迄日 = 空清單(不擋)
    expect(
      titlesOf(
        await list(manager.token, {
          formKey: FORM,
          dateFrom: "2026-03-10",
          dateTo: "2026-03-01",
        }),
      ),
    ).toEqual([]);
    const withDraft = await list(manager.token, { formKey: FORM });
    expect(withDraft.formSubmissions.items.map((item) => item.id)).toContain(
      draftId,
    );
  });

  it("組織與日期一起用;別的租戶的同一天不出現", async () => {
    const both = await list(manager.token, {
      formKey: FORM,
      orgId: String(orgA),
      dateFrom: "2026-03-02",
      dateTo: "2026-03-31",
    });
    expect(titlesOf(both)).toEqual(["A1-0305"]);
    expect(both.formSubmissions.totalCount).toBe(1);
    expect(
      titlesOf(
        await list(staffU.token, {
          formKey: FORM,
          dateFrom: "2026-03-05",
          dateTo: "2026-03-05",
        }),
      ),
    ).toEqual(["U-0305"]);
  });

  it("格式不對 → VALIDATION_FAILED", async () => {
    for (const input of [
      { dateFrom: "2026/03/01" },
      { dateTo: "2026-02-30" },
      { orgId: "not-an-id" },
    ]) {
      const result = await call(api, manager.token, FORM_SUBMISSIONS, {
        input: { moduleKey: MODULE_KEY, ...input },
      });
      expect(codeOf(result)).toBe("VALIDATION_FAILED");
    }
  });
});
