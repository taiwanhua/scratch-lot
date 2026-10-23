import { Field, Int, ObjectType } from "@nestjs/graphql";

/** 側欄一個模組的計數。 */
@ObjectType()
export class SidebarBadge {
  @Field({ description: "模組 key(側欄以它對上模組節點)" })
  moduleKey!: string;

  @Field(() => Int, {
    description: "數字;0 也回傳,前端只在大於 0 時顯示",
  })
  count!: number;

  @Field(() => String, {
    nullable: true,
    description:
      "「數什麼」的說明文字在 admin 訊息檔的 key(登記時給;側欄數字的提示與通知設定頁同一份);沒有 = null",
  })
  descriptionKey!: string | null;
}
