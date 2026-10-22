import { UseGuards } from "@nestjs/common";

import { TenantScopeGuard } from "./tenant-scope.guard";

/**
 * 標在專案 resolver 類別上:這些端點只在租戶裡有意義,根組織進來一律回 `FORBIDDEN` + `TENANT_ONLY`
 * (`root-org.ts`)。欄位選項之類根組織也會讀的端點不標。
 */
export const RequireTenant = (): ClassDecorator & MethodDecorator =>
  UseGuards(TenantScopeGuard);
