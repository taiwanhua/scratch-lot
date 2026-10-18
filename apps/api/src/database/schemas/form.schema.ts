import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, Types } from "mongoose";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/** collection 名(退役權限清理的跨租戶計數等處共用)。 */
export const FORMS_COLLECTION = "forms";

/** 客製表單的來源(以哪張表單的哪一版為基底建的)。 */
export interface FormForkSource {
  formKey: string;
  version: number;
}

/**
 * 表單(Spec 6a §4「forms」;`docs/data-model.md`「forms」):一種填報的身分,掛在**一個**表單模組下。
 *
 * - 共用表單:`ownerOrgId = null`,root 管,以 `org_form`(`business_relationships`)分派給租戶
 * - 客製表單:`ownerOrgId = 租戶頂層`,以某共用表單某版本為基底建(`forkedFrom`),只有該租戶看得到
 *
 * **不掛 `tenantScopePlugin`**:表單沒有 `orgId`,誰看得到哪一張由 `ownerOrgId` + `org_form` 決定
 * (`forms/form-access.service.ts`),不是可見範圍;填寫者只看 `currentVersion`。
 */
@Schema({ collection: FORMS_COLLECTION, timestamps: true })
export class Form {
  /** 全域唯一,`^[a-z][a-z0-9_]{0,39}$`(`@repo/domain/form` 的 `isValidFormKey`);**建立後不可改**。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 掛在哪個表單模組(`modules.engine = "form"`)。 */
  @Prop({ type: String, required: true })
  moduleKey!: string;

  /** 顯示名,可改;欄位級權限的 `name` 以它開頭(下次發布時更新)。 */
  @Prop({ type: String, required: true })
  name!: string;

  /** null = 共用(root 管);有值 = 該租戶頂層(客製)。 */
  @Prop({ type: Types.ObjectId, default: null })
  ownerOrgId!: Types.ObjectId | null;

  /** 客製來源;共用表單或全新建立為 null。 */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  forkedFrom!: FormForkSource | null;

  /** 目前已發布版本號;null = 尚未發布或已退役目前版本(發布步驟 4 的最後一筆寫入)。 */
  @Prop({ type: Number, default: null })
  currentVersion!: number | null;

  /**
   * 頁籤 / 標題模板(`{{名稱}}` 佔位符,套法是 `@repo/domain/form` 的 `renderTemplate`,前端從那筆的值即時算):
   * 摘要槽 `{{title}}` / `{{date}}` / `{{amount}}`、欄位值 `{{value.<欄位key>}}`、
   * 系統 `{{applicant}}` / `{{form}}` / `{{module}}` / `{{action}}`(清單正本 admin 的 `lib/base/form-engine/tab-label.ts`)。
   * null = 用模組層模板。
   */
  @Prop({ type: String, default: null })
  tabLabelTemplate!: string | null;

  /**
   * 允許存草稿(表單設定;`docs/modules/forms.md`「表單設定」):關掉時新增 / 編輯頁不顯示 [存草稿],
   * `createFormDraft` 與對草稿的 `saveFormDraft` 回 `FORBIDDEN`(`DRAFT_DISABLED`),只能直接送出。
   * 缺席(這個設定之前建的表單)= 開;一律用 `allowsDraft()` 讀。
   */
  @Prop({ type: Boolean, default: true })
  allowDraft?: boolean;
}

/** 表單允不允許存草稿:缺席(舊資料)視為開。 */
export function allowsDraft(form: { allowDraft?: boolean | null }): boolean {
  return form.allowDraft !== false;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const FormSchema = SchemaFactory.createForClass(Form);

FormSchema.index({ key: 1 }, { unique: true });
FormSchema.index({ moduleKey: 1, ownerOrgId: 1 });
// 基礎欄位(ADR-0007);可見與否由 ownerOrgId + org_form 決定,不掛 tenantScope(理由見 class 註解)
FormSchema.plugin(baseFieldsPlugin);
