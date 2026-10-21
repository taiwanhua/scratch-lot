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

const OPTION_COLORS = /* GraphQL */ `
  query OnboardingPositionColors($categoryKey: String!) {
    fieldOptionColors(categoryKey: $categoryKey) {
      items {
        fieldId
        paletteKey
      }
    }
  }
`;

const SET_OPTION_COLOR = /* GraphQL */ `
  mutation OnboardingSetPositionColor($input: SetFieldOptionColorInput!) {
    setFieldOptionColor(input: $input) {
      color {
        fieldId
        paletteKey
      }
    }
  }
`;

interface FieldRow {
  id: string;
  value: string;
  order: number;
  isOwn: boolean;
}

/**
 * 開通清單第 5 點的前半:崗位。專案 seed 已有店內櫃台、店外攤位、補貨(全域選項);
 * 開通資料另列的自訂崗位(示範資料:櫃台 A、櫃台 B、彩券機旁)建成這個租戶自己的選項,
 * 已有同一個代碼的就沿用。
 *
 * 選項顏色(欄位管理的「顏色」,色票代號 `paletteKey`):開通資料有給、選項是這個租戶自己的、
 * 而且**還沒有顏色**時才設定;已有顏色(租戶自己選過)不動。全域選項的顏色只有根組織能設,這一步不碰。
 */
export const positionsStep: OnboardingStep = {
  key: "positions",
  title: "崗位",
  run: async ({ client, plan }) => {
    if (plan.positions.length === 0) {
      return ["沒有自訂崗位(用專案預設的店內櫃台、店外攤位、補貨)"];
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
    const { fieldOptionColors } = await client.request<{
      fieldOptionColors: {
        items: { fieldId: string; paletteKey: string | null }[];
      };
    }>(OPTION_COLORS, { categoryKey });
    const colored = new Set(
      fieldOptionColors.items
        .filter((item) => item.paletteKey !== null)
        .map((item) => item.fieldId),
    );
    let order = Math.max(0, ...fields.items.map((field) => field.order));
    const lines: string[] = [];
    for (const position of plan.positions) {
      const found = byValue.get(position.value);
      let fieldId: string;
      let own: boolean;
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
        lines.push(`建立「${position.label}」`);
      } else {
        fieldId = found.id;
        own = found.isOwn;
        lines.push(`「${position.label}」已存在`);
      }
      if (position.color === null) {
        continue;
      }
      if (!own) {
        lines.push(`  「${position.label}」不是這個租戶自己的選項,顏色不設`);
        continue;
      }
      if (colored.has(fieldId)) {
        lines.push(`  「${position.label}」已有顏色,不動`);
        continue;
      }
      await client.request(SET_OPTION_COLOR, {
        input: { fieldId, paletteKey: position.color },
      });
      lines.push(`  「${position.label}」顏色設為 ${position.color}`);
    }
    return lines;
  },
};
