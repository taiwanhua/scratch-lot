import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from "@nestjs/graphql";

/** 一條設定的一份值(生效值或上層值)。 */
@ObjectType("LotterySettingValue")
export class LotterySettingValueModel {
  /** 選項(例 `numbered` / `count`;各設定的選項見模組文件) */
  @Field(() => String)
  option!: string;

  /** `own` 本層自訂 / `inherited` 沿用上層 / `default` 程式預設 */
  @Field(() => String)
  source!: string;

  /** 生效值所在的組織名稱;程式預設、或那個組織操作者看不到時為 null(畫面寫「沿用上層設定」) */
  @Field(() => String, { nullable: true })
  sourceOrgName!: string | null;
}

/** 設定頁的一列(依定義清單的順序)。 */
@ObjectType("LotterySetting")
export class LotterySettingModel {
  @Field(() => ID)
  key!: string;

  /** 可選的值,依畫面上的順序 */
  @Field(() => [String])
  options!: string[];

  @Field(() => LotterySettingValueModel)
  effective!: LotterySettingValueModel;

  /** 本層自訂時,上層的生效值(「上層:編號盤點」);沒有自訂為 null */
  @Field(() => LotterySettingValueModel, { nullable: true })
  parent!: LotterySettingValueModel | null;
}

/** 分店實際的盤點制度(只有分店才有)。 */
@ObjectType("LotteryStoreCountMode")
export class LotteryStoreCountModeModel {
  /** `numbered` / `count` / `converting` */
  @Field(() => String)
  mode!: string;

  /** 進入現在制度的時間;從沒改過為 null */
  @Field(() => GraphQLISODateTime, { nullable: true })
  since!: Date | null;

  /** 上次補點編號核准的時間 */
  @Field(() => GraphQLISODateTime, { nullable: true })
  lastRenumberAt!: Date | null;

  /** 操作者能不能按 [取消轉換](轉換中 + 有改這家店的權限) */
  @Field(() => Boolean)
  canCancelConversion!: boolean;
}

/** 刮刮樂設定頁:某個組織的整份設定。 */
@ObjectType("LotterySettingsPayload")
export class LotterySettingsPayload {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 這個組織是最上層組織(它的設定是各分店沿用的預設值) */
  @Field(() => Boolean)
  isTenantTop!: boolean;

  /** 這個組織是分店(沒有下層組織):有實際盤點制度、[變更紀錄]、[取消轉換] */
  @Field(() => Boolean)
  isStore!: boolean;

  /** 操作者能不能改這個組織的設定(最上層組織看 `edit-default`、其他看 `edit-org`) */
  @Field(() => Boolean)
  canEdit!: boolean;

  @Field(() => [LotterySettingModel])
  items!: LotterySettingModel[];

  /** 分店實際的盤點制度;不是分店為 null */
  @Field(() => LotteryStoreCountModeModel, { nullable: true })
  storeCountMode!: LotteryStoreCountModeModel | null;
}

/** 自訂 / 還原 / 取消轉換後回傳整份設定。 */
@ObjectType("LotterySettingMutationPayload")
export class LotterySettingMutationPayload {
  @Field(() => LotterySettingsPayload)
  settings!: LotterySettingsPayload;
}

/** 會跟著改盤點制度的一家分店。 */
@ObjectType("LotteryCountModeChangeStore")
export class LotteryCountModeChangeStoreModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 實際制度:從 */
  @Field(() => String)
  from!: string;

  /** 實際制度:到(改編號且還有未對號 → `converting`) */
  @Field(() => String)
  to!: string;

  /** 擋下的原因:`pending_skip` 檯面上有待標註的本 / `busy` 有進行中的盤點、重刷或補點 */
  @Field(() => [String])
  problems!: string[];
}

/** 檯面上還有待標註的一本。 */
@ObjectType("LotteryCountModePendingSkipBook")
export class LotteryCountModePendingSkipBookModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => String)
  cashPointName!: string;

  @Field(() => String)
  gameCode!: string;

  @Field(() => String)
  gameName!: string;

  /** 顯示用本號 */
  @Field(() => String)
  bookNo!: string;

  /** 待標註幾張 */
  @Field(() => Int)
  pendingCount!: number;
}

/** 有進行中工作的一家分店。 */
@ObjectType("LotteryCountModeBusyStore")
export class LotteryCountModeBusyStoreModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  /** 有登記盤點中(1 小時內有操作) */
  @Field(() => Boolean)
  stocktake!: boolean;

  /** 有全店重刷還沒結束 */
  @Field(() => Boolean)
  rescan!: boolean;

  /** 有補點編號還沒結束 */
  @Field(() => Boolean)
  renumber!: boolean;
}

/** 改盤點制度前的檢查:會跟著改的分店、擋下的明細、能不能存。 */
@ObjectType("LotteryCountModeChangeCheck")
export class LotteryCountModeChangeCheckModel {
  @Field(() => [LotteryCountModeChangeStoreModel])
  stores!: LotteryCountModeChangeStoreModel[];

  @Field(() => [LotteryCountModePendingSkipBookModel])
  pendingSkipBooks!: LotteryCountModePendingSkipBookModel[];

  @Field(() => [LotteryCountModeBusyStoreModel])
  busyStores!: LotteryCountModeBusyStoreModel[];

  @Field(() => Boolean)
  canSave!: boolean;
}

/** 盤點制度歷程的一筆。 */
@ObjectType("LotteryStoreCountModeHistoryEntry")
export class LotteryStoreCountModeHistoryEntryModel {
  /** 從哪種(第一次設定前沒有筆 = null,畫面當編號) */
  @Field(() => String, { nullable: true })
  from!: string | null;

  @Field(() => String)
  to!: string;

  /** 生效時間 */
  @Field(() => GraphQLISODateTime)
  at!: Date;

  /** 誰;系統寫入或看不到為 null */
  @Field(() => String, { nullable: true })
  byName!: string | null;

  /** `setting` 改設定 / `renumber_approved` 補點編號核准 / `convert_cancelled` 取消轉換 */
  @Field(() => String)
  cause!: string;

  /** 補點編號的盤點單 id(`renumber_approved`) */
  @Field(() => ID, { nullable: true })
  stocktakeId!: string | null;
}

/** [變更紀錄]:某家分店的盤點制度歷程(新到舊)。 */
@ObjectType("LotteryStoreCountModeHistory")
export class LotteryStoreCountModeHistoryModel {
  @Field(() => ID)
  orgId!: string;

  @Field(() => String)
  orgName!: string;

  @Field(() => [LotteryStoreCountModeHistoryEntryModel])
  items!: LotteryStoreCountModeHistoryEntryModel[];
}
