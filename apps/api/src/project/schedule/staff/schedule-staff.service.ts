import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { compareDisplayName } from "@repo/domain/collation";
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
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
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
  SCHEDULE_REASONS,
  forbiddenError,
  notFoundError,
  savingUnique,
  validationError,
} from "../shared/schedule-error";
import {
  parseObjectId,
  resolveScheduleOrg,
  scheduleOrgReader,
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
 * - 排班檔案是使用者的子檔,**一個租戶一人一份**(唯一 `(tenantId, userId)`);建立時 `orgId` = 當前組織。
 *   讀取:可見範圍,加上「可以排的分店」的店(資料共用的 sharedByFields,ADR-0014;跨店支援也看得到);
 *   修改:只有歸屬組織在可見範圍內的(別店建的只能看,`staff.isShared = true`;改了回 `NOT_OWNER`)。
 *   列表 = 候選使用者,加上共用進來的檔案的人(使用者本身不在可見範圍也列)。
 *   完全看不到的組織加入的人,列表標 `joinedElsewhere`、不能再加入
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
    const {
      tenantId,
      visibleOrgs,
      users: candidates,
    } = await this.candidatesOf(operator);
    const staffByUser = await this.staffByUser(operator, candidates);
    // 共用進來的:可以排的分店有我的店、但使用者不在可見範圍(只能看,`staff.isShared = true`)
    const shared = await this.sharedFromElsewhere(
      operator,
      tenantId,
      visibleOrgs,
      candidates,
    );
    for (const record of shared.records) {
      staffByUser.set(String(record.userId), record);
    }
    const users = [...candidates, ...shared.users].toSorted((left, right) =>
      compareDisplayName(left.name, right.name),
    );
    const joinedInTenant = await this.joinedInTenant(operator, tenantId, users);
    const rows = await this.rowsOf(
      operator,
      users,
      staffByUser,
      visibleOrgs,
      joinedInTenant,
    );
    const keyword = input?.keyword?.trim().toLowerCase() ?? "";
    const joined = input?.joined ?? null;
    // 「已在其他組織加入」(`joinedElsewhere`)算已加入:一人一份,不能再加入,不列在「未加入」
    const items = rows.filter(
      (row) =>
        (joined === null ||
          (row.staff !== null || row.joinedElsewhere) === joined) &&
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
    const { tenantId, visibleOrgs, users } = await this.candidatesOf(operator);
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const picked = ids.map((id) => {
      const user = byId.get(String(id));
      if (!user) {
        throw notFoundError(`user not found: ${String(id)}`);
      }
      return user;
    });
    // 已加入 = 整個租戶裡已經有這個人的排班檔案(一人一份;含操作者看不到的組織加入的)
    const existing = await this.joinedInTenant(operator, tenantId, picked);
    if (existing.size > 0) {
      throw validationError(
        `already joined: ${[...existing].join(", ")}`,
        ["userIds"],
        SCHEDULE_REASONS.alreadyJoined,
      );
    }
    // 兩個請求同時加入同一人:唯一索引 (tenantId, userId) 擋下第二筆,回同一個錯誤
    await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          // 排班檔案歸當前組織(不共用;跨店支援由支援需求單把人加進那家店);一次寫入、稽核每人一筆(TX-06)
          const created = await this.staff.createMany(
            operator,
            picked.map((user) => ({
              userId: user._id,
              employmentType: "full-time",
              enabled: true,
              note: null,
            })),
          );
          await this.audit.recordMany(
            operator,
            created.map((record) => ({
              action: "schedule-staff.create",
              targetType: AUDIT_TARGET_TYPE,
              targetId: record._id,
              after: { userId: record.userId },
            })),
          );
        }),
      "already joined (concurrent add)",
      ["userIds"],
      SCHEDULE_REASONS.alreadyJoined,
    );
    const staffByUser = await this.staffByUser(operator, picked);
    return this.rowsOf(
      operator,
      picked,
      staffByUser,
      visibleOrgs,
      await this.joinedInTenant(operator, tenantId, picked),
    );
  }

  /** 排班人員設定:僱用類型、啟用、備註、可以排的分店(看得到的那幾家整份取代)。 */
  async update(
    operator: OperatorContext,
    input: UpdateScheduleStaffInput,
  ): Promise<ScheduleStaffRowModel> {
    const staffId = parseObjectId(input.staffId, "staffId");
    const { tenantId, visibleOrgs, users } = await this.candidatesOf(operator);
    // 讀得到(含依可以排的分店共用進來的)才往下判斷;找不到 → NOT_FOUND
    const record = await this.staff.findOne(operator, { _id: staffId });
    if (!record) {
      throw notFoundError(`schedule staff not found: ${input.staffId}`);
    }
    // 共用進來的(別店建的檔案)只能看(ADR-0014):先於候選使用者判斷,使用者不在可見範圍也回 NOT_OWNER
    if (!isOrgVisible(operator, record.orgId)) {
      throw forbiddenError(
        `schedule staff ${input.staffId} belongs to another org`,
        "NOT_OWNER",
      );
    }
    const user = users.find(
      (candidate) => String(candidate._id) === String(record.userId),
    );
    if (!user) {
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
            await this.staff.updateById(operator, record._id, { $set: set });
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
      SCHEDULE_REASONS.concurrentEdit,
    );
    const staffByUser = await this.staffByUser(operator, [user]);
    const [row] = await this.rowsOf(
      operator,
      [user],
      staffByUser,
      visibleOrgs,
      await this.joinedInTenant(operator, tenantId, [user]),
    );
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
    // 這家店要在操作者(或排程的租戶系統身分)的可見範圍內;候選人以租戶為邊界讀(畫休、排班以人為準)
    if (!isOrgVisible(operator, orgId)) {
      return [];
    }
    const org = await this.orgs.findById(scheduleOrgReader(operator), orgId);
    if (!org) {
      return [];
    }
    const tenantId = tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors });
    if (tenantId === null) {
      return [];
    }
    const context = await tenantBoundaryContext(this.orgs, null, tenantId);
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
          compareDisplayName(left.name, right.name),
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
    // 候選使用者 = 所屬組織在可見範圍內的人:先以租戶為邊界列出組織樹,再依可見範圍篩
    const context = await tenantBoundaryContext(this.orgs, null, org.tenantId);
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
        compareDisplayName(left.name, right.name),
      ),
    };
  }

  /** 這些使用者看得到的排班檔案(一般可見性;一人一份)。 */
  private async staffByUser(
    operator: OperatorContext,
    users: readonly UserRecord[],
  ): Promise<Map<string, StaffRecord>> {
    if (users.length === 0) {
      return new Map();
    }
    const records = await this.staff.findMany(operator, {
      userId: { $in: users.map((user) => user._id) },
    });
    return new Map(records.map((record) => [String(record.userId), record]));
  }

  /**
   * 共用進來、但使用者不在候選使用者裡的排班檔案(別店建的,可以排的分店有操作者看得到的店)。
   * 檔案用一般可見性讀(資料共用的 sharedByFields 已處理);使用者資料以租戶為邊界讀。
   * 歸屬組織在可見範圍內的檔案不在這裡補(使用者不在可見範圍時維持舊行為,不列)。
   */
  private async sharedFromElsewhere(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    visibleOrgs: VisibleOrgs,
    candidates: readonly UserRecord[],
  ): Promise<{ records: StaffRecord[]; users: UserRecord[] }> {
    const known = new Set(candidates.map((user) => String(user._id)));
    // 歸屬組織在可見範圍內的在資料庫就排除(看得到全部分店時讀不到任何一筆,不重讀整個租戶的檔案)
    const readable = await this.staff.findMany(operator, {
      tenantId,
      orgId: {
        $nin: [...visibleOrgs.keys()].map((id) => new Types.ObjectId(id)),
      },
    });
    const records = readable.filter(
      (record) => !known.has(String(record.userId)),
    );
    if (records.length === 0) {
      return { records: [], users: [] };
    }
    const users = await this.users.findMany(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      { _id: { $in: records.map((record) => record.userId) } },
    );
    const found = new Set(users.map((user) => String(user._id)));
    return {
      records: records.filter((record) => found.has(String(record.userId))),
      users,
    };
  }

  /**
   * 整個租戶裡已經有排班檔案的使用者(含操作者看不到的組織加入的;只回 userId,不讀檔案內容)。
   * 查詢釘在租戶上(提升範圍的讀取,只問「有沒有」)。
   */
  private async joinedInTenant(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    users: readonly UserRecord[],
  ): Promise<Set<string>> {
    if (users.length === 0) {
      return new Set();
    }
    const records = await this.staff.findMany(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      { tenantId, userId: { $in: users.map((user) => user._id) } },
    );
    return new Set(records.map((record) => String(record.userId)));
  }

  private async rowsOf(
    operator: OperatorContext,
    users: readonly UserRecord[],
    staffByUser: ReadonlyMap<string, StaffRecord>,
    visibleOrgs: VisibleOrgs,
    joinedInTenant: ReadonlySet<string>,
  ): Promise<ScheduleStaffRowModel[]> {
    const records = [...staffByUser.values()];
    const staffIds = records.map((record) => record._id);
    // 一個租戶一人一份:這批檔案都在同一個租戶
    const tenantId = records[0]?.tenantId ?? null;
    const links =
      staffIds.length === 0 || tenantId === null
        ? []
        : await this.relationships.findMany(
            await tenantBoundaryContext(this.orgs, null, tenantId),
            { tenantId, type: ORG_STAFF, secondId: { $in: staffIds } },
          );
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
        // 已被操作者看不到的組織加入:不能再加入,檔案內容不給
        joinedElsewhere:
          record === undefined && joinedInTenant.has(String(user._id)),
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
      throw validationError(
        "duplicated org in orgs",
        ["orgs"],
        SCHEDULE_REASONS.orgRepeated,
      );
    }
    for (const id of ids) {
      if (!visibleOrgs.has(String(id))) {
        throw notFoundError(`org not found: ${String(id)}`);
      }
    }
    const all = await this.relationships.findMany(
      await tenantBoundaryContext(this.orgs, null, tenantOfStaff(record)),
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
        SCHEDULE_REASONS.primaryOrgRequired,
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
      // 存檔後可以排的分店 = 看不到的分店(保留)+ 這次送的
      orgIds: [...hidden.map((link) => link.firstId), ...ids],
    };
  }

  private async applyOrgPlan(
    operator: OperatorContext,
    record: StaffRecord,
    plan: OrgPlan,
  ): Promise<void> {
    // 關聯的 orgId = 分店;看不到的分店的關聯保留不動(只動 plan 裡的),寫入以租戶為邊界、保留操作者
    const context = await tenantBoundaryContext(
      this.orgs,
      operator,
      tenantOfStaff(record),
    );
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
    // 可以排的分店在檔案上的副本(資料共用的 sharedByFields,ADR-0014):與關聯同一個交易
    await this.staff.updateById(operator, record._id, {
      $set: { orgIds: plan.orgIds },
    });
  }
}

/** 排班檔案的租戶(一律屬於某個租戶;根組織沒有排班)。 */
function tenantOfStaff(record: StaffRecord): Types.ObjectId {
  if (record.tenantId === null) {
    throw notFoundError(`schedule staff has no tenant: ${String(record._id)}`);
  }
  return record.tenantId;
}

interface OrgPlan {
  upserts: {
    orgId: Types.ObjectId;
    meta: ScheduleStaffOrgMeta;
    existing: RelationRecord | null;
  }[];
  removals: RelationRecord[];
  /** 存檔後的可以排的分店(檔案上的 `orgIds`)。 */
  orgIds: Types.ObjectId[];
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
    // 歸屬組織不在可見範圍 = 別店建的、因為可以排的分店才看得到(只能看)
    isShared: !visibleOrgs.has(String(record.orgId)),
  };
}
