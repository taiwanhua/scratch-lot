import { Parent, ResolveField, Resolver } from "@nestjs/graphql";
import { Types } from "mongoose";

import { CurrentOperator } from "../auth/decorators";
import { Me } from "../auth/models/me.model";
import type { OperatorContext } from "../database/operator-context";
import {
  MeModule,
  type ModuleEngine,
  type ModuleSidebarType,
} from "./models/me-module.model";
import { PermissionResolver, type ResolvedModule } from "./permission-resolver";

function toMeModule(module: ResolvedModule): MeModule {
  return {
    id: String(module.id),
    key: module.key,
    name: module.name,
    parentId: module.parentId === null ? null : String(module.parentId),
    // schema 的字串值與 GraphQL enum 的內部值相同(group / link / hidden)
    sidebarType: module.sidebarType as ModuleSidebarType,
    order: module.order,
    route: module.route,
    icon: module.icon,
    // schema 的字串值與 GraphQL enum 的內部值相同(fixed / form)
    engine: module.engine as ModuleEngine,
    permissions: module.permissions,
  };
}

/**
 * `me.modules`:以 field resolver 掛在登入線1 的 `Me` 上,登入線的 resolver 不動。
 * 全域 guard 不作用於 field resolver(fieldResolverEnhancers 未開),登入由 `me` 本身把關;
 * 操作者上下文自 request 取得(@CurrentOperator)。
 */
@Resolver(() => Me)
export class MeModulesResolver {
  constructor(private readonly permissions: PermissionResolver) {}

  /** 模組陣列(ADR-0011 七步;超級管理員 bypass 回全部 enabled 模組與全部權限)。 */
  @ResolveField(() => [MeModule])
  async modules(
    @Parent() me: Me,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<MeModule[]> {
    const { modules } = await this.permissions.resolve(
      new Types.ObjectId(me.id),
      operator.currentOrgId,
    );
    return modules.map((module) => toMeModule(module));
  }
}
