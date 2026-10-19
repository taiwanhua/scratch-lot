import { Field, ID, ObjectType, registerEnumType } from "@nestjs/graphql";

/**
 * 租戶頂層的「使用者可見下層組織資料」開關(`orgs.settings.visibility`,ADR-0005)。
 * 未設視為 `OWN`;設定動作屬租戶作業,本模組只讀出來顯示。
 */
export enum OrgVisibility {
  /** 使用者只看得到自己所屬組織的資料 */
  OWN = "OWN",
  /** 使用者看得到所屬組織與其整棵下層的資料 */
  SUBTREE = "SUBTREE",
}

registerEnumType(OrgVisibility, {
  name: "OrgVisibility",
  description: "租戶頂層的使用者可見範圍開關(ADR-0005;未設視為 OWN)",
});

/** 組織樹的一個節點(`orgTree`);資料區要的細節走 `org(id)`,樹只帶畫得出樹的欄位。 */
@ObjectType()
export class OrgNode {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  /** 上層組織;本樹的根(根組織視角 = 根組織、租戶視角 = 租戶頂層)為 null。 */
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  /** 組織自己的停用狀態(停用連動整棵子樹)。 */
  @Field(() => Boolean)
  enabled!: boolean;

  /**
   * 租戶擁有者(僅租戶頂層有值,ADR-0009);其餘節點恆為 null。
   * 樹上就給,讓使用者管理頁不必再逐筆查 `org(id)` 才知道哪些人受擁有者保護。
   */
  @Field(() => ID, { nullable: true })
  ownerUserId!: string | null;

  /**
   * 這個節點在操作者的可見範圍(ADR-0005)之外 — 樹上照樣顯示(不然樹會斷),
   * 但不可選取、不可操作(docs/modules/org-manager.md「組織樹」)。
   * 與 `enabled`(組織自己的停用狀態)是兩件事;命名與使用者列的 `outOfScope` 一致。
   */
  @Field(() => Boolean)
  outOfScope!: boolean;

  @Field(() => [OrgNode])
  children!: OrgNode[];
}

/** 單一組織的資料(右側資料區):名稱、描述、商標、狀態、擁有者。 */
@ObjectType()
export class Org {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => Boolean)
  enabled!: boolean;

  /** 系統組織(根組織):不可搬移、不可刪除。 */
  @Field(() => Boolean)
  isSystem!: boolean;

  /** 租戶擁有者(僅租戶頂層有值,ADR-0009);轉移屬租戶作業。 */
  @Field(() => ID, { nullable: true })
  ownerUserId!: string | null;

  /** 租戶短碼(`orgs.slug`);只有租戶頂層有值,其餘恆為 null。 */
  @Field(() => String, { nullable: true })
  slug!: string | null;

  /** 示範機構(`orgs.isDemo`;只有示範指令開通的租戶頂層為 true,開通後不可改)。 */
  @Field(() => Boolean)
  isDemo!: boolean;

  /** 租戶頂層的可見範圍開關(ADR-0005);非租戶頂層恆為 null。 */
  @Field(() => OrgVisibility, { nullable: true })
  visibility!: OrgVisibility | null;

  /**
   * 時區(`orgs.settings.timezone`,IANA 名稱);只有根組織與租戶頂層有值。
   * 沒設(或存的值不合法)回 null,代表使用預設時區 —— 實際生效的時區看 `me.currentOrg.timezone`。
   */
  @Field(() => String, { nullable: true })
  timezone!: string | null;

  /**
   * 商標的 GCS 物件路徑(`orgs.logoPath`)。**不進 schema**:對外只給簽名網址,
   * 由 `orgs.resolver.ts` 的 `logoUrl` field resolver 現簽(ADR-0010,寫法同 `me.currentOrg.logoUrl`)。
   */
  logoPath?: string;
}
