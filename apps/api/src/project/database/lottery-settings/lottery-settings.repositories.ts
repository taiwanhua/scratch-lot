import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotterySetting } from "./lottery-setting.schema";
import { LotteryStoreCountMode } from "./lottery-store-count-mode.schema";

export type LotterySettingDocument = HydratedDocument<LotterySetting>;
export type LotteryStoreCountModeDocument =
  HydratedDocument<LotteryStoreCountMode>;

/** lottery_settings(刮刮樂設定的自訂,張數店規格 5.5)。 */
@Injectable()
export class LotterySettingsRepository extends BaseRepository<
  LotterySetting,
  LotterySettingDocument
> {
  constructor(
    @InjectModel(LotterySetting.name)
    model: RepositoryModel<LotterySetting, LotterySettingDocument>,
  ) {
    super(model);
  }
}

/** lottery_store_count_modes(分店實際盤點制度,張數店規格 5.6)。 */
@Injectable()
export class LotteryStoreCountModesRepository extends BaseRepository<
  LotteryStoreCountMode,
  LotteryStoreCountModeDocument
> {
  constructor(
    @InjectModel(LotteryStoreCountMode.name)
    model: RepositoryModel<
      LotteryStoreCountMode,
      LotteryStoreCountModeDocument
    >,
  ) {
    super(model);
  }
}
