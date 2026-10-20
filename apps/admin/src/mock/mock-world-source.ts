import type { RequestHandler, WebSocketHandler } from "msw";

import type { TestModule } from "@/test/msw/auth-handlers";
import type { FormRuntimeWorldOptions } from "@/test/msw/form-runtime-handlers";
import type { WorkflowRuntimeWorldOptions } from "@/test/msw/workflow-runtime-handlers";

import type { MockView } from "./mock-fixtures";

/**
 * `setupWorker()` / `server.use()` 收的 handler 型別(msw 內部叫 `AnyHandler`,
 * 沒有從套件根匯出,所以在這裡重寫一次)。
 */
export type MockHandler = RequestHandler | WebSocketHandler;

export interface MockWorldOptions {
  /** 視角:root(根組織,看得到全部模組)或 tenant(租戶管理員,少了兩個 `isRootOnly` 模組) */
  view: MockView;
  /** 一開機就有有效的 refresh cookie = 自動登入;false 會停在登入頁(任何帳密都能登入) */
  authenticated: boolean;
}

/**
 * 專案的 mock world(`mock/project/mock-world.ts`,專案維護、底座預設為空):mock 開發模式要看到的
 * 專案模組與它們的假 api。由 `mock-world.ts` 與底座的 world 合成,專案頁的 mock 截圖不必改底座檔。
 */
export interface ProjectMockWorld {
  /** 側欄與路由要多出的專案模組(`me.modules` 的形狀;權限由專案自己給) */
  modules: (view: MockView) => TestModule[];
  /**
   * 專案頁的假 api。夾具沿用 `src/test/msw/project/` 的 world(與測試同一份,TEST-08);
   * GraphQL 操作名不可與底座重複(`mock-world.test.ts` 守),要換掉底座的端點不在這裡撞名。
   */
  handlers: (options: MockWorldOptions) => MockHandler[];
  /**
   * 專案表單模組的表單執行端假資料(選填)。表單執行端的端點(`ModuleForms` / `FormSubmissions` …)是共用端點,
   * 底座只建一份 world:專案的表單、版本、提交與選項併進那一份(`project-form-worlds.ts`),不另登記同名 handler。
   */
  formRuntime?: () => Pick<
    FormRuntimeWorldOptions,
    | "moduleForms"
    | "versions"
    | "submissions"
    | "fieldOptions"
    | "listColumns"
    | "listBuiltin"
  >;
  /** 同上:審核流程(申請中心、審核區塊)的實例與任務併進底座那一份 world(選填)。 */
  workflowRuntime?: () => Pick<
    WorkflowRuntimeWorldOptions,
    "instances" | "tasks"
  >;
}
