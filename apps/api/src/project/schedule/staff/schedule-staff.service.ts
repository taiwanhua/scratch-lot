import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  SCHEDULE_EMPLOYMENT_TYPES,
  type ScheduleEmploymentType,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  type UserDocument,
  UsersRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { RelationService } from "../../../database/relation.service";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { TransactionService } from "../../../database/transaction";
import type { ScheduleStaffOrgMeta } from "../../database/schedule/schedule-relationship.schema";
import {
  type ScheduleRelationshipDocument,
  ScheduleRelationshipsRepository,
  type ScheduleStaffDocument,
  ScheduleStaffRepository,
} from "../../database/schedule/schedule.repositories";
import {
  notFoundError,
  savingUnique,
  validationError,
} from "../shared/schedule-error";
import {
  parseObjectId,
  resolveScheduleOrg,
  scheduleReadContext,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import type {
  AddScheduleStaffInput,
  ScheduleStaffListInput,
  ScheduleStaffOrgInput,
  UpdateScheduleStaffInput,
} from "./dto/schedule-staff.input";
import type {
  ScheduleStaffListPayload,
  ScheduleStaffProfileModel,
  ScheduleStaffRowModel,
} from "./models/schedule-staff.model";
import type { ScheduleCandidate } from "./schedule-candidates";

type StaffRecord = Persisted<ScheduleStaffDocument>;
type RelationRecord = Persisted<ScheduleRelationshipDocument>;
type UserRecord = Persisted<UserDocument>;

const ORG_STAFF = "org_schedule_staff";
const AUDIT_TARGET_TYPE = "schedule_staff";

function isEmploymentType(value: unknown): value is ScheduleEmploymentType {
  return (SCHEDULE_EMPLOYMENT_TYPES as readonly unknown[]).includes(value);
}

/** 操作者這次看得到的租戶組織(id 字串 → 名稱)。 */
type VisibleOrgs = ReadonlyMap<string, string>;

/**
 * 排班人員(規格 14.3;正本 `docs/modules/project/schedule.md`「排班人員」)。
 *
 * - **候選使用者** = 所屬組織落在操作者可見範圍內(且在同一個租戶)的使用者;不是新建人
 * - 排班檔案**歸當前組織、不共用**(跨店支援由支援需求單把人加進那家店):建立時 `orgId` = 當前組織,
 *   讀取照一般可見性;同一組織一人一筆(唯一 `(orgId, userId)`)
 * - 可以排的分店只能加操作者看得到的(看不到 → `NOT_FOUND`);看不到的分店的關聯保留不動
 * - 每人一家主要分店(有任何可以排的分店時恰好一家)
 */
@Injectable()
export class ScheduleStaffService {
  constructor(
    private readonly staff: ScheduleStaffRepository,
    private readonly relationships: ScheduleRelationshipsRepository,
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  async list(
    operator: OperatorContext,
    input: ScheduleStaffListInput | null,
  ): Promise<ScheduleStaffListPayload> {
    const { visibleOrgs, users } = await this.candidatesOf(operator);
    const staffByUser = await this.staffByUser(operator, users);
    const rows = await this.rowsOf(operator, users, staffByUser, visibleOrgs);
    const keyword = input?.keyword?.trim().toLowerCase() ?? "";
    const joined = input?.joined ?? null;
    const items = rows.filter(
      (row) =>
        (joined === null || (row.staff !== null) === joined) &&
        (keyword === "" ||
          row.name.toLowerCase().includes(keyword) ||
          row.account.toLowerCase().includes(keyword)),
    );
    const holds = await this.permissions.holderOf(operator);
    return {
      items,
      totalCount: items.length,
      canEdit: holds(SCHEDULE_PERMISSIONS.editStaff),
    };
  }

  /** [加入排班]:勾選的使用者都要是看得到、還沒加入的。 */
  async add(
    operator: OperatorContext,
    input: AddScheduleStaffInput,
  ): Promise<ScheduleStaffRowModel[]> {
    if (input.userIds.length === 0) {
      throw validationError("userIds is empty", ["userIds"]);
    }
    const ids = input.userIds.map((id) => parseObjectId(id, "userIds"));
    const { visibleOrgs, users } = await this.candidatesOf(operator);
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const picked = ids.map((id) => {
      const user = byId.get(String(id));
      if (!user) {
        throw notFoundError(`user not found: ${String(id)}`);
      }
      return user;
    });
    // 已加入 = 當前組織已經有這個人的排班檔案(排班檔案歸當前組織,不共用)
    const visibleStaff = await this.staffByUser(operator, picked);
    const existing = new Map(
      [...visibleStaff.entries()].filter(
        ([, record]) => String(record.orgId) === String(operator.currentOrgId),
      ),
    );
    if (existing.size > 0) {
      throw validationError(
        `already joined: ${[...existing.keys()].join(", ")}`,
        ["userIds"],
      );
    }
    // 兩個請求同時加入同一人:唯一索引 (orgId, userId) 擋下第二筆,回同一個錯誤
    await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          for (const user of picked) {
            // 排班檔案歸當前組織(不共用;跨店支援由支援需求單把人加進那家店)
            const created = await this.staff.create(operator, {
              userId: user._id,
              employmentType: "full-time",
              enabled: true,
              note: null,
            });
            await this.audit.record(operator, {
              action: "schedule-staff.create",
              targetType: AUDIT_TARGET_TYPE,
              targetId: created._id,
              after: { userId: user._id },
            });
          }
        }),
      "already joined (concurrent add)",
      ["userIds"],
    );
    const staffByUser = await this.staffByUser(operator, picked);
    return this.rowsOf(operator, picked, staffByUser, visibleOrgs);
  }

  /** 排班人員設定:僱用類型、啟用、備註、可以排的分店(看得到的那幾家整份取代)。 */
  async update(
    operator: OperatorContext,
    input: UpdateScheduleStaffInput,
  ): Promise<ScheduleStaffRowModel> {
    const staffId = parseObjectId(input.staffId, "staffId");
    const { visibleOrgs, users } = await this.candidatesOf(operator);
    // 一般可見性:看得到這份排班檔案所屬的組織才改得到
    const record = await this.staff.findOne(operator, { _id: staffId });
    const user = users.find(
      (candidate) => String(candidate._id) === String(record?.userId),
    );
    if (!record || !user) {
      throw notFoundError(`schedule staff not found: ${input.staffId}`);
    }
    if (
      input.employmentType !== undefined &&
      !isEmploymentType(input.employmentType)
    ) {
      throw validationError(`invalid employmentType: ${input.employmentType}`, [
        "employmentType",
      ]);
    }
    const orgPlan =
      input.orgs === undefined
        ? null
        : await this.planOrgs(operator, record, input.orgs, visibleOrgs);
    // 兩個請求同時替同一人加同一家店:唯一索引擋下第二筆,回同一個 VALIDATION_FAILED
    await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          const set: Record<string, unknown> = {};
          if (input.employmentType !== undefined) {
            set.employmentType = input.employmentType;
          }
          if (input.enabled !== undefined) {
            set.enabled = input.enabled;
          }
          if (input.note !== undefined) {
            set.note = input.note;
          }
          if (Object.keys(set).length > 0) {
            await this.staff.updateById(
              scheduleReadContext(operator),
              record._id,
              {
                $set: set,
              },
            );
          }
          if (orgPlan !== null) {
            await this.applyOrgPlan(operator, record, orgPlan);
          }
          await this.audit.record(operator, {
            action: "schedule-staff.edit",
            targetType: AUDIT_TARGET_TYPE,
            targetId: record._id,
            before: {
              employmentType: record.employmentType,
              enabled: record.enabled,
              note: record.note,
            },
            after: {
              ...set,
              ...(input.orgs === undefined
                ? {}
                : {
                    orgs: input.orgs.map((org) => ({
                      orgId: org.orgId,
                      canLead: org.canLead,
                      isPrimary: org.isPrimary,
                    })),
                  }),
            },
          });
        }),
      "schedule staff branches changed at the same time",
      ["orgs"],
    );
    const staffByUser = await this.staffByUser(operator, [user]);
    const [row] = await this.rowsOf(operator, [user], staffByUser, visibleOrgs);
    if (!row) {
      throw notFoundError(`schedule staff not found: ${input.staffId}`);
    }
    return row;
  }

  /**
   * 某家店的候選人(規格 14.3:有排班檔案、啟用、可以排的分店包含這家店;手動與自動排班同一份名單)。
   * 不看操作者的可見範圍(呼叫端已確認看得到這家店)。
   * `at`(缺席 = 現在):只決定**哪些關聯算數** —— 關聯在那之前加入、那之後才拿掉的都算
   * (查過去的班表時,後來才加入的人不算、後來才拿掉的人照算)。
   * 回傳的 `canLead` / `isPrimary` / `sortOrder`(關聯 meta)、排班檔案的啟用與帳號的啟用**都是現在的值**,
   * 不是那個時間點的(這些欄位沒有歷史)。
   */
  async listScheduleCandidates(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    at: Date = new Date(),
  ): Promise<ScheduleCandidate[]> {
    const context = scheduleReadContext(operator);
    // 多一層防線:關聯與排班檔案都釘在這家店的租戶上
    const org = await this.orgs.findById(context, orgId);
    if (!org) {
      return [];
    }
    const tenantId = tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
    const links = await this.relationships.findMany(
      context,
      {
        type: ORG_STAFF,
        tenantId,
        firstId: orgId,
        createdAt: { $lte: at },
        $or: [{ deletedAt: null }, { deletedAt: { $gt: at } }],
      },
      { includeDeleted: true },
    );
    if (links.length === 0) {
      return [];
    }
    const staff = await this.staff.findMany(context, {
      _id: { $in: links.map((link) => link.secondId) },
      tenantId,
      enabled: true,
    });
    const users = await this.users.findMany(context, {
      _id: { $in: staff.map((item) => item.userId) },
      enabled: true,
    });
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const linkByStaff = new Map(
      links.map((link) => [String(link.secondId), link]),
    );
    return staff
      .flatMap((item): ScheduleCandidate[] => {
        const user = userById.get(String(item.userId));
        const link = linkByStaff.get(String(item._id));
        return user && link
          ? [
              {
                staffId: String(item._id),
                userId: String(user._id),
                name: user.name,
                employmentType: item.employmentType,
                canLead: link.meta.canLead,
                isPrimary: link.meta.isPrimary,
                sortOrder: link.meta.sortOrder,
              },
            ]
          : [];
      })
      .toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name),
      );
  }

  // ---- 內部 ----

  /** 當前組織所屬租戶、操作者看得到的租戶組織、這些組織的使用者(候選使用者)。 */
  private async candidatesOf(operator: OperatorContext): Promise<{
    tenantId: Types.ObjectId;
    visibleOrgs: VisibleOrgs;
    users: UserRecord[];
  }> {
    const org = await resolveScheduleOrg(operator, this.orgs, null);
    const context = scheduleReadContext(operator);
    const tenantOrgs = await this.orgs.findMany(context, {
      $or: [{ _id: org.tenantId }, { ancestors: org.tenantId }],
    });
    const visible = tenantOrgs.filter((item) =>
      isOrgVisible(operator, item._id),
    );
    const visibleOrgs: VisibleOrgs = new Map(
      visible.map((item) => [String(item._id), item.name]),
    );
    const links = await this.relations.listLinks("org_user", {
      firstIds: visible.map((item) => item._id),
    });
    const userIds = [...new Set(links.map((link) => String(link.secondId)))];
    const users =
      userIds.length === 0
        ? []
        : await this.users.findMany(context, {
            _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          });
    return {
      tenantId: org.tenantId,
      visibleOrgs,
      users: users.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  }

  /**
   * 這些使用者看得到的排班檔案(一般可見性);同一人在多個看得到的組織各有一份時,
   * 優先當前組織那份,其次最早建立的。
   */
  private async staffByUser(
    operator: OperatorContext,
    users: readonly UserRecord[],
  ): Promise<Map<string, StaffRecord>> {
    if (users.length === 0) {
      return new Map();
    }
    const records = await this.staff.findMany(
      operator,
      { userId: { $in: users.map((user) => user._id) } },
      { sort: { createdAt: 1 } },
    );
    const current = String(operator.currentOrgId);
    const byUser = new Map<string, StaffRecord>();
    for (const record of records) {
      const key = String(record.userId);
      const kept = byUser.get(key);
      if (
        kept === undefined ||
        (String(kept.orgId) !== current && String(record.orgId) === current)
      ) {
        byUser.set(key, record);
      }
    }
    return byUser;
  }

  private async rowsOf(
    operator: OperatorContext,
    users: readonly UserRecord[],
    staffByUser: ReadonlyMap<string, StaffRecord>,
    visibleOrgs: VisibleOrgs,
  ): Promise<ScheduleStaffRowModel[]> {
    const staffIds = [...staffByUser.values()].map((record) => record._id);
    const links =
      staffIds.length === 0
        ? []
        : await this.relationships.findMany(scheduleReadContext(operator), {
            type: ORG_STAFF,
            secondId: { $in: staffIds },
          });
    const linksByStaff = new Map<string, RelationRecord[]>();
    for (const link of links) {
      const key = String(link.secondId);
      linksByStaff.set(key, [...(linksByStaff.get(key) ?? []), link]);
    }
    return users.map((user) => {
      const record = staffByUser.get(String(user._id));
      return {
        userId: String(user._id),
        name: user.name,
        account: user.account,
        staff: record
          ? profileOf(
              record,
              linksByStaff.get(String(record._id)) ?? [],
              visibleOrgs,
            )
          : null,
      };
    });
  }

  /** 驗輸入的分店,算出要新增 / 更新 / 刪除哪些關聯。 */
  private async planOrgs(
    operator: OperatorContext,
    record: StaffRecord,
    orgs: readonly ScheduleStaffOrgInput[],
    visibleOrgs: VisibleOrgs,
  ): Promise<OrgPlan> {
    const ids = orgs.map((org) => parseObjectId(org.orgId, "orgs"));
    if (new Set(ids.map(String)).size !== ids.length) {
      throw validationError("duplicated org in orgs", ["orgs"]);
    }
    for (const id of ids) {
      if (!visibleOrgs.has(String(id))) {
        throw notFoundError(`org not found: ${String(id)}`);
      }
    }
    const all = await this.relationships.findMany(
      scheduleReadContext(operator),
      {
        type: ORG_STAFF,
        secondId: record._id,
      },
    );
    const hidden = all.filter((link) => !visibleOrgs.has(String(link.firstId)));
    const visible = all.filter((link) => visibleOrgs.has(String(link.firstId)));
    const primaryCount =
      orgs.filter((org) => org.isPrimary).length +
      hidden.filter((link) => link.meta.isPrimary).length;
    const total = orgs.length + hidden.length;
    if (total > 0 && primaryCount !== 1) {
      throw validationError(
        `a staff member needs exactly one primary org (got ${String(primaryCount)})`,
        ["orgs"],
      );
    }
    return {
      upserts: orgs.map((org, index) => ({
        orgId: new Types.ObjectId(org.orgId),
        meta: {
          canLead: org.canLead,
          isPrimary: org.isPrimary,
          sortOrder: index + 1,
        },
        existing:
          visible.find((link) => String(link.firstId) === org.orgId) ?? null,
      })),
      removals: visible.filter(
        (link) => !orgs.some((org) => org.orgId === String(link.firstId)),
      ),
    };
  }

  private async applyOrgPlan(
    operator: OperatorContext,
    record: StaffRecord,
    plan: OrgPlan,
  ): Promise<void> {
    const context = scheduleReadContext(operator);
    for (const link of plan.removals) {
      await this.relationships.softDeleteById(context, link._id);
    }
    for (const upsert of plan.upserts) {
      await (upsert.existing
        ? this.relationships.updateById(context, upsert.existing._id, {
            $set: { meta: upsert.meta },
          })
        : this.relationships.create(operator, {
            orgId: upsert.orgId,
            type: ORG_STAFF,
            firstId: upsert.orgId,
            secondId: record._id,
            meta: upsert.meta,
          }));
    }
  }
}

interface OrgPlan {
  upserts: {
    orgId: Types.ObjectId;
    meta: ScheduleStaffOrgMeta;
    existing: RelationRecord | null;
  }[];
  removals: RelationRecord[];
}

function profileOf(
  record: StaffRecord,
  links: readonly RelationRecord[],
  visibleOrgs: VisibleOrgs,
): ScheduleStaffProfileModel {
  const orgs = links
    .filter((link) => visibleOrgs.has(String(link.firstId)))
    .toSorted((left, right) => left.meta.sortOrder - right.meta.sortOrder)
    .map((link) => ({
      orgId: String(link.firstId),
      orgName: visibleOrgs.get(String(link.firstId)) ?? "",
      canLead: link.meta.canLead,
      isPrimary: link.meta.isPrimary,
      sortOrder: link.meta.sortOrder,
    }));
  return {
    id: String(record._id),
    employmentType: record.employmentType,
    enabled: record.enabled,
    note: record.note,
    orgs,
    primaryElsewhere: links.some(
      (link) => link.meta.isPrimary && !visibleOrgs.has(String(link.firstId)),
    ),
  };
}
