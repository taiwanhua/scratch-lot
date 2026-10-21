import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

import { ModuleSidebarType } from "../../permission/models/me-module.model";
import { Org } from "./org.model";

/**
 * 開通租戶時可勾選的一個模組(`tenantModuleOptions`)。
 *
 * 清單 = **租戶管理員模板實際綁的模組**(`role_module`)。ADR-0004 的 `isRootOnly` 只存在於
 * seed 宣告層、不落庫,所以執行期的判準就是「模板有沒有綁」— 種子已在綁定時扣除根組織專屬模組
 * (`apps/db-migrator/seeds/base/role-bindings.ts`),不必、也無法在執行期重算一次。
 */
@ObjectType()
export class ModuleOption {
  @Field(() => ID)
  id!: string;

  /** 模組 key(累加父 key,ADR-0004);勾選以 key 回送。 */
  @Field(() => String)
  key!: string;

  @Field(() => String)
  name!: string;

  /**
   * 上層模組 id;**上層不在選項內時為 null**(該節點在勾選樹上自成一棵根)。
   * 前端據此組樹,連動規則同角色管理的權限矩陣(勾下層連動上層)。
   */
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => ModuleSidebarType)
  sidebarType!: ModuleSidebarType;

  /** 同層排序(與側欄同一個值)。 */
  @Field(() => Int)
  order!: number;
}

/**
 * 開通完成後回給前端的東西:新租戶(樹上要插一節)、首任管理員、以及這個租戶實際拿到的模組。
 * 啟用信已寄出,密碼由對方自行設定 — API 不回任何密碼 / token(ADR-0009)。
 */
@ObjectType()
export class ProvisionTenantPayload {
  /** 新建的租戶頂層組織。 */
  @Field(() => Org)
  org!: Org;

  /** 首任租戶管理員(= `org.ownerUserId`)。 */
  @Field(() => ID)
  ownerUserId!: string;

  /** 複製給這個租戶的「租戶管理員」角色副本(`settings.templateKey = "tenant-admin"`)。 */
  @Field(() => ID)
  roleId!: string;

  /** 副本實際綁到的模組 key(含為了讓樹不斷而補上的上層模組)。 */
  @Field(() => [String])
  moduleKeys!: string[];

  /**
   * 啟用信有沒有寄出(交易提交後才寄,ADR-0013)。false = 開通已成立但信寄不出去:
   * 請首任管理員以「忘記密碼」自助設定密碼。
   */
  @Field(() => Boolean)
  activationMailSent!: boolean;
}

/**
 * 開通的寫入目標(`provisionTarget`,根組織專屬):這個 api 連到的資料庫名。
 * demo 指令以它比對確認字串的資料庫名段,確認字串因此綁到實際寫入的資料庫,不靠操作者另給的連線字串。
 * 只有資料庫名,不含連線字串、主機或帳密。
 */
@ObjectType()
export class ProvisionTarget {
  @Field(() => String)
  databaseName!: string;
}

/**
 * 撤銷開通的回傳:三樣都已硬刪除,樹上不再有這一節,前端只需要知道「哪一個沒了」。
 *
 * 型別名帶模組前綴(GQL-02):`DeletePayload` 是 orgs 早期留下的通用名、屬先例不是標準,
 * 新端點不再沿用。
 */
@ObjectType()
export class RevokeTenantProvisionPayload {
  @Field(() => Boolean)
  success!: boolean;

  /** 被撤銷的租戶頂層組織 id(已硬刪除)。 */
  @Field(() => ID)
  revokedOrgId!: string;

  /** 一併抹掉的擁有者使用者 id;組織沒有擁有者時為 null。 */
  @Field(() => ID, { nullable: true })
  revokedOwnerUserId!: string | null;

  /** 一併抹掉的租戶管理員角色副本 id;找不到副本時為 null。 */
  @Field(() => ID, { nullable: true })
  revokedRoleId!: string | null;
}

/** 清空示範機構時一張 collection 刪掉的筆數(只列有刪到的)。 */
@ObjectType()
export class PurgedCollection {
  @Field(() => String)
  collection!: string;

  @Field(() => Int)
  deleted!: number;
}

/**
 * 清空示範機構的回傳(`purgeDemoTenant`,根組織專屬;demo 指令 `purge` / `rebuild` 印出)。
 * 找不到這個短碼的租戶 → `purged: false`、其餘為 0;沒有「示範」標記的租戶直接 `FORBIDDEN`,不會走到回傳。
 */
@ObjectType()
export class PurgeDemoTenantPayload {
  @Field(() => Boolean)
  purged!: boolean;

  /** 被清空的租戶頂層 id(已硬刪除);沒有清空時為 null。 */
  @Field(() => ID, { nullable: true })
  orgId!: string | null;

  /** 刪掉的文件總數(含組織、使用者、角色、關聯)。 */
  @Field(() => Int)
  deletedDocuments!: number;

  /** 只屬於這個租戶、被硬刪的使用者數。 */
  @Field(() => Int)
  deletedUsers!: number;

  /** 也屬於其他組織、只移除了在這個租戶的所屬與角色的使用者數。 */
  @Field(() => Int)
  detachedUsers!: number;

  /** 資料裡引用、交易提交後刪掉的檔案數(個別刪除失敗只記 log)。 */
  @Field(() => Int)
  deletedFiles!: number;

  @Field(() => [PurgedCollection])
  collections!: PurgedCollection[];
}
