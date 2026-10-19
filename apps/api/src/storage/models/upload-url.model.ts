import {
  Field,
  GraphQLISODateTime,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

import { UPLOAD_RULES, UploadPurpose, type UploadRule } from "../upload-rules";

registerEnumType(UploadPurpose, {
  name: "UploadPurpose",
  description: "上傳用途:決定物件路徑前綴與所需權限(ADR-0010)",
});

/**
 * 把「依 purpose 而定」的規則寫成一行欄位說明(檔型與大小上限都依用途)。
 * 規則相同的用途併成一組,說明才不會把同一份白名單抄三遍;文字由 `UPLOAD_RULES` 導出,不另寫死。
 */
function describeByPurpose(describe: (rule: UploadRule) => string): string {
  const groups = new Map<string, UploadPurpose[]>();
  for (const purpose of Object.values(UploadPurpose)) {
    const text = describe(UPLOAD_RULES[purpose]);
    groups.set(text, [...(groups.get(text) ?? []), purpose]);
  }
  return [...groups]
    .map(([text, purposes]) => `${purposes.join(" / ")} ${text}`)
    .join(";");
}

@InputType()
export class CreateUploadUrlInput {
  @Field(() => UploadPurpose)
  purpose!: UploadPurpose;

  /** 允許的檔型依 purpose 而定(不合回 `UPLOAD_REJECTED`);白名單正本 `UPLOAD_RULES`。 */
  @Field(() => String, {
    description: `允許的檔型依 purpose:${describeByPurpose((rule) => Object.keys(rule.extensions).join(" / "))}`,
  })
  contentType!: string;

  /** 檔案大小(bytes),上限依 purpose(超過回 `UPLOAD_REJECTED`)。 */
  @Field(() => Int, {
    description: `檔案大小(bytes),上限依 purpose:${describeByPurpose((rule) => String(rule.maxBytes))}`,
  })
  size!: number;
}

/** 上傳票:瀏覽器以 `uploadUrl` 直傳 GCS(PUT,Content-Type 要與申報的一致),再把 `objectPath` 交回 API。 */
@ObjectType()
export class UploadUrlPayload {
  @Field(() => String)
  uploadUrl!: string;

  @Field(() => ID)
  objectPath!: string;

  @Field(() => GraphQLISODateTime)
  expiresAt!: Date;
}
