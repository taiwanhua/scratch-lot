import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from "graphql";

/**
 * `JSONObject` scalar:條件樹以自由 JSON 進出(ADR-0008 的 `rules[].filter`)。
 *
 * 為什麼不做成遞迴的 input type:條件樹的葉節點是「欄位 → 依型別而異的運算子 → 依值來源而異的值」,
 * 用 GraphQL 型別表達會長出一堆只有某些組合合法的可選欄位,而真正的判準(型別 → 運算子 → 值來源)
 * 仍然只能在 service 驗 — 等於驗兩次、還對不起來。改成:**存什麼形狀就傳什麼形狀**,
 * 由 `saveDataScopeRule` 一次驗完並以 `RULE_INVALID` 附 `path` 指出是哪一個節點錯
 * (JSON path 才指得到巢狀位置,GraphQL 的欄位錯誤指不到)。形狀正本見 `data-scope-rule.ts`。
 *
 * 個人偏好的 `settings`(`{ <登記的 key>: 值 }`)也用它:key 由登記決定、專案可增,
 * 寫不成固定的 GraphQL 型別;key 與型別由 `UserPreferencesService` 依登記驗。
 */

function parseLiteral(node: ValueNode): unknown {
  switch (node.kind) {
    case Kind.STRING:
    case Kind.ENUM: {
      return node.value;
    }
    case Kind.BOOLEAN: {
      return node.value;
    }
    case Kind.INT:
    case Kind.FLOAT: {
      return Number(node.value);
    }
    case Kind.NULL: {
      return null;
    }
    case Kind.LIST: {
      return node.values.map((value) => parseLiteral(value));
    }
    case Kind.OBJECT: {
      return Object.fromEntries(
        node.fields.map((field) => [
          field.name.value,
          parseLiteral(field.value),
        ]),
      );
    }
    default: {
      throw new GraphQLError(`JSONObject cannot represent ${node.kind}`);
    }
  }
}

function assertObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError("JSONObject must be an object");
  }
  return value as Record<string, unknown>;
}

export const GraphQLJSONObject = new GraphQLScalarType({
  name: "JSONObject",
  description:
    "任意 JSON 物件,形狀由各端點驗證(資料範圍的條件樹見 apps/api/src/data-scope/data-scope-rule.ts;個人偏好見 apps/api/src/user-preferences/user-preference-registry.ts)",
  serialize: (value) => assertObject(value),
  parseValue: (value) => assertObject(value),
  parseLiteral: (node) => assertObject(parseLiteral(node)),
});
