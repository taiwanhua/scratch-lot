import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";

/**
 * 列表欄位的種類:摘要槽(`title` / `date` / `amount` / `serialNo`)、表單欄位,
 * 或組合欄(模板把幾個槽 / 欄位組成一格,例 `{{value.start_at}}–{{value.end_at}}`)。
 */
export enum ModuleListColumnKind {
  SLOT = "slot",
  FIELD = "field",
  TEMPLATE = "template",
}

registerEnumType(ModuleListColumnKind, {
  name: "ModuleListColumnKind",
  description: "列表欄位的種類:摘要槽 / 表單欄位 / 組合欄",
});

/** 欄寬上下限(px)。 */
export const MIN_COLUMN_WIDTH = 40;
export const MAX_COLUMN_WIDTH = 2000;

@ObjectType()
export class ModuleListColumn {
  @Field(() => ModuleListColumnKind)
  kind!: ModuleListColumnKind;

  /** 摘要槽 key、欄位 key,或組合欄的模板(`{{title}}` 等槽與 `{{value.<欄位key>}}`)。 */
  @Field(() => String)
  key!: string;

  /**
   * 表單欄位與組合欄:限定哪張表單;null = 模組內任一張(表單欄位 = 有這個欄位的表單,
   * 組合欄 = 每一筆依它綁的版本取值)。
   */
  @Field(() => ID, { nullable: true })
  formKey!: string | null;

  /** 只有組合欄:表頭的欄名(root 輸入的顯示名稱,同表單欄位的 label 不經字典翻譯);其他種類為 null。 */
  @Field(() => String, { nullable: true })
  label!: string | null;

  /** 欄寬(px)。 */
  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  order!: number;
}

/** 內建欄(表單 / 狀態 / 建立者)各自顯不顯示;沒設定過全為 true。 */
@ObjectType()
export class ModuleListBuiltinColumns {
  @Field(() => Boolean)
  form!: boolean;

  @Field(() => Boolean)
  status!: boolean;

  @Field(() => Boolean)
  createdBy!: boolean;
}

/** 列表欄位配置(`modules.settings.list`)。 */
@ObjectType()
export class ModuleListColumnsPayload {
  @Field(() => String)
  moduleKey!: string;

  /** 依 `order` 排好;沒設定過為空陣列(前端用預設欄)。 */
  @Field(() => [ModuleListColumn])
  columns!: ModuleListColumn[];

  /** 內建欄的顯示開關(`settings.list.builtin`,沒存過 = 全開)。 */
  @Field(() => ModuleListBuiltinColumns)
  builtin!: ModuleListBuiltinColumns;
}

@InputType()
export class ModuleListColumnInput {
  @Field(() => ModuleListColumnKind)
  kind!: ModuleListColumnKind;

  /** 摘要槽 key、欄位 key,或組合欄的模板。 */
  @Field(() => String)
  key!: string;

  /** 只有表單欄位與組合欄用;缺席 / null = 不限定表單。 */
  @Field(() => ID, { nullable: true })
  formKey?: string | null;

  /** 只有組合欄用(必填,1–50 字);其他種類忽略。 */
  @Field(() => String, { nullable: true })
  label?: string | null;

  @Field(() => Int)
  width!: number;

  @Field(() => Int)
  order!: number;
}

@InputType()
export class ModuleListBuiltinColumnsInput {
  @Field(() => Boolean)
  form!: boolean;

  @Field(() => Boolean)
  status!: boolean;

  @Field(() => Boolean)
  createdBy!: boolean;
}

/** 整份覆蓋某表單模組的列表欄位配置(root)。 */
@InputType()
export class SetModuleListColumnsInput {
  @Field(() => String)
  moduleKey!: string;

  /** 空陣列 = 清掉配置(回到前端預設欄)。 */
  @Field(() => [ModuleListColumnInput])
  columns!: ModuleListColumnInput[];

  /** 內建欄開關;缺席 / null = 保留目前存的(沒存過 = 全開)。 */
  @Field(() => ModuleListBuiltinColumnsInput, { nullable: true })
  builtin?: ModuleListBuiltinColumnsInput | null;
}
