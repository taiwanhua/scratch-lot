import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import {
  DeleteScheduleDemandInput,
  DeleteScheduleEntryInput,
  RemoveScheduleDayEntriesInput,
  SaveScheduleDemandInput,
  SaveScheduleEntryInput,
  ScheduleRosterInput,
} from "./dto/schedule-roster.input";
import {
  DeleteScheduleDemandPayload,
  DeleteScheduleEntryPayload,
  RemoveScheduleDayEntriesPayload,
  SaveScheduleDemandPayload,
  SaveScheduleEntryPayload,
  ScheduleRosterPayload,
} from "./models/schedule-roster.model";
import { ScheduleRosterWritesService } from "./schedule-roster-writes.service";
import {
  ROSTER_PERMISSIONS,
  ScheduleRosterService,
} from "./schedule-roster.service";

/** 排班作業 → 排班表(`schedule.manage`;讀要 `view`、寫要 `edit`)。 */
@Resolver(() => ScheduleRosterPayload)
export class ScheduleRosterResolver {
  constructor(
    private readonly service: ScheduleRosterService,
    private readonly writes: ScheduleRosterWritesService,
  ) {}

  @RequirePermission(ROSTER_PERMISSIONS.view)
  @Query(() => ScheduleRosterPayload, { name: "scheduleRoster" })
  scheduleRoster(
    @Args("input") input: ScheduleRosterInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ScheduleRosterPayload> {
    return this.service.roster(operator, input.orgId, input.month, {
      from: input.from,
      to: input.to,
    });
  }

  @RequirePermission(ROSTER_PERMISSIONS.edit)
  @Mutation(() => SaveScheduleDemandPayload)
  saveScheduleDemand(
    @Args("input") input: SaveScheduleDemandInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SaveScheduleDemandPayload> {
    return this.writes.saveDemand(operator, input);
  }

  @RequirePermission(ROSTER_PERMISSIONS.edit)
  @Mutation(() => DeleteScheduleDemandPayload)
  deleteScheduleDemand(
    @Args("input") input: DeleteScheduleDemandInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleDemandPayload> {
    return this.writes.deleteDemand(operator, input);
  }

  @RequirePermission(ROSTER_PERMISSIONS.edit)
  @Mutation(() => SaveScheduleEntryPayload)
  async saveScheduleEntry(
    @Args("input") input: SaveScheduleEntryInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<SaveScheduleEntryPayload> {
    return { item: await this.writes.saveEntry(operator, input) };
  }

  @RequirePermission(ROSTER_PERMISSIONS.edit)
  @Mutation(() => DeleteScheduleEntryPayload)
  async deleteScheduleEntry(
    @Args("input") input: DeleteScheduleEntryInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DeleteScheduleEntryPayload> {
    return { id: await this.writes.deleteEntry(operator, input) };
  }

  @RequirePermission(ROSTER_PERMISSIONS.edit)
  @Mutation(() => RemoveScheduleDayEntriesPayload)
  removeScheduleDayEntries(
    @Args("input") input: RemoveScheduleDayEntriesInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<RemoveScheduleDayEntriesPayload> {
    return this.writes.removeDayEntries(operator, input);
  }
}
