import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Logger } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import { ok } from "../../forms/test-support/form-fixtures";
import {
  type DefinitionShape,
  type Person,
  REASSIGN,
  WORKFLOW_TEST_TIMEOUT_MS,
  type World,
  decideOn,
  pendingTaskOf,
  person,
  rawInstances,
  setupWorld,
  submission,
  submissionStatus,
  submitLeave,
  tasksOf,
  useWorkflow,
  usersStep,
} from "../test-support/workflow-fixtures";

jest.setTimeout(WORKFLOW_TEST_TIMEOUT_MS);

const HOUR_MS = 3_600_000;

const CREATE_DELEGATION = /* GraphQL */ `
  mutation CreateMyDelegation($input: CreateMyDelegationInput!) {
    createMyDelegation(input: $input) {
      delegation {
        id
      }
    }
  }
`;

const DELETE_DELEGATION = /* GraphQL */ `
  mutation DeleteMyDelegation($input: DeleteMyDelegationInput!) {
    deleteMyDelegation(input: $input) {
      id
    }
  }
`;

const INSTANCE_DELEGATION = /* GraphQL */ `
  query InstanceDelegation($id: ID!) {
    workflowInstance(id: $id) {
      instance {
        steps {
          stepKey
          plan {
            assignee {
              id
            }
            delegators {
              id
              name
            }
          }
        }
        history {
          kind
          user {
            id
          }
          delegators {
            id
          }
        }
      }
    }
  }
`;

interface RawPlanItem {
  taskKey: string;
  assigneeId: Types.ObjectId;
  delegatorIds?: Types.ObjectId[];
}

interface RawInstance {
  steps: { stepKey: string; plan: RawPlanItem[] }[];
  history: {
    kind: string;
    userId: Types.ObjectId | null;
    delegatorIds?: Types.ObjectId[];
  }[];
}

function planOf(instance: RawInstance, stepKey: string): RawPlanItem[] {
  return instance.steps.find((step) => step.stepKey === stepKey)?.plan ?? [];
}

/** 計畫項目 / 事件記的被代理者(字串;沒有 = 空陣列)。 */
function delegatorsIn(entry: { delegatorIds?: Types.ObjectId[] } | undefined) {
  return (entry?.delegatorIds ?? []).map(String);
}

interface DelegationView {
  workflowInstance: {
    instance: {
      steps: {
        stepKey: string;
        plan: {
          assignee: { id: string };
          delegators: { id: string; name: string | null }[];
        }[];
      }[];
      history: {
        kind: string;
        user: { id: string } | null;
        delegators: { id: string }[];
      }[];
    };
  };
}

/**
 * 代理人(《底座規格》3.7 B15;真 Mongo):進關解析審核者時,在代理期間的人換成代理人。
 * 代理都由本人經 `createMyDelegation` 設定(起 = 一小時前,迄 = 一天後,除非另寫)。
 */
