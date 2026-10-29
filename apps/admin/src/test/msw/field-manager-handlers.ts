import { HttpResponse } from "msw";

import { isValidFieldCategoryKey } from "@repo/domain/form";
import { isTagPaletteKey } from "@repo/domain/tag-palette";
import {
  type CreateFieldCategoryMutationVariables,
  type CreateFieldMutationVariables,
  type FieldCategoriesQuery,
  type FieldCategoriesQueryVariables,
  type FieldsQuery,
  type FieldsQueryVariables,
  type SetFieldCategoryEnabledMutationVariables,
  type SetFieldColorMutationVariables,
  type SetFieldEnabledMutationVariables,
  type UpdateFieldCategoryMutationVariables,
  type UpdateFieldMutationVariables,
} from "@repo/graphql";

import { type GraphqlErrorCode, graphqlError } from "./auth-handlers";
import { api } from "./server";

export type TestFieldCategory =
  FieldCategoriesQuery["fieldCategories"]["items"][number];
export type TestField = FieldsQuery["fields"]["items"][number];

/** 會被指定失敗的操作(值是 `errors[0].extensions.code`)。 */
export type FieldOperation =
  | "CreateField"
  | "UpdateField"
  | "SetFieldEnabled"
  | "SetFieldColor"
  | "CreateFieldCategory"
  | "UpdateFieldCategory"
  | "SetFieldCategoryEnabled";

export interface FieldWorldOptions {
  categories?: TestFieldCategory[];
  /** 類別 id → 合併清單(全域 + 上層 + 本組織 + 可見範圍內的下層) */
  fieldsByCategory?: Record<string, TestField[]>;
  /** 新增選項時寫進 `ownerOrg` 的組織(= 當前組織);預設不帶名稱 */
  currentOrg?: { id: string; name: string };
  /**
   * **上層**組織的 id:`value` 不可與全域 / 上層 / 自己重複(繼承鏈),
   * 但可以與旁支 / 下層重複 —— 假伺服器要跟 api 同一條規則,不然測試會比 api 寬鬆。
   */
  upperOrgIds?: string[];
  failures?: Partial<Record<FieldOperation, GraphqlErrorCode>>;
}

export interface FieldWorld {
  handlers: Parameters<typeof import("./server").server.use>;
  /** 各操作收到的輸入(依序),用來斷言「送出去的是什麼」 */
  inputs: {
    createField: CreateFieldMutationVariables["input"][];
    updateField: UpdateFieldMutationVariables["input"][];
    setFieldEnabled: SetFieldEnabledMutationVariables["input"][];
    setFieldColor: SetFieldColorMutationVariables["input"][];
    createFieldCategory: CreateFieldCategoryMutationVariables["input"][];
    updateFieldCategory: UpdateFieldCategoryMutationVariables["input"][];
    setFieldCategoryEnabled: SetFieldCategoryEnabledMutationVariables["input"][];
  };
  /** `fields` / `fieldCategories` 被打到的次數(驗 invalidate 之後真的重新查了一次) */
  calls: { fields: number; fieldCategories: number };
}

/**
 * 欄位管理頁的假 api(兩個 query + 選項的四個 mutation + 類別作業;可見範圍規則)。
 *
 * 清單是**有狀態的**:新增 / 編輯 / 切換寫回同一份資料,所以「mutation → invalidate →
 * 重新查 `fields`」在測試裡看得到新的值 —— 只回固定清單的 handler 驗不出失效有沒有發生。
 * 規則照 `docs/modules/field-manager.md`「api 介面」實作,前端才不會對著一個比 api
 * 寬鬆的假伺服器寫測試:
 *
 * - **可不可以動由每一列自己的 `canEdit` / `canToggleEnabled` 決定**(api 依操作者算好),
 *   假伺服器不重算組織關係 —— 這正是前端該相信的那一份
 * - `updateField` / `setFieldEnabled` / `setFieldColor` 被擋時:種子 → `FORBIDDEN` + reason
 *   `SEED_READ_ONLY` / `SEED_GLOBAL_SWITCH`;別的組織加的 → reason `NOT_OWNER`
 * - `setFieldColor`:誰能改同 `canToggleEnabled`;不在色票清單的代號 → `VALIDATION_FAILED`(`fields: ["color"]`)
 * - `createField` 的 `value` 與同類別的**繼承鏈**(全域 / 上層 / 自己)重複 → `FIELD_VALUE_DUPLICATE`
 * - 類別作業:`key` 格式不符 → `VALIDATION_FAILED`、重複(含停用的)→ `FIELD_CATEGORY_KEY_DUPLICATE`、
 *   改名 / 停用系統類別 → `FORBIDDEN` + reason `SYSTEM_CATEGORY`;`fieldCategories(input.enabledOnly)` 只回啟用的
 */
