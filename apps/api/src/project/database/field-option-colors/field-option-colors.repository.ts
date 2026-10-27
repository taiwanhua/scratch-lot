import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { FieldOptionColor } from "./field-option-color.schema";

export type FieldOptionColorDocument = HydratedDocument<FieldOptionColor>;

/** project_field_option_colors(欄位選項顏色,S2 專案臨時表)。 */
@Injectable()
export class FieldOptionColorsRepository extends BaseRepository<
  FieldOptionColor,
  FieldOptionColorDocument
> {
  constructor(
    @InjectModel(FieldOptionColor.name)
    model: RepositoryModel<FieldOptionColor, FieldOptionColorDocument>,
  ) {
    super(model);
  }
}
