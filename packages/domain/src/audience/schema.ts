import { z } from "zod";

import { FIELD_KEY_PATTERN } from "../form/keys";
import { splitPermissionKey } from "../permission/keys";
import {
  AUDIENCE_CONDITIONS,
  AUDIENCE_FORM_FIELD_REF_PREFIX,
  AUDIENCE_GROUP_OPS,
  AUDIENCE_MAX_DEPTH,
  AUDIENCE_ORG_RANGES,
  type Audience,
  type AudienceField,
  type AudienceLeaf,
  type AudienceNode,
  type AudienceOptions,
  orgSourceOfRef,
} from "./types";

/**
 * 寫法:群組 / 條件列、靜態 / 動態值、all / match 這幾處「依鍵分辨形狀」的地方,
 * 一律先看鍵、再只用那一種形狀驗證(`relayParse`)—— 錯誤的 `path` 才會指到出錯的那一格,
 * 不會是 union 的「兩種都不符」。
 */

/** ObjectId 的字串形式(domain 不依賴 mongoose,用格式判斷)。 */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPermissionKey(value: string): boolean {
  try {
    splitPermissionKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 用選定的 schema 驗 `value`,把問題原樣轉交給外層(路徑保留,外層會再補上自己的位置)。
 * 給 `z.unknown().transform` 用。
 */
function relayParse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  ctx: z.core.$RefinementCtx,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  for (const issue of parsed.error.issues) {
    ctx.issues.push({
      code: "custom",
      message: issue.message,
      path: issue.path,
      input: value,
    });
  }
  return z.NEVER;
}

/** 某欄位的靜態值格式:使用者 / 角色 / 組織 = id,權限 = 權限 key。 */
function staticValuesSchema(field: AudienceField) {
  const item =
    field === "permission"
      ? z.string().refine(isPermissionKey, {
          message: "expected a permission key <module key>.<action>",
        })
      : z.string().regex(OBJECT_ID_PATTERN, { message: "expected an id" });
  return z.strictObject({
    kind: z.literal("static"),
    values: z.array(item).min(1),
  });
}

/** 動態值(只有所屬組織欄):ref 必須是這個使用處宣告的組織來源。 */
function dynamicValueSchema(options: AudienceOptions) {
  return z.strictObject({
    kind: z.literal("dynamic"),
    ref: z.string().superRefine((ref, ctx) => {
      const source = orgSourceOfRef(ref);
      if (source === undefined || !options.orgSources.includes(source)) {
        ctx.addIssue({
          code: "custom",
          message: `org source ${ref} is not allowed here; allowed: ${options.orgSources.join(" / ")}`,
        });
        return;
      }
      if (
        source === "form-field" &&
        !FIELD_KEY_PATTERN.test(
          ref.slice(AUDIENCE_FORM_FIELD_REF_PREFIX.length),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "form-field ref must be form-field:<field key>",
        });
      }
    }),
  });
}

/** 所屬組織的值:依 `kind` 分辨;這個使用處沒宣告 `static` → 只收動態。 */
function orgValueSchema(options: AudienceOptions): z.ZodType {
  const allowsStatic = options.orgSources.includes("static");
  return z.unknown().transform((value, ctx) => {
    const kind = isRecord(value) ? value.kind : undefined;
    if (kind === "dynamic") {
      return relayParse(dynamicValueSchema(options), value, ctx);
    }
    if (kind === "static" && allowsStatic) {
      return relayParse(staticValuesSchema("org"), value, ctx);
    }
    return relayParse(
      z.looseObject({
        kind: allowsStatic
          ? z.enum(["static", "dynamic"])
          : z.literal("dynamic"),
      }),
      value,
      ctx,
    );
  });
}

function leafSchemaOf(
  field: AudienceField,
  options: AudienceOptions,
): z.ZodType<AudienceLeaf> {
  const base = {
    field: z.literal(field),
    cond: z.enum(AUDIENCE_CONDITIONS),
  };
  if (field !== "org") {
    return z.strictObject({ ...base, value: staticValuesSchema(field) });
  }
  // 值的型別由 orgValueSchema 的 transform 保證(靜態 / 動態兩種形狀之一)
  return z.strictObject({
    ...base,
    value: orgValueSchema(options),
    range: z.enum(AUDIENCE_ORG_RANGES),
  }) as z.ZodType<AudienceLeaf>;
}

