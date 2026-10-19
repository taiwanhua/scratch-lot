import type { DatabaseRegistration } from "../../../database/registration";
import {
  FIELD_OPTION_COLORS_COLLECTION,
  FieldOptionColor,
  FieldOptionColorSchema,
} from "./field-option-color.schema";
import { FieldOptionColorsRepository } from "./field-option-colors.repository";

/** 欄位選項顏色的資料登記:一張租戶表、一個 BaseRepository、一項組織歸屬檢查。 */
export const FIELD_OPTION_COLORS_REGISTRATION: DatabaseRegistration = {
  key: "field-option-colors",
  models: [
    {
      name: FieldOptionColor.name,
      collection: FIELD_OPTION_COLORS_COLLECTION,
      schema: FieldOptionColorSchema,
    },
  ],
  repositories: [
    {
      modelName: FieldOptionColor.name,
      provider: FieldOptionColorsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "field-option-colors",
      modelName: FieldOptionColor.name,
      repository: FieldOptionColorsRepository,
      ownerField: "orgId",
    },
  ],
};
