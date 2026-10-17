import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { FormUserRef } from "../../forms/models/form-common.model";

/** 代理的狀態(依 api 當下時間算;已結束的唯讀)。 */
export enum UserDelegationStatusEnum {
  UPCOMING = "UPCOMING",
  ACTIVE = "ACTIVE",
  ENDED = "ENDED",
}

registerEnumType(UserDelegationStatusEnum, {
  name: "UserDelegationStatus",
  description: "代理狀態:未開始 / 代理中 / 已結束(已結束的唯讀)",
});

/** 我設定的一筆代理(《底座規格》3.7 B15)。 */
@ObjectType()
export class UserDelegationModel {
  @Field(() => ID)
  id!: string;

  /** 代理人(使用者已被刪除時 `name` 為 null)。 */
  @Field(() => FormUserRef)
  delegate!: FormUserRef;

  /** 代理開始(含;選的那一天在租戶時區 00:00)。 */
  @Field(() => GraphQLISODateTime)
  startAt!: Date;

  /** 代理結束(不含;選的結束日在租戶時區 24:00 = 隔天 00:00)。 */
  @Field(() => GraphQLISODateTime)
  endAt!: Date;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => UserDelegationStatusEnum)
  status!: UserDelegationStatusEnum;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;
}

/** 我的代理清單(GQL-03;依開始時間新到舊)。 */
@ObjectType()
export class MyDelegationsPayload {
  @Field(() => [UserDelegationModel])
  items!: UserDelegationModel[];

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;

  @Field(() => Int)
  totalCount!: number;
}

/** 可選的代理人:本租戶、啟用中、不是自己。 */
@ObjectType()
export class UserDelegateCandidateModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  account!: string;
}

@ObjectType()
export class MyDelegateCandidatesPayload {
  @Field(() => [UserDelegateCandidateModel])
  items!: UserDelegateCandidateModel[];

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;

  @Field(() => Int)
  totalCount!: number;
}

/** 新增 / 修改後的那一筆。 */
@ObjectType()
export class MyDelegationPayload {
  @Field(() => UserDelegationModel)
  delegation!: UserDelegationModel;
}

@ObjectType()
export class DeleteMyDelegationPayload {
  @Field(() => ID)
  id!: string;
}
