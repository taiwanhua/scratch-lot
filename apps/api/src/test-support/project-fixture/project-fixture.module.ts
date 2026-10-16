import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module";
import { PROJECT_FIXTURE_LOOKUP_PROVIDER } from "./project-fixture-lookup";
import { ProjectFixtureResolver } from "./project-fixture.resolver";
import { ProjectFixtureService } from "./project-fixture.service";

/** 測試專案功能:普通的 Nest module,資料出口由資料登記提供;另登記一個 lookup 來源。 */
@Module({
  imports: [DatabaseModule],
  providers: [
    ProjectFixtureService,
    ProjectFixtureResolver,
    PROJECT_FIXTURE_LOOKUP_PROVIDER,
  ],
})
export class ProjectFixtureModule {}
