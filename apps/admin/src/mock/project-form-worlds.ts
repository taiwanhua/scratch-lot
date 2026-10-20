import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";

import type { ProjectMockWorld } from "./mock-world-source";

/**
 * 表單執行端與審核流程是**共用端點**(MSW 先列的先贏,同名 handler 只能有一份):底座在 `mock-world.ts`
 * 建唯一一份 world,專案表單模組的假資料(`ProjectMockWorld.formRuntime` / `workflowRuntime`,由 `mock-world.ts` 傳入)在這裡
 * 接到底座的後面,專案不必改 `mock-world.ts`、也不另登記同名 handler。
 */
export const projectForms = (
  project: ProjectMockWorld,
  base: FormRuntimeWorldOptions,
) => {
  const extra = project.formRuntime?.() ?? {};
  return formRuntimeWorld({
    ...base,
    moduleForms: [...(base.moduleForms ?? []), ...(extra.moduleForms ?? [])],
    versions: { ...base.versions, ...extra.versions },
    submissions: [...(base.submissions ?? []), ...(extra.submissions ?? [])],
    fieldOptions: { ...base.fieldOptions, ...extra.fieldOptions },
    listColumns: { ...base.listColumns, ...extra.listColumns },
    listBuiltin: { ...base.listBuiltin, ...extra.listBuiltin },
  });
};

export const projectWorkflows = (
  project: ProjectMockWorld,
  base: WorkflowRuntimeWorldOptions,
) => {
  const extra = project.workflowRuntime?.() ?? {};
  return workflowRuntimeWorld({
    ...base,
    instances: [...(base.instances ?? []), ...(extra.instances ?? [])],
    tasks: [...(base.tasks ?? []), ...(extra.tasks ?? [])],
  });
};
