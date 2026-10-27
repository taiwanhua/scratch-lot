import { describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import {
  STORE_BOARD_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";

import type { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import type {
  PermissionResolution,
  PermissionResolver,
} from "../../../permission/permission-resolver";
import { composeRealtimeBoards } from "../../../realtime/realtime-board-registration";
import { RealtimeTicketService } from "../../../realtime/realtime-ticket.service";
import type { RealtimeConfig } from "../../../realtime/realtime.config";
import { PROJECT_REALTIME_BOARDS } from "../../realtime-boards";

const NOW = 1_800_000_000;
const CONFIG: RealtimeConfig = {
  enabled: true,
  url: "https://rt-dev.example.com",
  publishSecret: "publish-secret",
  ticketSecret: "ticket-secret",
};

// 組織樹:根 → 租戶甲(→ 信義店、板橋店)
const root = new Types.ObjectId();
const tenant = new Types.ObjectId();
const xinyi = new Types.ObjectId();
const banqiao = new Types.ObjectId();
const ORGS = new Map(
  [
    { _id: root, ancestors: [] },
    { _id: tenant, ancestors: [root] },
    { _id: xinyi, ancestors: [root, tenant] },
    { _id: banqiao, ancestors: [root, tenant] },
  ].map((org) => [String(org._id), org]),
);

function serviceWith(permissionKeys: string[]): RealtimeTicketService {
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
  return new RealtimeTicketService(
    CONFIG,
    composeRealtimeBoards(PROJECT_REALTIME_BOARDS),
    permissions,
    orgs,
  );
}

const actorId = new Types.ObjectId();
const clerk: OperatorContext = {
  actorId,
  currentOrgId: xinyi,
  visibleOrgIds: [xinyi],
  managedOrgIds: [],
  memberOrgIds: [xinyi],
  roleIds: [],
  memberTenants: [
    { tenantId: tenant, memberOrgIds: [xinyi], ancestorOrgIds: [tenant] },
  ],
};

async function topicsOf(
  service: RealtimeTicketService,
  orgId: Types.ObjectId,
): Promise<string[]> {
  const grant = await service.issue(
    clerk,
    { key: STORE_BOARD_KEY, orgId: String(orgId) },
    NOW,
  );
  return grant?.topics ?? [];
}

describe("店面看板頻道 board:<分店>(規格 6.1、RT-04)", () => {
  it("登記:看板 key store-board 對應 store.view", () => {
    expect(PROJECT_REALTIME_BOARDS).toContainEqual({
      key: STORE_BOARD_KEY,
      moduleKey: "store",
      permission: STORE_PERMISSIONS.view,
    });
  });

  it("有 store.view、分店在可見範圍內 → 放入 board:<分店>", async () => {
    expect(
      await topicsOf(serviceWith([STORE_PERMISSIONS.view]), xinyi),
    ).toEqual([`user:${String(actorId)}`, `board:${String(xinyi)}`]);
  });

  it("沒有 store.view(只有開班)→ 不放入", async () => {
    expect(
      await topicsOf(serviceWith([STORE_PERMISSIONS.openShift]), xinyi),
    ).toEqual([`user:${String(actorId)}`]);
  });

  it("分店不在可見範圍內 → 不放入", async () => {
    expect(
      await topicsOf(serviceWith([STORE_PERMISSIONS.view]), banqiao),
    ).toEqual([`user:${String(actorId)}`]);
  });
});
