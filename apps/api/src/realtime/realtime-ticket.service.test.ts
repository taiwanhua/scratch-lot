import { describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import { verifyRealtimeTicket } from "@repo/domain/realtime";

import type { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type {
  PermissionResolution,
  PermissionResolver,
} from "../permission/permission-resolver";
import type { RealtimeBoardRegistration } from "./realtime-board-registration";
import { REALTIME_PLATFORM_HUB } from "./realtime-publisher.service";
import { RealtimeTicketService } from "./realtime-ticket.service";
import type { RealtimeConfig } from "./realtime.config";

const NOW = 1_800_000_000;
const SECRET = "ticket-secret";
const CONFIG: RealtimeConfig = {
  enabled: true,
  url: "https://rt-dev.example.com",
  publishSecret: "publish-secret",
  ticketSecret: SECRET,
};
const BOARD: RealtimeBoardRegistration = {
  key: "store-board",
  moduleKey: "store-board",
  permission: "store-board.view",
};
const KITCHEN_BOARD: RealtimeBoardRegistration = {
  key: "kitchen-board",
  moduleKey: "kitchen",
  permission: "kitchen.view",
};

// 組織樹:根 → 租戶 A(→ 分店 A1、A2)、租戶 B(→ 分店 B1)
const root = new Types.ObjectId();
const tenantA = new Types.ObjectId();
const storeA1 = new Types.ObjectId();
const storeA2 = new Types.ObjectId();
const tenantB = new Types.ObjectId();
const storeB1 = new Types.ObjectId();
const ORGS = new Map(
  [
    { _id: root, ancestors: [] },
    { _id: tenantA, ancestors: [root] },
    { _id: storeA1, ancestors: [root, tenantA] },
    { _id: storeA2, ancestors: [root, tenantA] },
    { _id: tenantB, ancestors: [root] },
    { _id: storeB1, ancestors: [root, tenantB] },
  ].map((org) => [String(org._id), org]),
);

function serviceWith(
  permissionKeys: string[],
  {
    config = CONFIG,
    boards = [BOARD],
  }: { config?: RealtimeConfig; boards?: RealtimeBoardRegistration[] } = {},
) {
  const resolution: PermissionResolution = {
    isSuperAdmin: false,
    modules: [],
    permissionKeys: new Set(permissionKeys),
    foreignPermissionKeys: new Set(),
  };
  const permissions = {
    resolve: () => Promise.resolve(resolution),
  } as unknown as PermissionResolver;
  const orgs = {
    findById: (_reader: OperatorContext, id: Types.ObjectId) =>
      Promise.resolve(ORGS.get(String(id)) ?? null),
  } as unknown as OrgsRepository;
  return new RealtimeTicketService(config, boards, permissions, orgs);
}

const actorId = new Types.ObjectId();

function operator(
  currentOrgId: Types.ObjectId | null,
  visibleOrgIds: OperatorContext["visibleOrgIds"],
): OperatorContext {
  return {
    actorId,
    currentOrgId,
    visibleOrgIds,
    managedOrgIds: [],
    memberOrgIds: [],
    roleIds: [],
  };
}

const self = `user:${String(actorId)}`;
const inTenantA = operator(storeA1, [storeA1]);

async function topicsOf(
  service: RealtimeTicketService,
  who: OperatorContext,
  boardOrgId: Types.ObjectId | string | null = null,
  boardKey = BOARD.key,
) {
  const grant = await service.issue(
    who,
    boardOrgId === null ? null : { key: boardKey, orgId: String(boardOrgId) },
    NOW,
  );
  if (grant === null) {
    throw new Error("沒有簽發");
  }
  const verified = await verifyRealtimeTicket(grant.ticket, SECRET, NOW);
  if (!verified.ok) {
    throw new Error(verified.reason);
  }
  expect(verified.ticket.topics).toEqual(grant.topics);
  return { grant, ticket: verified.ticket };
}

describe("realtimeTicket:只含操作者有權的頻道", () => {
  it("登入後的憑證只含 user:<自己>;10 分鐘;租戶 = 目前組織所屬租戶;連線網址是 wss", async () => {
    const { grant, ticket } = await topicsOf(
      serviceWith(["store-board.view"]),
      inTenantA,
    );
    expect(ticket).toEqual({
      tenantId: String(tenantA),
      userId: String(actorId),
      exp: NOW + 600,
      topics: [self],
    });
    expect(grant.connectUrl).toBe("wss://rt-dev.example.com/connect");
    expect(grant.expiresAt).toBe(NOW + 600);
  });

  it("進入分店的看板頁:有檢視權限且分店在可見範圍內 → 多一個 board:<分店>", async () => {
    const { ticket } = await topicsOf(
      serviceWith(["store-board.view"]),
      inTenantA,
      storeA1,
    );
    expect(ticket.topics).toEqual([self, `board:${String(storeA1)}`]);
  });

  it("模組 wildcard 也算持有檢視權限", async () => {
    const { ticket } = await topicsOf(
      serviceWith(["store-board.*"]),
      inTenantA,
      storeA1,
    );
    expect(ticket.topics).toContain(`board:${String(storeA1)}`);
  });

  it("沒有看板的檢視權限(含被拔)→ 只含 user:<自己>", async () => {
    const { ticket } = await topicsOf(serviceWith([]), inTenantA, storeA1);
    expect(ticket.topics).toEqual([self]);
  });

  it("分店不在可見範圍(含可見範圍改變後)→ 只含 user:<自己>", async () => {
    const { ticket } = await topicsOf(
      serviceWith(["store-board.view"]),
      inTenantA,
      storeA2,
    );
    expect(ticket.topics).toEqual([self]);
  });

  it("可見範圍是全部時也不放別的租戶的分店", async () => {
    const service = serviceWith(["store-board.view"]);
    const everywhere = operator(storeA1, "all");
    const otherTenant = await topicsOf(service, everywhere, storeB1);
    expect(otherTenant.ticket.topics).toEqual([self]);
    const sameTenant = await topicsOf(service, everywhere, storeA2);
    expect(sameTenant.ticket.topics).toEqual([
      self,
      `board:${String(storeA2)}`,
    ]);
  });

  it("專案沒有登記看板 → 不放 board:;不合法的 id 也不放", async () => {
    const noBoards = await topicsOf(
      serviceWith(["store-board.view"], { boards: [] }),
      inTenantA,
      storeA1,
    );
    expect(noBoards.ticket.topics).toEqual([self]);
    const badId = await topicsOf(
      serviceWith(["store-board.view"]),
      inTenantA,
      "not-an-id",
    );
    expect(badId.ticket.topics).toEqual([self]);
  });

  it("切換目前組織到另一個租戶 → 憑證的租戶跟著換(Durable Object 會拒絕原連線換發,前端重連)", async () => {
    const { ticket } = await topicsOf(
      serviceWith([]),
      operator(storeB1, [storeA1, storeB1]),
    );
    expect(ticket.tenantId).toBe(String(tenantB));
    expect(ticket.topics).toEqual([self]);
  });

  it("根組織(平台)與沒有目前組織 → platform", async () => {
    for (const who of [operator(root, "all"), operator(null, [])]) {
      const { ticket } = await topicsOf(serviceWith([]), who);
      expect(ticket.tenantId).toBe(REALTIME_PLATFORM_HUB);
    }
  });

  it("即時通道停用或沒有登入主體 → null(前端改 60 秒輪詢)", async () => {
    await expect(
      serviceWith([], { config: { enabled: false } }).issue(inTenantA, null),
    ).resolves.toBeNull();
    await expect(
      serviceWith([]).issue({ ...inTenantA, actorId: null }, null),
    ).resolves.toBeNull();
  });

  it("資格看帶的那個看板登記的權限:有 A 看板的權限不能換到 B 看板的頻道;沒登記的 key 不放", async () => {
    const service = serviceWith(["store-board.view"], {
      boards: [BOARD, KITCHEN_BOARD],
    });
    const own = await topicsOf(service, inTenantA, storeA1, "store-board");
    expect(own.ticket.topics).toContain(`board:${String(storeA1)}`);
    const other = await topicsOf(service, inTenantA, storeA1, "kitchen-board");
    expect(other.ticket.topics).toEqual([self]);
    const unknown = await topicsOf(service, inTenantA, storeA1, "nope");
    expect(unknown.ticket.topics).toEqual([self]);
  });
});

describe("代理程式的訂閱憑證", () => {
  const agentId = String(new Types.ObjectId());

  it("只含 print-agent:<自己>,租戶 = 代理程式分店所屬租戶;10 分鐘", async () => {
    const grant = await serviceWith([]).issueForAgent(tenantA, agentId, NOW);
    if (grant === null) {
      throw new Error("沒有簽發");
    }
    const verified = await verifyRealtimeTicket(grant.ticket, SECRET, NOW);
    expect(verified).toEqual({
      ok: true,
      ticket: {
        tenantId: String(tenantA),
        agentId,
        exp: NOW + 600,
        topics: [`print-agent:${agentId}`],
      },
    });
    expect(grant.connectUrl).toBe("wss://rt-dev.example.com/connect");
  });

  it("根組織的代理程式 → platform;即時通道停用 → null", async () => {
    const grant = await serviceWith([]).issueForAgent(null, agentId, NOW);
    const verified = await verifyRealtimeTicket(
      grant?.ticket ?? "",
      SECRET,
      NOW,
    );
    expect(verified.ok && verified.ticket.tenantId).toBe(REALTIME_PLATFORM_HUB);
    await expect(
      serviceWith([], { config: { enabled: false } }).issueForAgent(
        tenantA,
        agentId,
      ),
    ).resolves.toBeNull();
  });
});