export const fieldWorld = (options: FieldWorldOptions = {}): FieldWorld => {
  const {
    categories = [],
    fieldsByCategory = {},
    currentOrg,
    upperOrgIds = [],
    failures = {},
  } = options;

  const state: Record<string, TestField[]> = structuredClone(fieldsByCategory);
  const categoryState: TestFieldCategory[] = structuredClone(categories);
  const inputs: FieldWorld["inputs"] = {
    createField: [],
    updateField: [],
    setFieldEnabled: [],
    setFieldColor: [],
    createFieldCategory: [],
    updateFieldCategory: [],
    setFieldCategoryEnabled: [],
  };
  const calls = { fields: 0, fieldCategories: 0 };
  let created = 0;

  const fail = (operation: FieldOperation) => {
    const code = failures[operation];
    return code === undefined ? null : graphqlError(code, code);
  };

  const findField = (id: string): TestField | undefined =>
    Object.values(state)
      .flat()
      .find((item) => item.id === id);

  /** 擋下來時的 reason:全域種子 vs 別的組織加的(前端據此換文案)。 */
  const forbidden = (field: TestField, seedReason: string) =>
    graphqlError("FORBIDDEN", "FORBIDDEN", {
      reason: field.ownerOrg ? "NOT_OWNER" : seedReason,
    });

  /** 繼承鏈 = 全域 + 上層組織 + 自己這一層;旁支 / 下層不算。 */
  const isInherited = (field: TestField): boolean => {
    const owner = field.ownerOrg ?? null;
    return owner === null || field.isOwn || upperOrgIds.includes(owner.id);
  };

  const handlers = [
    api.query("FieldCategories", ({ variables }) => {
      const { input } = variables as FieldCategoriesQueryVariables;
      calls.fieldCategories += 1;
      const items =
        input?.enabledOnly === true
          ? categoryState.filter((category) => category.enabled)
          : categoryState;
      return HttpResponse.json({
        data: { fieldCategories: { items, totalCount: items.length } },
      });
    }),
    ...categoryHandlers(categoryState, inputs, fail),
    api.query("Fields", ({ variables }) => {
      const { categoryId } = variables as FieldsQueryVariables;
      calls.fields += 1;
      const items = state[categoryId] ?? [];
      return HttpResponse.json({
        data: { fields: { items, totalCount: items.length } },
      });
    }),
    api.mutation("CreateField", ({ variables }) => {
      const { input } = variables as CreateFieldMutationVariables;
      inputs.createField.push(input);
      const failure = fail("CreateField");
      if (failure !== null) {
        return failure;
      }
      const siblings = state[input.categoryId] ?? [];
      if (
        siblings.some((item) => item.value === input.value && isInherited(item))
      ) {
        return graphqlError("FIELD_VALUE_DUPLICATE", "FIELD_VALUE_DUPLICATE");
      }
      created += 1;
      const field: TestField = {
        id: `f-new-${String(created)}`,
        categoryId: input.categoryId,
        label: input.label,
        value: input.value,
        order: input.order ?? 0,
        enabled: true,
        description: input.description ?? null,
        color: null,
        ownerOrg: currentOrg ?? null,
        isOwn: true,
        canEdit: true,
        canToggleEnabled: true,
      };
      state[input.categoryId] = [...siblings, field];
      return HttpResponse.json({ data: { createField: { field } } });
    }),
    api.mutation("UpdateField", ({ variables }) => {
      const { input } = variables as UpdateFieldMutationVariables;
      inputs.updateField.push(input);
      const failure = fail("UpdateField");
      if (failure !== null) {
        return failure;
      }
      const target = findField(input.id);
      if (target === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND");
      }
      // 改不動的列(種子或別的組織加的)在 api 就被擋下,不是靜默忽略
      if (!target.canEdit) {
        return forbidden(target, "SEED_READ_ONLY");
      }
      if (input.label !== undefined && input.label !== null) {
        target.label = input.label;
      }
      if (input.order !== undefined && input.order !== null) {
        target.order = input.order;
      }
      if (input.description !== undefined) {
        target.description = input.description;
      }
      return HttpResponse.json({ data: { updateField: { field: target } } });
    }),
    api.mutation("SetFieldEnabled", ({ variables }) => {
      const { input } = variables as SetFieldEnabledMutationVariables;
      inputs.setFieldEnabled.push(input);
      const failure = fail("SetFieldEnabled");
      if (failure !== null) {
        return failure;
      }
      const target = findField(input.id);
      if (target === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND");
      }
      // 種子的 enabled 是全域開關(限根組織);自訂的只有加它的組織切得動
      if (!target.canToggleEnabled) {
        return forbidden(target, "SEED_GLOBAL_SWITCH");
      }
      target.enabled = input.enabled;
      return HttpResponse.json({
        data: { setFieldEnabled: { field: target } },
      });
    }),
    api.mutation("SetFieldColor", ({ variables }) => {
      const { input } = variables as SetFieldColorMutationVariables;
      inputs.setFieldColor.push(input);
      const failure = fail("SetFieldColor");
      if (failure !== null) {
        return failure;
      }
      const color = input.color ?? null;
      if (color !== null && !isTagPaletteKey(color)) {
        return graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          fields: ["color"],
        });
      }
      const target = findField(input.id);
      if (target === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND");
      }
      // 顏色與停用 / 啟用同一條規則:種子限根組織、自訂的只有加它的組織改得動
      if (!target.canToggleEnabled) {
        return forbidden(target, "SEED_GLOBAL_SWITCH");
      }
      target.color = color;
      return HttpResponse.json({ data: { setFieldColor: { field: target } } });
    }),
  ];

  return { handlers: handlers as FieldWorld["handlers"], inputs, calls };
};

