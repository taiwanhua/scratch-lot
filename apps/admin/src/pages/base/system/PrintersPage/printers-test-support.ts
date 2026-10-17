import { HttpResponse } from "msw";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { systemModules } from "@/test/msw/module-fixtures";
import { tenantTree } from "@/test/msw/org-fixtures";
import { PRINTERS_ROUTE, printersModule } from "@/test/msw/printing-fixtures";
import {
  type PrintingWorld,
  type PrintingWorldOptions,
  printingWorld,
} from "@/test/msw/printing-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { PRINTERS_PERMISSIONS } from "./printers-permissions";

/** 系統管理群組節點(印表機管理掛在它底下)。 */
const systemGroup = systemModules.filter((module) => module.key === "system");

export const ALL_PRINTER_PERMISSIONS = Object.values(PRINTERS_PERMISSIONS);

export interface PrintersSetup {
  /** 起始網址;預設印表機管理頁 */
  path?: string;
  /** `system.printers` 的權限;預設 view + create + edit */
  permissions?: readonly string[];
  world?: PrintingWorldOptions;
}

/**
 * 以租戶管理員(租戶 A 的組織樹)開印表機管理頁:登入線 + 組織樹 + 印表機管理的假 api。
 * 組織樹在這裡另登記(`printingWorld` 不含 `OrgTree`,mock 模式的正本是 `orgWorld`)。
 */
export const renderPrinters = ({
  path = PRINTERS_ROUTE,
  permissions = ALL_PRINTER_PERMISSIONS,
  world,
}: PrintersSetup = {}): ReturnType<typeof renderApp> & {
  printing: PrintingWorld;
} => {
  const printing = printingWorld(world);
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, ...systemGroup, printersModule(permissions)],
      orgs: [{ id: "org-tenant-a", name: "租戶 A" }],
    }).handlers,
    api.query("OrgTree", () =>
      HttpResponse.json({ data: { orgTree: tenantTree } }),
    ),
    ...printing.handlers,
  );
  return { ...renderApp({ path }), printing };
};
