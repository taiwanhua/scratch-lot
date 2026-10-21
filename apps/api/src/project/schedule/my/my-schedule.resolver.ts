import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../../../auth/decorators";
import type { GraphqlContext } from "../../../auth/request-context";
import type { OperatorContext } from "../../../database/operator-context";
import { RequirePermission } from "../../../permission/require-permission.decorator";
import { MyScheduleInput, PunchMyScheduleInput } from "./dto/my-schedule.input";
import {
  MySchedulePayload,
  MySchedulePunchModel,
} from "./models/my-schedule.model";
import {
  MyScheduleService,
  type PunchRequestMeta,
} from "./my-schedule.service";

/** 打卡記下的請求資訊:來源 IP(Express `req.ip`)與 User-Agent。 */
export function punchMetaOf(context: GraphqlContext): PunchRequestMeta {
  const userAgent = context.req.headers["user-agent"];
  return {
    ip: context.req.ip ?? null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  };
}

/** 我的班表 → 班表分頁(`schedule.my.view`)與打卡(`schedule.my.punch`)。 */
@Resolver(() => MySchedulePayload)
export class MyScheduleResolver {
  constructor(private readonly service: MyScheduleService) {}

  @RequirePermission("schedule.my.view")
  @Query(() => MySchedulePayload, { name: "mySchedule" })
  mySchedule(
    @Args("input", { type: () => MyScheduleInput, nullable: true })
    input: MyScheduleInput | null,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MySchedulePayload> {
    return this.service.mySchedule(operator, input?.month);
  }

  @RequirePermission("schedule.my.punch")
  @Mutation(() => MySchedulePunchModel)
  punchMySchedule(
    @Args("input") input: PunchMyScheduleInput,
    @CurrentOperator() operator: OperatorContext,
    @Context() context: GraphqlContext,
  ): Promise<MySchedulePunchModel> {
    return this.service.punch(operator, input, punchMetaOf(context));
  }
}