/**
 * 條件樹的一個節點(深度 `depth`,根群組 = 1)。有 `op` 或 `children` = 群組,否則是條件列。
 * 群組最多 `AUDIENCE_MAX_DEPTH` 層;空群組不允許(沿用條件組合的規則)。
 */
function nodeSchema(
  options: AudienceOptions,
  depth: number,
): z.ZodType<AudienceNode> {
  return z.unknown().transform((value, ctx): AudienceNode => {
    if (!isRecord(value)) {
      return relayParse(z.strictObject({}), value, ctx) as never;
    }
    if ("op" in value || "children" in value) {
      if (depth > AUDIENCE_MAX_DEPTH) {
        ctx.issues.push({
          code: "custom",
          message: `groups may nest at most ${String(AUDIENCE_MAX_DEPTH)} levels`,
          input: value,
        });
        return z.NEVER;
      }
      return relayParse(
        z.strictObject({
          op: z.enum(AUDIENCE_GROUP_OPS),
          children: z.array(nodeSchema(options, depth + 1)).min(1),
        }),
        value,
        ctx,
      );
    }
    const field = value.field;
    if (
      typeof field !== "string" ||
      !(options.fields as readonly string[]).includes(field)
    ) {
      return relayParse(
        z.looseObject({
          field: z.enum(options.fields as [AudienceField, ...AudienceField[]]),
        }),
        value,
        ctx,
      ) as never;
    }
    return relayParse(
      leafSchemaOf(field as AudienceField, options),
      value,
      ctx,
    );
  });
}

/** 頂層依 `mode` 分辨;不認得的 mode → 錯誤指到 `mode`。 */
function modeSchemaOf(value: unknown, options: AudienceOptions): z.ZodType {
  const mode = isRecord(value) ? value.mode : undefined;
  if (mode === "all" && options.allowAll) {
    return z.strictObject({ mode: z.literal("all") });
  }
  if (mode === "match") {
    return z.strictObject({
      mode: z.literal("match"),
      filter: nodeSchema(options, 1),
    });
  }
  return z.looseObject({
    mode: options.allowAll ? z.enum(["all", "match"]) : z.literal("match"),
  });
}

/**
 * 某個使用處的人員條件 schema(欄位、組織來源、能不能選「所有人」由呼叫端決定)。
 * 檢查:`mode` 只能是 all / match;`match` 至少一個條件列(空群組不允許);欄位只能用宣告的;
 * 值的格式符合欄位;群組最多 `AUDIENCE_MAX_DEPTH` 層。
 */
export function audienceSchema(options: AudienceOptions): z.ZodType<Audience> {
  return z
    .unknown()
    .transform(
      (value, ctx): Audience =>
        relayParse(modeSchemaOf(value, options), value, ctx) as Audience,
    );
}

/** 一個驗證問題:`path` 是從人員條件根開始的路徑(如 `filter.children[1].field`)。 */
export interface AudienceIssue {
  path: string;
  message: string;
}

export type AudienceValidation =
  { ok: true; audience: Audience } | { ok: false; issue: AudienceIssue };

/** zod 的路徑陣列 → `filter.children[1].value.values[0]`(與資料範圍 `RULE_INVALID.path` 同一種寫法)。 */
export function formatAudiencePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, segment) => {
    if (typeof segment === "number") {
      return `${text}[${String(segment)}]`;
    }
    const name = String(segment);
    return text === "" ? name : `${text}.${name}`;
  }, "");
}

/**
 * 驗證人員條件;回第一個問題(編輯器一次送一份,修掉再送),通過則回解析後的值。
 * `path` 指到出錯的條件列(含該列裡的哪一格)。
 */
export function validateAudience(
  input: unknown,
  options: AudienceOptions,
): AudienceValidation {
  const parsed = audienceSchema(options).safeParse(input);
  if (parsed.success) {
    return { ok: true, audience: parsed.data };
  }
  const [first] = parsed.error.issues;
  return {
    ok: false,
    issue: {
      path: formatAudiencePath(first?.path ?? []),
      message: first?.message ?? "invalid audience",
    },
  };
}
