import { HttpResponse } from "msw";

import type {
  CreateDemoItemTwoMutationVariables,
  DeleteDemoItemTwoMutationVariables,
  DemoItemTwoQueryVariables,
  DemoItemsTwoQuery,
  DemoItemsTwoQueryVariables,
  SetDemoItemTwoEnabledMutationVariables,
  UpdateDemoItemTwoMutationVariables,
} from "@repo/graphql";

import { type GraphqlErrorCode, graphqlError } from "./auth-handlers";
import { api } from "./server";

export type TestDemoItemTwo =
  DemoItemsTwoQuery["demoItemsTwo"]["items"][number];

export type DemoTwoOperation =
  | "CreateDemoItemTwo"
  | "UpdateDemoItemTwo"
  | "DeleteDemoItemTwo"
  | "SetDemoItemTwoEnabled";

export interface DemoTwoFailure {
  code: GraphqlErrorCode;
  /** 附加在 `extensions` 上的欄位(`fields`) */
  extensions?: Record<string, unknown>;
}

export interface DemoTwoWorldOptions {
  items?: TestDemoItemTwo[];
  /** 指定某個寫入操作失敗(值是 `errors[0].extensions.code` 與要附加的 extensions) */
  failures?: Partial<Record<DemoTwoOperation, DemoTwoFailure>>;
}

export interface DemoTwoWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  inputs: {
    createDemoItemTwo: CreateDemoItemTwoMutationVariables["input"][];
    updateDemoItemTwo: UpdateDemoItemTwoMutationVariables["input"][];
    deleteDemoItemTwo: DeleteDemoItemTwoMutationVariables["input"][];
    setDemoItemTwoEnabled: SetDemoItemTwoEnabledMutationVariables["input"][];
  };
  /** 各查詢被打到的次數(驗 invalidate、驗「搜尋是送給 api 不是前端過濾」) */
  calls: { demoItemsTwo: number; demoItemTwo: number };
}

/** 看不到的資料一律 `NOT_FOUND`,不透露它存在。 */
const notFound = () => graphqlError("NOT_FOUND", "NOT_FOUND");

/**
 * 示範模組2 的假 api(兩個 query + 四個 mutation;規則正本
 * `docs/modules/demo.sample-two.md`「api 介面」)。
 *
 * 有狀態:新增 / 編輯 / 刪除寫回同一份清單,所以「mutation → invalidate → 重新查」
 * 在測試裡看得到新值(TEST-08)。與示範模組1 的 world 分成兩份,因為**它們是兩個模組**:
 * 一份 world 同時假裝兩個 api 會讓「對照組沒有那些欄位」這件事在測試裡看不出來。
 *
 * 跟著 api 的規則走,不要比 api 寬鬆:
 * - `keyword` 比對 `name` / `note`(不分大小寫)
 * - 沒有 `internalNote` / 分類 / 狀態 / 附件 —— 對照組就是沒有,別順手補
 * - `enabled` 缺席 / null = 啟用與停用都列(GQL-06)
 */
