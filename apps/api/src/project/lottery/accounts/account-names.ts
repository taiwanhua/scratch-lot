import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";

const uniqueIds = (ids: readonly unknown[]): Types.ObjectId[] => [
  ...new Map(
    ids
      .filter((id) => id !== null && id !== undefined)
      .map(String)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => [id, new Types.ObjectId(id)]),
  ).values(),
];

/**
 * 帳戶管理顯示用的名稱對照(一批列一次查完)。
 *
 * - 組織名稱(使用組織、歸屬分店):以租戶為邊界讀 —— 看得到帳戶 / 交易就看得到它掛的分店名稱
 *   (使用組織可能是讀者看不到的組織;登記在 `TENANT_BOUNDARY_CONTEXT_CALLERS`,用途「反查」)
 * - 使用者名稱(登記人):同上,登記人可能是別家分店的人
 */
@Injectable()
export class AccountNames {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
  ) {}

  async orgNames(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.orgs.findMany(reader, { _id: { $in: unique } });
    return new Map(found.map((org) => [String(org._id), org.name]));
  }

  async userNames(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    ids: readonly unknown[],
  ): Promise<Map<string, string>> {
    const unique = uniqueIds(ids);
    if (unique.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.users.findMany(reader, {
      _id: { $in: unique },
    });
    return new Map(found.map((user) => [String(user._id), user.name]));
  }
}
