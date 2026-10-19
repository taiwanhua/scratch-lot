import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { OnboardingStep } from "../context";

const FIELD_CATEGORIES = /* GraphQL */ `
  query OnboardingFieldCategories {
    fieldCategories {
      items {
        id
        key
      }
    }
  }
`;

const FIELDS = /* GraphQL */ `
  query OnboardingFields($categoryId: ID!) {
    fields(categoryId: $categoryId) {
      items {
        id
        value
        order
      }
    }
  }
`;

const CREATE_FIELD = /* GraphQL */ `
  mutation OnboardingCreatePosition($input: CreateFieldInput!) {
    createField(input: $input) {
      field {
        id
      }
    }
  }
`;

/**
 * 開通清單第 5 點的前半:崗位。專案 seed 已有店內櫃台、店外攤位、補貨(全域選項);
 * 開通資料另列的自訂崗位(示範資料:櫃台 A、櫃台 B、彩券機旁)建成這個租戶自己的選項,
 * 已有同一個代碼的就沿用。選項顏色不在這一步。
 */
export const positionsStep: OnboardingStep = {
  key: "positions",
  title: "崗位",
  run: async ({ client, plan }) => {
    if (plan.positions.length === 0) {
      return ["沒有自訂崗位(用專案預設的店內櫃台、店外攤位、補貨)"];
    }
    const { fieldCategories } = await client.request<{
      fieldCategories: { items: { id: string; key: string }[] };
    }>(FIELD_CATEGORIES);
    const category = fieldCategories.items.find(
      (item) => item.key === SCHEDULE_FIELD_CATEGORY_KEYS.position,
    );
    if (category === undefined) {
      throw new Error(
        `欄位管理沒有「崗位」類別(${SCHEDULE_FIELD_CATEGORY_KEYS.position}):先跑過專案 seed`,
      );
    }
    const { fields } = await client.request<{
      fields: { items: { value: string; order: number }[] };
    }>(FIELDS, { categoryId: category.id });
    const existing = new Set(fields.items.map((field) => field.value));
    let order = Math.max(0, ...fields.items.map((field) => field.order));
    const lines: string[] = [];
    for (const position of plan.positions) {
      if (existing.has(position.value)) {
        lines.push(`「${position.label}」已存在`);
        continue;
      }
      order += 1;
      await client.request(CREATE_FIELD, {
        input: {
          categoryId: category.id,
          value: position.value,
          label: position.label,
          order,
        },
      });
      lines.push(`建立「${position.label}」`);
    }
    return lines;
  },
};
