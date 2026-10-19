import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { UserPreferencesResolver } from "./user-preferences.resolver";
import { UserPreferencesService } from "./user-preferences.service";

/** 個人偏好(`user_preferences`)。登記由全域的 `UserPreferenceRegistryModule` 提供。 */
@Module({
  imports: [DatabaseModule],
  providers: [UserPreferencesService, UserPreferencesResolver],
  exports: [UserPreferencesService],
})
export class UserPreferencesModule {}
