import { Field, ID, InputType, Int, ObjectType } from "@nestjs/graphql";

/** 看板頁換發時帶的看板(`project/realtime-boards.ts` 登記的 key + 那家店)。 */
@InputType()
export class RealtimeBoardInput {
  @Field({ description: "看板 key(專案登記)" })
  key!: string;

  @Field(() => ID, { description: "看板開著的那家店(組織 id)" })
  orgId!: string;
}

/** `realtimeTicket` 的回傳(GQL-02 帶前綴的 payload)。 */
@ObjectType()
export class RealtimeTicketPayload {
  @Field({ description: "訂閱憑證(10 分鐘);連線或在原連線上換發時送出" })
  ticket!: string;

  @Field({ description: "連線網址 `wss://…/connect`,前端加上 `?ticket=`" })
  connectUrl!: string;

  @Field(() => Int, { description: "到期時間(Unix 秒)" })
  expiresAt!: number;

  @Field(() => [String], {
    description:
      "憑證內的頻道:平常只有 `user:<自己>`,看板頁符合條件時多一個 `board:<店>`",
  })
  topics!: string[];
}
