import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import { baseFieldsPlugin } from "../../../database/plugins/base-fields.plugin";
import { tenantScopePlugin } from "../../../database/plugins/tenant-scope.plugin";
import { SCHEDULE_SETTINGS_MODULE_KEY } from "./schedule-module-keys";

export const SCHEDULE_RELATIONSHIPS_COLLECTION = "schedule_relationships";

/** 排班的關聯類型(封閉 enum)。 */
export const SCHEDULE_RELATIONSHIP_TYPES = ["org_schedule_staff"] as const;
export type ScheduleRelationshipType =
  (typeof SCHEDULE_RELATIONSHIP_TYPES)[number];

/** `org_schedule_staff` 的 meta:這個人在這家店可不可以擔任負責人、是不是主要分店、排序。 */
export interface ScheduleStaffOrgMeta {
  canLead: boolean;
  isPrimary: boolean;
  sortOrder: number;
}

/**
 * 排班的關聯(規格 14.1):`org_schedule_staff` = 某位排班人員可以排某家分店。
 * `firstId` = 分店、`secondId` = 排班檔案(`schedule_staff._id`);`orgId` 恆等於 `firstId`
 * (分店看不到 = 這筆關聯看不到,看不到的分店不能加)。每人一家主要分店;
 * 從排班人員設定拿掉一家店 = 軟刪除這一筆(支援結束後要再排,重新加一筆)。
 */
@Schema({ collection: SCHEDULE_RELATIONSHIPS_COLLECTION, timestamps: true })
export class ScheduleRelationship {
  /** 歸屬組織 = `firstId`(分店)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: [...SCHEDULE_RELATIONSHIP_TYPES],
    required: true,
  })
  type!: ScheduleRelationshipType;

  /** 分店(`orgs._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  firstId!: Types.ObjectId;

  /** 排班檔案(`schedule_staff._id`)。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  secondId!: Types.ObjectId;

  /** `org_schedule_staff`:`{ canLead, isPrimary, sortOrder }`。 */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  meta!: ScheduleStaffOrgMeta;

  moduleKey!: string;
  tenantId!: Types.ObjectId | null;
}

export const ScheduleRelationshipSchema =
  SchemaFactory.createForClass(ScheduleRelationship);

ScheduleRelationshipSchema.index({ type: 1, firstId: 1, secondId: 1 });
ScheduleRelationshipSchema.index({ type: 1, secondId: 1 });
ScheduleRelationshipSchema.index({ orgId: 1, createdAt: 1 });
ScheduleRelationshipSchema.plugin(baseFieldsPlugin);
ScheduleRelationshipSchema.plugin(tenantScopePlugin, { moduleData: true });
ScheduleRelationshipSchema.path("moduleKey").default(
  SCHEDULE_SETTINGS_MODULE_KEY,
);