describe("代理人:進關改派給代理人", () => {
  let api: AuthTestApp;
  let world: World;
  let sequence = 0;

  async function bindNew(definition: DefinitionShape): Promise<void> {
    sequence += 1;
    await useWorkflow(world, `delegation_${String(sequence)}`, definition);
  }

  async function delegate(
    from: Person,
    to: Person,
    period: { startAt?: Date; endAt?: Date } = {},
  ): Promise<string> {
    const now = Date.now();
    const data = await ok<{
      createMyDelegation: { delegation: { id: string } };
    }>(api, from.token, CREATE_DELEGATION, {
      input: {
        delegateUserId: String(to.userId),
        startAt: (period.startAt ?? new Date(now - HOUR_MS)).toISOString(),
        endAt: (period.endAt ?? new Date(now + 24 * HOUR_MS)).toISOString(),
      },
    });
    return data.createMyDelegation.delegation.id;
  }

  /** 某人在這筆提交上待處理任務的關卡。 */
  async function pendingStep(who: Person, submissionId: string) {
    const task = await pendingTaskOf(world, who, submissionId);
    return task.stepKey;
  }

  /** 某人在這筆提交上的待處理任務(沒有 = 空陣列)。 */
  async function tasksOn(who: Person, submissionId: string) {
    const tasks = await tasksOf(world, who);
    return tasks.filter((task) => task.submissionId === submissionId);
  }

  async function latestInstance(submissionId: string): Promise<RawInstance> {
    const instances = await rawInstances(world.connection, submissionId);
    const latest = instances.at(-1);
    if (!latest) {
      throw new Error(`提交 ${submissionId} 沒有實例`);
    }
    return latest as unknown as RawInstance;
  }

  async function setEnabled(who: Person, enabled: boolean): Promise<void> {
    await world.connection
      .collection("users")
      .updateOne({ _id: who.userId }, { $set: { enabled } });
  }

  /** 每個情境用全新的一組人(代理期間不重疊、互不影響)。 */
  async function freshStaff(): Promise<[Person, Person, Person]> {
    const people: Person[] = [];
    for (let index = 0; index < 3; index += 1) {
      people.push(
        await person(api, world.connection, world.tenant, world.tenant),
      );
    }
    return people as [Person, Person, Person];
  }

  beforeAll(async () => {
    api = await startAuthTestApp("workflow_delegation", {
      WORKFLOW_MAIL_ENABLED: "false",
    });
    world = await setupWorld(api, api.connection, 3);
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  });

  it("代理期間進關 → 任務派給代理人;派任計畫記原審核者;時間軸「由代理人代理原審核者」;代理人讀得到他審的修訂", async () => {
    const [original, deputy] = await freshStaff();
    await delegate(original, deputy);
    await bindNew({ steps: [usersStep("first", [original])] });
    const submitted = await submitLeave(world);

    const raw = await latestInstance(submitted.id);
    expect(planOf(raw, "first")).toEqual([
      expect.objectContaining({
        assigneeId: deputy.userId,
        delegatorIds: [original.userId],
      }),
    ]);
    const created = raw.history.find((event) => event.kind === "task_created");
    expect(String(created?.userId)).toBe(String(deputy.userId));
    expect(delegatorsIn(created)).toEqual([String(original.userId)]);

    // 任務在代理人名下,原審核者沒有
    expect(await pendingStep(deputy, submitted.id)).toBe("first");
    expect(await tasksOn(original, submitted.id)).toEqual([]);

    // GraphQL:計畫項目與 task_created 都帶原審核者
    const row = await submission(world, world.applicant, submitted.id);
    const data = await ok<DelegationView>(
      api,
      world.applicant.token,
      INSTANCE_DELEGATION,
      {
        id: row.currentInstanceId,
      },
    );
    const step = data.workflowInstance.instance.steps.find(
      (one) => one.stepKey === "first",
    );
    expect(step?.plan[0]?.assignee.id).toBe(String(deputy.userId));
    expect(step?.plan[0]?.delegators.map((one) => one.id)).toEqual([
      String(original.userId),
    ]);
    expect(step?.plan[0]?.delegators[0]?.name).not.toBeNull();
    expect(
      data.workflowInstance.instance.history.find(
        (event) => event.kind === "task_created",
      ),
    ).toEqual({
      kind: "task_created",
      user: { id: String(deputy.userId) },
      delegators: [{ id: String(original.userId) }],
    });

    // 讀取:代理人以任務持有者規則讀得到他審的修訂
    const read = await submission(world, deputy, submitted.id);
    expect(read.id).toBe(submitted.id);

    // 代理人核准即過
    await decideOn(world, deputy, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
  });

  it("代理人承接的任務經流程管理者改派 → 新承辦人不是代理,被代理者清空", async () => {
    const [original, deputy, other] = await freshStaff();
    await delegate(original, deputy);
    await bindNew({ steps: [usersStep("first", [original])] });
    const submitted = await submitLeave(world);
    const task = await pendingTaskOf(world, deputy, submitted.id);
    await ok(api, world.admin.token, REASSIGN, {
      input: { taskId: task.id, toUserId: String(other.userId) },
    });

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(other.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([]);
    const row = await submission(world, world.applicant, submitted.id);
    const data = await ok<DelegationView>(
      api,
      world.applicant.token,
      INSTANCE_DELEGATION,
      {
        id: row.currentInstanceId,
      },
    );
    const [item] =
      data.workflowInstance.instance.steps.find(
        (one) => one.stepKey === "first",
      )?.plan ?? [];
    expect(item?.assignee.id).toBe(String(other.userId));
    expect(item?.delegators).toEqual([]);
  });

  it("代理人停用 → 照原審核者派任並記 log", async () => {
    const [original, deputy] = await freshStaff();
    await delegate(original, deputy);
    await setEnabled(deputy, false);
    const warn = jest.spyOn(Logger.prototype, "warn");
    try {
      await bindNew({ steps: [usersStep("first", [original])] });
      const submitted = await submitLeave(world);
      const plan = planOf(await latestInstance(submitted.id), "first");
      expect(plan.map((item) => String(item.assigneeId))).toEqual([
        String(original.userId),
      ]);
      expect(delegatorsIn(plan[0])).toEqual([]);
      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes(String(deputy.userId)),
        ),
      ).toBe(true);
    } finally {
      await setEnabled(deputy, true);
    }
  });

  it("代理人不在本租戶(被移出)→ 照原審核者派任", async () => {
    const [original, deputy] = await freshStaff();
    await delegate(original, deputy);
    // 設定後代理人被移出租戶:改掛到另一個最上層組織
    const elsewhere = await createOrg(world.connection, { name: "別的租戶" });
    await world.connection
      .collection("core_relationships")
      .updateMany(
        { type: "org_user", secondId: deputy.userId },
        { $set: { firstId: elsewhere } },
      );
    await bindNew({ steps: [usersStep("first", [original])] });
    const submitted = await submitLeave(world);
    expect(
      planOf(await latestInstance(submitted.id), "first").map((item) =>
        String(item.assigneeId),
      ),
    ).toEqual([String(original.userId)]);
  });

  it("代理人是申請人 → 這張單的任務留在原審核者名下", async () => {
    const [original] = await freshStaff();
    await delegate(original, world.applicant);
    await bindNew({ steps: [usersStep("first", [original])] });
    const submitted = await submitLeave(world);
    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(original.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([]);
  });

  it("原審核者本人就是申請人 → 不換成他的代理人:沒開 B5 照規則剔除(阻擋);開了 B5 自動通過", async () => {
    const [deputy] = await freshStaff();
    const applicant = await person(
      api,
      world.connection,
      world.kitchen,
      world.tenant,
    );
    await delegate(applicant, deputy);

    await bindNew({ steps: [usersStep("first", [applicant])] });
    const excluded = await submitLeave(world, null, applicant);
    expect(planOf(await latestInstance(excluded.id), "first")).toEqual([]);
    expect(await tasksOn(deputy, excluded.id)).toEqual([]);

    await bindNew({
      steps: [
        usersStep("first", [applicant], { autoApprove: { applicant: true } }),
      ],
    });
    const auto = await submitLeave(world, null, applicant);
    const plan = planOf(await latestInstance(auto.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(applicant.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([]);
    const row = await submission(world, applicant, auto.id);
    expect(row.status).toBe("COMPLETED");
  });

  it("代理開始前已派出的任務不自動轉給代理人", async () => {
    const [original, deputy] = await freshStaff();
    await bindNew({ steps: [usersStep("first", [original])] });
    const submitted = await submitLeave(world);
    await delegate(original, deputy);
    // 再推進一次也不會改計畫(派任只在進關那一次)
    const task = await pendingTaskOf(world, original, submitted.id);
    expect(task.stepKey).toBe("first");
    expect(await tasksOn(deputy, submitted.id)).toEqual([]);
  });

  it("會簽兩位都委託同一位代理人 → 代理人只有一張待辦,一次核准就算完兩位;時間軸「由 C 代理 A、B 核准」", async () => {
    const [a, b, c] = await freshStaff();
    await delegate(a, c);
    await delegate(b, c);
    await bindNew({ steps: [usersStep("first", [a, b], { mode: "all" })] });
    const submitted = await submitLeave(world);

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(c.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([String(a.userId), String(b.userId)]);
    expect(await tasksOn(c, submitted.id)).toHaveLength(1);

    await decideOn(world, c, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
    const raw = await latestInstance(submitted.id);
    const approved = raw.history.find((event) => event.kind === "approved");
    expect(String(approved?.userId)).toBe(String(c.userId));
    expect(delegatorsIn(approved)).toEqual([
      String(a.userId),
      String(b.userId),
    ]);
  });

  it("代理人本人原本就在會簽名單 → 仍是他自己的一張待辦,另記「A 由 C 代理」;一票算完", async () => {
    const [a, c] = await freshStaff();
    await delegate(a, c);
    await bindNew({ steps: [usersStep("first", [a, c], { mode: "all" })] });
    const submitted = await submitLeave(world);

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(c.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([String(a.userId)]);
    const row = await submission(world, world.applicant, submitted.id);
    const data = await ok<DelegationView>(
      api,
      world.applicant.token,
      INSTANCE_DELEGATION,
      { id: row.currentInstanceId },
    );
    expect(
      data.workflowInstance.instance.history.find(
        (event) => event.kind === "task_created",
      ),
    ).toEqual({
      kind: "task_created",
      user: { id: String(c.userId) },
      delegators: [{ id: String(a.userId) }],
    });
    await decideOn(world, c, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
  });

  it("會簽 A、B 只有 A 在代理期間(A → C)→ C 承接 A 那一項、B 照常;兩張待辦、兩票", async () => {
    const [a, b, c] = await freshStaff();
    await delegate(a, c);
    await bindNew({ steps: [usersStep("first", [a, b], { mode: "all" })] });
    const submitted = await submitLeave(world);

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(c.userId),
      String(b.userId),
    ]);
    expect(plan.map((item) => delegatorsIn(item))).toEqual([
      [String(a.userId)],
      [],
    ]);
    await decideOn(world, c, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("REVIEWING");
    await decideOn(world, b, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
  });

  it("會簽兩位委託同一位代理人,代理人駁回 → 一次作用到兩位(整張駁回),事件記兩位被代理者", async () => {
    const [a, b, c] = await freshStaff();
    await delegate(a, c);
    await delegate(b, c);
    await bindNew({ steps: [usersStep("first", [a, b], { mode: "all" })] });
    const submitted = await submitLeave(world);

    await decideOn(world, c, submitted.id, "REJECT");
    expect(await submissionStatus(world, submitted.id)).toBe("REJECTED");
    const raw = await latestInstance(submitted.id);
    const rejected = raw.history.find((event) => event.kind === "rejected");
    expect(String(rejected?.userId)).toBe(String(c.userId));
    expect(delegatorsIn(rejected)).toEqual([
      String(a.userId),
      String(b.userId),
    ]);
  });

  it("A → C 且 C → D(C 本人在名單、自己也在代理期間)→ C 承接 A、D 承接 C,共兩項(不做代理鏈)", async () => {
    const [a, c, d] = await freshStaff();
    await delegate(a, c);
    await delegate(c, d);
    await bindNew({ steps: [usersStep("first", [a, c], { mode: "all" })] });
    const submitted = await submitLeave(world);

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(c.userId),
      String(d.userId),
    ]);
    expect(plan.map((item) => delegatorsIn(item))).toEqual([
      [String(a.userId)],
      [String(c.userId)],
    ]);
  });

  it("合併後的那一項被流程管理者改派 → 新承辦人一票算整項,被代理者清空", async () => {
    const [a, b, c, other] = [
      ...(await freshStaff()),
      await person(api, world.connection, world.tenant, world.tenant),
    ];
    await delegate(a, c);
    await delegate(b, c);
    await bindNew({ steps: [usersStep("first", [a, b], { mode: "all" })] });
    const submitted = await submitLeave(world);
    const task = await pendingTaskOf(world, c, submitted.id);
    await ok(api, world.admin.token, REASSIGN, {
      input: { taskId: task.id, toUserId: String(other.userId) },
    });

    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(other.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([]);
    await decideOn(world, other, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
  });

  it("會簽兩位委託同一位代理人,代理人退回 → 一次作用到兩位(整張退回),事件記兩位被代理者", async () => {
    const [a, b, c] = await freshStaff();
    await delegate(a, c);
    await delegate(b, c);
    await bindNew({ steps: [usersStep("first", [a, b], { mode: "all" })] });
    const submitted = await submitLeave(world);

    await decideOn(world, c, submitted.id, "RETURN");
    expect(await submissionStatus(world, submitted.id)).toBe("RETURNED");
    const raw = await latestInstance(submitted.id);
    const returned = raw.history.find((event) => event.kind === "returned");
    expect(delegatorsIn(returned)).toEqual([
      String(a.userId),
      String(b.userId),
    ]);
  });

  it("B 代理 A,派任時 B 也在自己的代理期間(B → C)→ 仍派給 B,不轉給 C", async () => {
    const [a, b, c] = await freshStaff();
    await delegate(a, b);
    await delegate(b, c);
    await bindNew({ steps: [usersStep("first", [a])] });
    const submitted = await submitLeave(world);
    const plan = planOf(await latestInstance(submitted.id), "first");
    expect(plan.map((item) => String(item.assigneeId))).toEqual([
      String(b.userId),
    ]);
    expect(delegatorsIn(plan[0])).toEqual([String(a.userId)]);
  });

  it("進行中的代理刪除 → 已派出的任務不變;之後進關不再改派", async () => {
    const [original, deputy] = await freshStaff();
    const id = await delegate(original, deputy);
    await bindNew({
      steps: [usersStep("first", [original]), usersStep("second", [original])],
    });
    const submitted = await submitLeave(world);
    expect(await pendingStep(deputy, submitted.id)).toBe("first");
    await ok(api, original.token, DELETE_DELEGATION, { input: { id } });
    expect(await pendingStep(deputy, submitted.id)).toBe("first");
    // 刪除後才進的下一關照原審核者
    await decideOn(world, deputy, submitted.id, "APPROVE");
    expect(await pendingStep(original, submitted.id)).toBe("second");
  });

  it("「已在前關核准過」只算代理人:代理人前關核准過、這一關又輪到他代理 → 自動通過", async () => {
    const [original, deputy] = await freshStaff();
    await delegate(original, deputy);
    await bindNew({
      steps: [
        usersStep("first", [original]),
        usersStep("second", [original], {
          autoApprove: { priorApprover: true },
        }),
      ],
    });
    const submitted = await submitLeave(world);
    await decideOn(world, deputy, submitted.id, "APPROVE");
    expect(await submissionStatus(world, submitted.id)).toBe("COMPLETED");
    const second = planOf(await latestInstance(submitted.id), "second");
    expect(String(second[0]?.assigneeId)).toBe(String(deputy.userId));
  });
});
