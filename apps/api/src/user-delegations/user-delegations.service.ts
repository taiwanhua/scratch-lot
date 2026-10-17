import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import {
  OrgsRepository,
  type UserDelegationDocument,
  UserDelegationsRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { tenantIdOfOrg } from "../database/tenant-id";
import { FormUserNames, userRefOf } from "../forms/form-mapper";
import {
  TenantDirectoryService,
  systemContext,
} from "../workflows/tenant-directory.service";
import {
  type CreateMyDelegationInput,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type MyDelegateCandidatesInput,
  type MyDelegationsInput,
  type UpdateMyDelegationInput,
} from "./dto/user-delegations.input";
import {
  type MyDelegateCandidatesPayload,
  type MyDelegationsPayload,
  type UserDelegationModel,
  UserDelegationStatusEnum,
} from "./models/user-delegations.model";
import {
  userDelegationNotFound,
  userDelegationRejected,
} from "./user-delegations-error";

type DelegationRecord = Persisted<UserDelegationDocument>;

function escapeRegex(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function pageOf(input: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

function noteOf(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function delegationStatusOf(
  delegation: Pick<DelegationRecord, "startAt" | "endAt">,
  now: Date,
): UserDelegationStatusEnum {
  if (delegation.endAt.getTime() <= now.getTime()) {
    return UserDelegationStatusEnum.ENDED;
  }
  return delegation.startAt.getTime() <= now.getTime()
    ? UserDelegationStatusEnum.ACTIVE
    : UserDelegationStatusEnum.UPCOMING;
}

/**
 * 代理人(《底座規格》3.7 B15):每個人只能讀寫**自己的**代理(身分取自登入,不收 userId),
 * 所有登入者都能用(個人設定不分配給角色,不經模組權限)。
 *
 * | 情況                                 | 結果                                               |
 * | ------------------------------------ | -------------------------------------------------- |
 * | 和自己既有(未結束)代理期間重疊       | `VALIDATION_FAILED` / `DELEGATION_OVERLAP`         |
 * | 代理人 = 自己                        | `VALIDATION_FAILED` / `SELF_DELEGATION`            |
 * | 代理人停用 / 不在操作者的最上層組織   | `VALIDATION_FAILED` / `DELEGATE_NOT_ELIGIBLE`      |
 * | 迄 <= 起;新增時迄已過                | `VALIDATION_FAILED` / `INVALID_PERIOD`             |
 * | 改 / 刪已結束的代理                  | `VALIDATION_FAILED` / `DELEGATION_ENDED`(唯讀)     |
 * | 改 / 刪別人的或不存在的              | `NOT_FOUND`                                        |
 *
 * 改迄日或刪除都不動已派出的任務(派任只在進關那一次看代理,`AssigneeDelegationService`)。
 * 「代理人仍啟用、在本租戶」在派任當下再判斷一次(設定後才被停用的,派任時照原審核者)。
 */
@Injectable()
export class UserDelegationsService {
  constructor(
    private readonly delegations: UserDelegationsRepository,
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly directory: TenantDirectoryService,
    private readonly userNames: FormUserNames,
  ) {}

  async mine(
    operator: OperatorContext,
    input: MyDelegationsInput,
  ): Promise<MyDelegationsPayload> {
    const userId = this.userIdOf(operator);
    const { page, pageSize } = pageOf(input);
    const documents = await this.delegations.findMany(
      operator,
      { userId },
      {
        sort: { startAt: -1, _id: -1 },
        skip: (page - 1) * pageSize,
        limit: pageSize,
      },
    );
    const totalCount = await this.delegations.count(operator, { userId });
    return {
      items: await this.toModels(documents),
      page,
      pageSize,
      totalCount,
    };
  }

  /** 可選的代理人:操作者目前所在最上層組織的成員、啟用中、不是自己;站在根組織 → 空。 */
  async candidates(
    operator: OperatorContext,
    input: MyDelegateCandidatesInput,
  ): Promise<MyDelegateCandidatesPayload> {
    const userId = this.userIdOf(operator);
    const { page, pageSize } = pageOf(input);
    const tenantId = await this.tenantOf(operator);
    if (tenantId === null) {
      return { items: [], page, pageSize, totalCount: 0 };
    }
    const members = [...(await this.directory.memberIds(tenantId))]
      .filter((id) => id !== String(userId))
      .map((id) => new Types.ObjectId(id));
    const keyword = input.keyword?.trim() ?? "";
    const filter = {
      _id: { $in: members },
      enabled: true,
      ...(keyword !== "" && {
        $or: [
          { name: { $regex: escapeRegex(keyword), $options: "i" } },
          { account: { $regex: escapeRegex(keyword), $options: "i" } },
        ],
      }),
    };
    const found = await this.users.findMany(systemContext(), filter, {
      sort: { name: 1, _id: 1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    const totalCount = await this.users.count(systemContext(), filter);
    return {
      items: found.map((user) => ({
        id: String(user._id),
        name: user.name,
        account: user.account,
      })),
      page,
      pageSize,
      totalCount,
    };
  }

  async create(
    operator: OperatorContext,
    input: CreateMyDelegationInput,
  ): Promise<UserDelegationModel> {
    const userId = this.userIdOf(operator);
    const now = new Date();
    if (!Types.ObjectId.isValid(input.delegateUserId)) {
      throw userDelegationRejected("DELEGATE_NOT_ELIGIBLE");
    }
    const delegateUserId = new Types.ObjectId(input.delegateUserId);
    if (delegateUserId.equals(userId)) {
      throw userDelegationRejected("SELF_DELEGATION");
    }
    if (
      input.endAt.getTime() <= input.startAt.getTime() ||
      input.endAt.getTime() <= now.getTime()
    ) {
      throw userDelegationRejected("INVALID_PERIOD");
    }
    const tenantId = await this.tenantOf(operator);
    if (
      tenantId === null ||
      !(await this.directory.isEligible(tenantId, delegateUserId))
    ) {
      throw userDelegationRejected("DELEGATE_NOT_ELIGIBLE");
    }
    await this.assertNoOverlap(operator, userId, input.startAt, input.endAt);
    const created = await this.delegations.create(operator, {
      userId,
      delegateUserId,
      startAt: input.startAt,
      endAt: input.endAt,
      note: noteOf(input.note),
    });
    return this.toModel(created, now);
  }

  async update(
    operator: OperatorContext,
    input: UpdateMyDelegationInput,
  ): Promise<UserDelegationModel> {
    const now = new Date();
    const current = await this.ownOpen(operator, input.id, now);
    if (input.endAt.getTime() <= current.startAt.getTime()) {
      throw userDelegationRejected("INVALID_PERIOD");
    }
    await this.assertNoOverlap(
      operator,
      current.userId,
      current.startAt,
      input.endAt,
      current._id,
    );
    const updated = await this.delegations.updateById(operator, current._id, {
      $set: {
        endAt: input.endAt,
        ...(input.note !== undefined && { note: noteOf(input.note) }),
      },
    });
    if (updated === null) {
      throw userDelegationNotFound(input.id);
    }
    return this.toModel(updated, now);
  }

  async remove(operator: OperatorContext, id: string): Promise<string> {
    const current = await this.ownOpen(operator, id, new Date());
    const deleted = await this.delegations.softDeleteById(
      operator,
      current._id,
    );
    if (deleted === null) {
      throw userDelegationNotFound(id);
    }
    return String(current._id);
  }

  /** 自己的、還沒結束的那一筆;別人的 / 不存在 → NOT_FOUND;已結束 → DELEGATION_ENDED。 */
  private async ownOpen(
    operator: OperatorContext,
    id: string,
    now: Date,
  ): Promise<DelegationRecord> {
    const userId = this.userIdOf(operator);
    const current = Types.ObjectId.isValid(id)
      ? await this.delegations.findOne(operator, {
          _id: new Types.ObjectId(id),
          userId,
        })
      : null;
    if (current === null) {
      throw userDelegationNotFound(id);
    }
    if (delegationStatusOf(current, now) === UserDelegationStatusEnum.ENDED) {
      throw userDelegationRejected("DELEGATION_ENDED");
    }
    return current;
  }

  /** 與自己其他代理期間(`[startAt, endAt)`)有交集 → 擋。 */
  private async assertNoOverlap(
    operator: OperatorContext,
    userId: Types.ObjectId,
    startAt: Date,
    endAt: Date,
    exceptId: Types.ObjectId | null = null,
  ): Promise<void> {
    const overlapping = await this.delegations.count(operator, {
      userId,
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
      ...(exceptId !== null && { _id: { $ne: exceptId } }),
    });
    if (overlapping > 0) {
      throw userDelegationRejected("DELEGATION_OVERLAP");
    }
  }

  /** 操作者目前組織所屬的最上層組織;站在根組織(或沒有目前組織)= null。 */
  private async tenantOf(
    operator: OperatorContext,
  ): Promise<Types.ObjectId | null> {
    if (operator.currentOrgId === null) {
      return null;
    }
    const org = await this.orgs.findById(
      systemContext(),
      operator.currentOrgId,
    );
    return org === null
      ? null
      : tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
  }

  private async toModels(
    documents: readonly DelegationRecord[],
  ): Promise<UserDelegationModel[]> {
    const names = await this.userNames.load(
      systemContext(),
      documents.map((document) => document.delegateUserId),
    );
    const now = new Date();
    return documents.map((document) => this.modelOf(document, names, now));
  }

  private async toModel(
    document: DelegationRecord,
    now: Date,
  ): Promise<UserDelegationModel> {
    const names = await this.userNames.load(systemContext(), [
      document.delegateUserId,
    ]);
    return this.modelOf(document, names, now);
  }

  private modelOf(
    document: DelegationRecord,
    names: ReadonlyMap<string, string>,
    now: Date,
  ): UserDelegationModel {
    return {
      id: String(document._id),
      delegate: userRefOf(document.delegateUserId, names) ?? {
        id: String(document.delegateUserId),
        name: null,
      },
      startAt: document.startAt,
      endAt: document.endAt,
      note: document.note,
      status: delegationStatusOf(document, now),
      createdAt: document.createdAt,
    };
  }

  private userIdOf(operator: OperatorContext): Types.ObjectId {
    if (operator.actorId === null) {
      throw new Error("代理只給已登入的使用者讀寫(operator.actorId 為 null)");
    }
    return operator.actorId;
  }
}