export const demoTwoWorld = (
  options: DemoTwoWorldOptions = {},
): DemoTwoWorld => {
  const { items = [], failures = {} } = options;

  const state: TestDemoItemTwo[] = structuredClone(items);
  const inputs: DemoTwoWorld["inputs"] = {
    createDemoItemTwo: [],
    updateDemoItemTwo: [],
    deleteDemoItemTwo: [],
    setDemoItemTwoEnabled: [],
  };
  const calls = { demoItemsTwo: 0, demoItemTwo: 0 };
  let created = 0;

  const fail = (operation: DemoTwoOperation) => {
    const failure = failures[operation];
    return failure === undefined
      ? null
      : graphqlError(failure.code, failure.code, failure.extensions ?? {});
  };

  const findItem = (id: string) => state.find((item) => item.id === id);

  const handlers = [
    api.query("DemoItemsTwo", ({ variables }) => {
      const { input } = variables as DemoItemsTwoQueryVariables;
      calls.demoItemsTwo += 1;
      const keyword = input.keyword?.trim().toLowerCase() ?? "";
      const matched = state.filter((item) => {
        if (input.enabled != null && item.enabled !== input.enabled) {
          return false;
        }
        if (keyword === "") {
          return true;
        }
        return `${item.name} ${item.note ?? ""}`
          .toLowerCase()
          .includes(keyword);
      });
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return HttpResponse.json({
        data: {
          demoItemsTwo: {
            items: matched.slice(start, start + pageSize),
            totalCount: matched.length,
            page,
            pageSize,
          },
        },
      });
    }),
    api.query("DemoItemTwo", ({ variables }) => {
      const { id } = variables as DemoItemTwoQueryVariables;
      calls.demoItemTwo += 1;
      const item = findItem(id);
      return item === undefined
        ? notFound()
        : HttpResponse.json({ data: { demoItemTwo: { item } } });
    }),
    api.mutation("CreateDemoItemTwo", ({ variables }) => {
      const { input } = variables as CreateDemoItemTwoMutationVariables;
      inputs.createDemoItemTwo.push(input);
      const failure = fail("CreateDemoItemTwo");
      if (failure !== null) {
        return failure;
      }
      created += 1;
      const item: TestDemoItemTwo = {
        id: `demo-two-new-${String(created)}`,
        name: input.name,
        note: input.note ?? null,
        // 新資料一律啟用(模組文件「api 介面」)
        enabled: true,
        createdBy: null,
        createdAt: "2026-09-22T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z",
        abilities: { canEdit: true, canDelete: true },
        shareOrgs: (input.shareOrgs ?? []).map((entry) => ({
          orgId: entry.orgId,
          includeDescendants: entry.includeDescendants === true,
        })),
        isShared: false,
      };
      state.push(item);
      return HttpResponse.json({ data: { createDemoItemTwo: { item } } });
    }),
    api.mutation("UpdateDemoItemTwo", ({ variables }) => {
      const { input } = variables as UpdateDemoItemTwoMutationVariables;
      inputs.updateDemoItemTwo.push(input);
      const target = findItem(input.id);
      if (target === undefined) {
        return notFound();
      }
      const failure = fail("UpdateDemoItemTwo");
      if (failure !== null) {
        return failure;
      }
      // 缺席 = 不動、null = 清空(GQL-06);`name` 送 null 視同缺席(型別上也不允許)
      target.name = input.name ?? target.name;
      if (input.shareOrgs !== undefined && input.shareOrgs !== null) {
        target.shareOrgs = input.shareOrgs.map((entry) => ({
          orgId: entry.orgId,
          includeDescendants: entry.includeDescendants === true,
        }));
      }
      if ("note" in input) {
        target.note = input.note ?? null;
      }
      return HttpResponse.json({
        data: { updateDemoItemTwo: { item: target } },
      });
    }),
    api.mutation("DeleteDemoItemTwo", ({ variables }) => {
      const { input } = variables as DeleteDemoItemTwoMutationVariables;
      inputs.deleteDemoItemTwo.push(input);
      const failure = fail("DeleteDemoItemTwo");
      if (failure !== null) {
        return failure;
      }
      const index = state.findIndex((item) => item.id === input.id);
      if (index !== -1) {
        state.splice(index, 1);
      }
      return HttpResponse.json({
        data: { deleteDemoItemTwo: { success: true, deletedId: input.id } },
      });
    }),
    api.mutation("SetDemoItemTwoEnabled", ({ variables }) => {
      const { input } = variables as SetDemoItemTwoEnabledMutationVariables;
      inputs.setDemoItemTwoEnabled.push(input);
      const failure = fail("SetDemoItemTwoEnabled");
      if (failure !== null) {
        return failure;
      }
      const target = findItem(input.id);
      if (target === undefined) {
        return notFound();
      }
      // 有狀態:寫回同一份清單,列表 invalidate 後才看得到新狀態(TEST-08)
      target.enabled = input.enabled;
      return HttpResponse.json({
        data: { setDemoItemTwoEnabled: { item: target } },
      });
    }),
  ];

  return { handlers: handlers as DemoTwoWorld["handlers"], inputs, calls };
};
