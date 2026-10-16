import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { ProjectFixtureResolver } from "./project-fixture.resolver";
import { ProjectFixtureService } from "./project-fixture.service";

/** 測試專案功能:普通的 Nest module,資料出口由資料登記提供。 */
@Module({
  imports: [DatabaseModule],
  providers: [ProjectFixtureService, ProjectFixtureResolver],
})
export class ProjectFixtureModule {}
