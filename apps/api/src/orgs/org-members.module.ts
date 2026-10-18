import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { UsersModule } from "../users/users.module";
import { OrgMembersResolver } from "./org-members.resolver";
import { OrgMembersService } from "./org-members.service";

/**
 * 組織詳情的「成員」頁籤(權限 `system.org-manager.view-members` / `.add-members`,
 * 規則正本 docs/modules/org-manager.md)。
 *
 * **為什麼不直接住在 `OrgsModule`**:加入成員的寫入正本是 `UsersService.addOrgs`
 * (被改的是使用者的所屬組織),而 `UsersModule` 已經 import `OrgsModule`
 * (擁有者保護住在 `orgs/`)。把它掛回 `OrgsModule` 會造出模組環,
 * 所以獨立一個薄模組同時 import 兩邊:`OrgMembersModule → UsersModule → OrgsModule`,
 * 方向仍是單向的。檔案照樣放在 `orgs/` —— 它是組織管理模組的一頁。
 */
@Module({
  imports: [DatabaseModule, UsersModule],
  providers: [OrgMembersService, OrgMembersResolver],
})
export class OrgMembersModule {}
