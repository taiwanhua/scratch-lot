import { Injectable } from "@nestjs/common";

import type { LocalDate } from "@repo/domain/form";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type LotteryDealerSigninDocument,
  LotteryDealerSigninsRepository,
} from "../../database/lottery-dealers/lottery-dealers.repository";
import { quarterOf } from "./dealer-dates";
import { AUDIT_ACTIONS, AUDIT_TARGETS } from "./dealer-keys";
import { toObjectId } from "./dealer-links.service";
import { DealersAccess } from "./dealers-access";
import {
  DEALER_REASONS,
  notFoundError,
  validationError,
} from "./dealers-error";
import { LotteryDealersService } from "./dealers.service";
import type {
  RegisterLotteryDealerSigninInput,
  UpdateLotteryDealerSigninInput,
} from "./dto/lottery-dealer.input";
import {
  type LotteryDealerSigninModel,
  type LotteryDealerSigninsPayload,
  LotterySigninStateEnum,
} from "./models/lottery-dealer.model";

type SigninRecord = Persisted<LotteryDealerSigninDocument>;

const NOTE_LIMIT = 1000;

/** 季別相對今天:已過 / 本季 / 未到。 */
type QuarterTiming = "past" | "current" | "future";

function quarterTiming(
  year: number,
  quarter: number,
  today: LocalDate,
): QuarterTiming {
  const index = year * 4 + quarter;
  const now = today.year * 4 + quarterOf(today);
  if (index < now) {
    return "past";
  }
  return index === now ? "current" : "future";
}

function stateOf(
  signin: SigninRecord | undefined,
  timing: QuarterTiming,
): LotterySigninStateEnum {
  if (signin !== undefined) {
    return LotterySigninStateEnum.SIGNED;
  }
  if (timing === "past") {
    return LotterySigninStateEnum.MISSING;
  }
  return timing === "current"
    ? LotterySigninStateEnum.OPEN
    : LotterySigninStateEnum.NOT_STARTED;
}

function trimNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > NOTE_LIMIT) {
    throw validationError("note is too long", ["note"]);
  }
  return trimmed === "" ? null : trimmed;
}

/**
 * 見簽(專案規格 5.2):`(dealerId, year, quarter)` 唯一、異動寫 audit_log;見簽日不限定落在該季;
 * 已過沒登記的季別警告色、未到的季別停用(不能登記)。看得到經銷商才看得到 / 登記得到它的見簽。
 */
@Injectable()
export class DealerSigninsService {
  constructor(
    private readonly signins: LotteryDealerSigninsRepository,
    private readonly dealers: LotteryDealersService,
    private readonly access: DealersAccess,
    private readonly audit: AuditService,
  ) {}

  /** 某年四季(一定四筆)。 */
  async list(
    operator: OperatorContext,
    dealerId: string,
    year: number,
  ): Promise<LotteryDealerSigninsPayload> {
    const grant = await this.access.assertReadable(operator);
    const dealer = await this.dealers.mustFind(operator, dealerId);
    const rows = await this.signins.findMany(operator, {
      dealerId: dealer._id,
      year,
    });
    const byQuarter = new Map(rows.map((row) => [row.quarter, row]));
    const items = [1, 2, 3, 4].map((quarter) =>
      this.toModel(
        byQuarter.get(quarter),
        year,
        quarter,
        quarterTiming(year, quarter, grant.today),
      ),
    );
    return { items, totalCount: items.length };
  }

  async register(
    operator: OperatorContext,
    input: RegisterLotteryDealerSigninInput,
  ): Promise<LotteryDealerSigninModel> {
    const grant = await this.access.grantOf(operator);
    const dealer = await this.dealers.mustFind(operator, input.dealerId);
    if (
      !Number.isInteger(input.year) ||
      input.year < 2000 ||
      input.year > 9999
    ) {
      throw validationError("year is out of range", ["year"]);
    }
    if (
      !Number.isInteger(input.quarter) ||
      input.quarter < 1 ||
      input.quarter > 4
    ) {
      throw validationError("quarter must be 1-4", ["quarter"]);
    }
    const timing = quarterTiming(input.year, input.quarter, grant.today);
    if (timing === "future") {
      throw validationError(
        "quarter has not started",
        ["quarter"],
        DEALER_REASONS.signinQuarterNotStarted,
      );
    }
    const note = trimNote(input.note);
    const existing = await this.signins.findOne(operator, {
      dealerId: dealer._id,
      year: input.year,
      quarter: input.quarter,
    });
    if (existing !== null) {
      throw validationError(
        "signin already registered",
        ["quarter"],
        DEALER_REASONS.signinDuplicate,
      );
    }
    const created = await this.signins.create(operator, {
      orgId: dealer.orgId,
      dealerId: dealer._id,
      year: input.year,
      quarter: input.quarter,
      signedAt: input.signedAt,
      note,
    });
    await this.audit.record(operator, {
      action: AUDIT_ACTIONS.signinCreate,
      targetType: AUDIT_TARGETS.signin,
      targetId: created._id,
      after: {
        dealerId: String(dealer._id),
        year: input.year,
        quarter: input.quarter,
        signedAt: input.signedAt.toISOString(),
        note,
      },
    });
    return this.toModel(created, input.year, input.quarter, timing);
  }

  async update(
    operator: OperatorContext,
    input: UpdateLotteryDealerSigninInput,
  ): Promise<LotteryDealerSigninModel> {
    const grant = await this.access.grantOf(operator);
    const current = await this.signins.findById(
      operator,
      toObjectId(input.id, "id"),
    );
    if (current === null) {
      throw notFoundError(`signin not found: ${input.id}`);
    }
    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (
      input.signedAt !== undefined &&
      input.signedAt !== null &&
      input.signedAt.getTime() !== current.signedAt.getTime()
    ) {
      set.signedAt = input.signedAt;
      before.signedAt = current.signedAt.toISOString();
      after.signedAt = input.signedAt.toISOString();
    }
    if (input.note !== undefined) {
      const note = trimNote(input.note);
      if (note !== current.note) {
        set.note = note;
        before.note = current.note;
        after.note = note;
      }
    }
    let updated = current;
    if (Object.keys(set).length > 0) {
      updated =
        (await this.signins.updateById(operator, current._id, { $set: set })) ??
        current;
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.signinEdit,
        targetType: AUDIT_TARGETS.signin,
        targetId: current._id,
        before,
        after,
      });
    }
    return this.toModel(
      updated,
      updated.year,
      updated.quarter,
      quarterTiming(updated.year, updated.quarter, grant.today),
    );
  }

  private toModel(
    record: SigninRecord | undefined,
    year: number,
    quarter: number,
    timing: QuarterTiming,
  ): LotteryDealerSigninModel {
    return {
      id: record === undefined ? null : String(record._id),
      year,
      quarter,
      signedAt: record?.signedAt ?? null,
      note: record?.note ?? null,
      state: stateOf(record, timing),
    };
  }
}
