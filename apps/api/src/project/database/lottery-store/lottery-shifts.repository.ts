import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryShiftPersonLock } from "./lottery-shift-person-lock.schema";
import { LotteryShift } from "./lottery-shift.schema";
import { LotteryVaultLock } from "./lottery-vault-lock.schema";

export type LotteryShiftDocument = HydratedDocument<LotteryShift>;
export type LotteryVaultLockDocument = HydratedDocument<LotteryVaultLock>;
export type LotteryShiftPersonLockDocument =
  HydratedDocument<LotteryShiftPersonLock>;

/** lottery_shifts(收銀班次,專案規格 6.6)。 */
@Injectable()
export class LotteryShiftsRepository extends BaseRepository<
  LotteryShift,
  LotteryShiftDocument
> {
  constructor(
    @InjectModel(LotteryShift.name)
    model: RepositoryModel<LotteryShift, LotteryShiftDocument>,
  ) {
    super(model);
  }
}

/** lottery_shift_person_locks(開班的「人」守門文件)。 */
@Injectable()
export class LotteryShiftPersonLocksRepository extends BaseRepository<
  LotteryShiftPersonLock,
  LotteryShiftPersonLockDocument
> {
  constructor(
    @InjectModel(LotteryShiftPersonLock.name)
    model: RepositoryModel<
      LotteryShiftPersonLock,
      LotteryShiftPersonLockDocument
    >,
  ) {
    super(model);
  }
}

/** lottery_vault_locks(小金庫的守門文件)。 */
@Injectable()
export class LotteryVaultLocksRepository extends BaseRepository<
  LotteryVaultLock,
  LotteryVaultLockDocument
> {
  constructor(
    @InjectModel(LotteryVaultLock.name)
    model: RepositoryModel<LotteryVaultLock, LotteryVaultLockDocument>,
  ) {
    super(model);
  }
}
