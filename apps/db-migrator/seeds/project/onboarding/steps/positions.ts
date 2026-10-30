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
        isOwn
        color
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

const SET_OPTION_COLOR = /* GraphQL */ `
  mutation OnboardingSetPositionColor($input: SetFieldColorInput!) {
    setFieldColor(input: $input) {
      field {
        id
        color
      }
    }
  }
`;

interface FieldRow {
  id: string;
  value: string;
  order: number;
  isOwn: boolean;
  color: string | null;
}

/**
 * 開通清單第 5 點的前半:崗位。專案 seed 不內建崗位(沒有全域選項);
 * 開通資料列的崗位(示範資料:店內櫃台A、店外櫃台B)建成這個租戶自己的選項,
 * 已有同一個代碼的就沿用。
 *
 * 選項顏色(欄位管理的「顏色」,選項的 `color`):開通資料有給、選項是這個租戶自己的、
 * 而且**還沒有顏色**時才設定;已有顏色(租戶自己選過)不動。全域選項的顏色只有根組織能設,這一步不碰。
 */
export const positionsStep: OnboardingStep = {
  key: "positions",
  title: "崗位",
  run: async ({ client, plan }) => {
    if (plan.positions.length === 0) {
      return ["開通資料沒有崗位(之後在欄位管理建立)"];
    }
    const categoryKey = SCHEDULE_FIELD_CATEGORY_KEYS.position;
    const { fieldCategories } = await client.request<{
      fieldCategories: { items: { id: string; key: string }[] };
    }>(FIELD_CATEGORIES);
    const category = fieldCategories.items.find(
      (item) => item.key === categoryKey,
    );
    if (category === undefined) {
      throw new Error(
        `欄位管理沒有「崗位」類別(${categoryKey}):先跑過專案 seed`,
      );
    }
    const { fields } = await client.request<{ fields: { items: FieldRow[] } }>(
      FIELDS,
      { categoryId: category.id },
    );
    const byValue = new Map(fields.items.map((field) => [field.value, field]));
    let order = Math.max(0, ...fields.items.map((field) => field.order));
    const lines: string[] = [];
    for (const position of plan.positions) {
      const found = byValue.get(position.value);
      let fieldId: string;
      let own: boolean;
      let colored: boolean;
      if (found === undefined) {
        order += 1;
        const { createField } = await client.request<{
          createField: { field: { id: string } };
        }>(CREATE_FIELD, {
          input: {
            categoryId: category.id,
            value: position.value,
            label: position.label,
            order,
          },
        });
        fieldId = createField.field.id;
        own = true;
        colored = false;
        lines.push(`建立「${position.label}」`);
      } else {
        fieldId = found.id;
        own = found.isOwn;
        colored = found.color !== null;
        lines.push(`「${position.label}」已存在`);
      }
      if (position.color === null) {
        continue;
      }
      if (!own) {
        lines.push(`  「${position.label}」不是這個租戶自己的選項,顏色不設`);
        continue;
      }
      if (colored) {
        lines.push(`  「${position.label}」已有顏色,不動`);
        continue;
      }
      await client.request(SET_OPTION_COLOR, {
        input: { id: fieldId, color: position.color },
      });
      lines.push(`  「${position.label}」顏色設為 ${position.color}`);
    }
    return lines;
  },
};