const notFoundError = () => graphqlError("NOT_FOUND");

/** 類別作業的三個 mutation(寫回 `categoryState`,讓失效後的重查看得到新值)。 */
const categoryHandlers = (
  categoryState: TestFieldCategory[],
  inputs: FieldWorld["inputs"],
  fail: (operation: FieldOperation) => Response | null,
) => {
  const findCategory = (id: string) =>
    categoryState.find((category) => category.id === id);

  return [
    api.mutation("CreateFieldCategory", ({ variables }) => {
      const { input } = variables as CreateFieldCategoryMutationVariables;
      inputs.createFieldCategory.push(input);
      const failure = fail("CreateFieldCategory");
      if (failure !== null) {
        return failure;
      }
      if (!isValidFieldCategoryKey(input.key)) {
        return graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          fields: ["key"],
        });
      }
      if (categoryState.some((category) => category.key === input.key)) {
        return graphqlError(
          "FIELD_CATEGORY_KEY_DUPLICATE",
          "FIELD_CATEGORY_KEY_DUPLICATE",
          { fields: ["key"] },
        );
      }
      const category: TestFieldCategory = {
        id: `cat-new-${input.key}`,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        enabled: true,
      };
      categoryState.push(category);
      return HttpResponse.json({ data: { createFieldCategory: { category } } });
    }),
    api.mutation("UpdateFieldCategory", ({ variables }) => {
      const { input } = variables as UpdateFieldCategoryMutationVariables;
      inputs.updateFieldCategory.push(input);
      const failure = fail("UpdateFieldCategory");
      if (failure !== null) {
        return failure;
      }
      const target = findCategory(input.id);
      if (target === undefined) {
        return notFoundError();
      }
      // 系統類別由 seed 維護,畫面唯讀(api 同一條規則)
      if (target.isSystem) {
        return graphqlError("FORBIDDEN", "FORBIDDEN", {
          reason: "SYSTEM_CATEGORY",
        });
      }
      if (input.name !== undefined && input.name !== null) {
        target.name = input.name;
      }
      if (input.description !== undefined) {
        target.description = input.description;
      }
      return HttpResponse.json({
        data: { updateFieldCategory: { category: target } },
      });
    }),
    api.mutation("SetFieldCategoryEnabled", ({ variables }) => {
      const { input } = variables as SetFieldCategoryEnabledMutationVariables;
      inputs.setFieldCategoryEnabled.push(input);
      const failure = fail("SetFieldCategoryEnabled");
      if (failure !== null) {
        return failure;
      }
      const target = findCategory(input.id);
      if (target === undefined) {
        return notFoundError();
      }
      if (target.isSystem && !input.enabled) {
        return graphqlError("FORBIDDEN", "FORBIDDEN", {
          reason: "SYSTEM_CATEGORY",
        });
      }
      target.enabled = input.enabled;
      return HttpResponse.json({
        data: { setFieldCategoryEnabled: { category: target } },
      });
    }),
  ];
};
