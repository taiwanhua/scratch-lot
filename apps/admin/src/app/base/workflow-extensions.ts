import type { WorkflowExtensionRegistration } from "@/hooks/base/useWorkflowExtensions";

/**
 * 底座依模組登記的審核擴充(`docs/modules/workflows.md`「依模組登記的審核擴充」);目前底座模組沒有。
 * 專案的登記在 `app/project/workflow-extensions.ts`,兩份由 `app/module-pages.tsx` 合成。
 */
export const baseWorkflowExtensions: readonly WorkflowExtensionRegistration[] =
  [];
