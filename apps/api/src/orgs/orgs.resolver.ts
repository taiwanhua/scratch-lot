import {
  Args,
  ID,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from "@nestjs/graphql";

import { authError } from "../auth/auth-error";
import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import { RequirePermission } from "../permission/require-permission.decorator";
import { StorageService } from "../storage/storage.service";
import { CreateChildOrgInput } from "./dto/create-child-org.input";
import { DeleteOrgInput } from "./dto/delete-org.input";
import { MoveOrgInput } from "./dto/move-org.input";
import { SetOrgEnabledInput } from "./dto/set-org-enabled.input";
import { SetOrgManagersInput } from "./dto/set-org-managers.input";
import { SetOrgTimezoneInput } from "./dto/set-org-timezone.input";
import { SetOrgVisibilityInput } from "./dto/set-org-visibility.input";
import { UpdateOrgInput } from "./dto/update-org.input";
import { DeletePayload, OrgPayload } from "./models/org-payloads.model";
import { Org, OrgNode, TenantOrgNode } from "./models/org.model";
import { UserSummary } from "./models/user-summary.model";
import { OrgManagersService } from "./org-managers.service";
import { OrgsService } from "./orgs.service";

/** 權限 key(docs/modules/org-manager.md 權限表;種子 apps/db-migrator/seeds/base/modules/system.ts)。 */
const PERMISSIONS = {
  view: "system.org-manager.view",
  createChild: "system.org-manager.create-child",
  edit: "system.org-manager.edit",
  toggleEnabled: "system.org-manager.toggle-enabled",
  move: "system.org-manager.move",
  delete: "system.org-manager.delete",
  // 2026-09-19 從根組織專屬的 tenant-ops 搬到這一層(ADR-0005):
  // 可見範圍開關是**租戶自己的資料政策**,租戶管理員模板拿到 `system.org-manager.*` 就會含它;
  // 能設哪些租戶頂層則由管理範圍決定(service 層),不是靠「站在根組織」。
  setVisibility: "system.org-manager.set-visibility",
  // 租戶時區同屬租戶自己的設定,範圍規則與可見範圍開關相同
  setTimezone: "system.org-manager.set-timezone",
} as const;

/**
 * 「讀組織樹 / 單筆組織」的多選一權限:
 * 組織樹不只組織管理頁在用 — 使用者管理頁的左樹與「選擇所屬組織」彈窗也要它,
 * 而那些人未必持有組織管理的檢視權。管理範圍(ADR-0005)照樣把關看得到誰,
 * 這裡只決定「進不進得了這個端點」。
 * `@RequirePermission` 是單一 key 的守門,多選一自己查有效權限集合
 * (判斷語意同 PermissionGuard:含同層 wildcard,ADR-0004;寫法同 `storage.resolver.ts`)。
 */
const READ_ORG_PERMISSIONS = [
  PERMISSIONS.view,
  "system.user-manager.view",
] as const;

/**
 * 組織管理的 GraphQL 端點(形式 GQL-02、錯誤 GQL-04):resolver 薄,規則全在 OrgsService。
 * 寫入類端點以 `@RequirePermission` 守門(ADR-0011「API 防守」:重用頁面權限 key);
 * 讀取類的兩個端點是多選一,見 `READ_ORG_PERMISSIONS`。
 */
@Resolver(() => Org)
export class OrgsResolver {
  constructor(
    private readonly orgs: OrgsService,
    private readonly orgManagers: OrgManagersService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionResolver,
  ) {}

  /** **管理範圍**的組織樹(CONTEXT.md);根可能有多個,範圍外的組織不回傳。 */
  @Query(() => [OrgNode])
  async orgTree(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgNode[]> {
    await this.requireReadPermission(operator);
    return this.orgs.tree(operator);
  }

  /**
   * **整棵租戶樹**(組織選擇器的 `visible` / `tenant` 模式):每個節點帶可見 / 可管理旗標;
   * 只要登入,不要求治理權限;範圍與釘租戶的規則見 `OrgsService.tenantTree`。
   */
  @Query(() => [TenantOrgNode])
  tenantOrgTree(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<TenantOrgNode[]> {
    return this.orgs.tenantTree(operator);
  }

  @Query(() => Org)
  async org(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<Org> {
    await this.requireReadPermission(operator);
    return this.orgs.one(operator, id);
  }

  /**
   * 商標的短效簽名讀取網址(ADR-0010:DB 存路徑不存 URL,看時現簽);
   * 只在客戶端有問 `logoUrl` 時才簽 — 簽名在 Cloud Run 上是一次 IAM signBlob 呼叫。
   * 可取範圍由 `org` / `orgTree` 的管理範圍把關(呼叫端拿得到這筆資料才問得到網址)。
   */
  @ResolveField(() => String, { nullable: true })
  logoUrl(@Parent() org: Org): Promise<string | null> {
    return this.storage.readUrlOf(org.logoPath);
  }

  /**
   * 組織的主管(`org_manager`):讀得到這筆組織(`org` / `setOrgManagers` 已把關範圍)
   * 就讀得到它的主管名單;名單含停用的主管(解析時不算,但管理者要看得到才移得掉)。
   */
  @ResolveField(() => [UserSummary])
  managers(@Parent() org: Org): Promise<UserSummary[]> {
    return this.orgManagers.managersOf(org.id);
  }

  /** 主管候選人:該組織所屬租戶裡啟用中的使用者(編輯組織的「主管」欄用)。 */
  @RequirePermission(PERMISSIONS.edit)
  @Query(() => [UserSummary])
  orgManagerCandidates(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("keyword", { type: () => String, nullable: true })
    keyword: string | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<UserSummary[]> {
    return this.orgManagers.candidates(operator, orgId, keyword);
  }

  /** 設定組織的主管(整組取代;稽核 `org.set-managers`)。沿用編輯權限(主管是組織資料的一部分)。 */
  @RequirePermission(PERMISSIONS.edit)
  @Mutation(() => OrgPayload)
  async setOrgManagers(
    @Args("input") input: SetOrgManagersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgManagers.setManagers(operator, input) };
  }

  @RequirePermission(PERMISSIONS.createChild)
  @Mutation(() => OrgPayload)
  async createChildOrg(
    @Args("input") input: CreateChildOrgInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.createChild(operator, input) };
  }

  @RequirePermission(PERMISSIONS.edit)
  @Mutation(() => OrgPayload)
  async updateOrg(
    @Args("input") input: UpdateOrgInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.update(operator, input) };
  }

  @RequirePermission(PERMISSIONS.toggleEnabled)
  @Mutation(() => OrgPayload)
  async setOrgEnabled(
    @Args("input") input: SetOrgEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.setEnabled(operator, input) };
  }

  @RequirePermission(PERMISSIONS.move)
  @Mutation(() => OrgPayload)
  async moveOrg(
    @Args("input") input: MoveOrgInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.move(operator, input) };
  }

  /** 可見範圍開關(ADR-0005):只掛租戶頂層;能設哪些由管理範圍決定,見 OrgsService。 */
  @RequirePermission(PERMISSIONS.setVisibility)
  @Mutation(() => OrgPayload)
  async setOrgVisibility(
    @Args("input") input: SetOrgVisibilityInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.setVisibility(operator, input) };
  }

  /** 租戶時區:只掛租戶頂層;`timezone = null` 退回預設時區。範圍同可見範圍開關,見 OrgsService。 */
  @RequirePermission(PERMISSIONS.setTimezone)
  @Mutation(() => OrgPayload)
  async setOrgTimezone(
    @Args("input") input: SetOrgTimezoneInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgPayload> {
    return { org: await this.orgs.setTimezone(operator, input) };
  }

  @RequirePermission(PERMISSIONS.delete)
  @Mutation(() => DeletePayload)
  deleteOrg(
    @Args("input") input: DeleteOrgInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeletePayload> {
    return this.orgs.remove(operator, input);
  }

  /** `READ_ORG_PERMISSIONS` 任一即可;都沒有 → `FORBIDDEN`(語意同 PermissionGuard)。 */
  private async requireReadPermission(
    operator: OperatorContext,
  ): Promise<void> {
    if (!operator.actorId) {
      // 防呆:全域 guard 已擋掉未登入,這裡只是讓型別與 PermissionGuard 一致
      throw authError("UNAUTHENTICATED", "Reading orgs requires a login");
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    if (!READ_ORG_PERMISSIONS.some((key) => holdsPermission(resolution, key))) {
      throw authError(
        "FORBIDDEN",
        `Missing permission to read orgs(${READ_ORG_PERMISSIONS.join(" / ")})`,
      );
    }
  }
}
