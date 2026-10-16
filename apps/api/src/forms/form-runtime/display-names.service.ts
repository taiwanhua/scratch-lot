import { Injectable } from "@nestjs/common";

import {
  type FieldDef,
  type LookupSourceDescriptor,
  type StoredValues,
  arrayColumnsOf,
  arrayRowsOf,
  columnPathOf,
  lookupLabelFieldsOf,
} from "@repo/domain/form";

import { FieldCategoryOptionsService } from "../field-category-options.service";
import type { FormOperatorFacts } from "../form-access.service";
import { REDACTED } from "../form-values/stored-values";
import {
  LookupProvidersService,
  hasLookupField,
  lookupDisplayLabelOf,
  lookupValueOf,
} from "../lookup-providers";
import type {
  FormDisplayItem,
  FormDisplayValue,
} from "./models/form-submission.model";

/** 一筆要解析顯示名的提交(值已投影:被遮蔽的欄位不解析)。 */
export interface DisplayNameEntry {
  fields: readonly FieldDef[];
  values: StoredValues;
}

interface StoredItem {
  value: string;
  label: string | null;
  custom: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 選項 / 引用欄存的每一項(`{ value, label }` / `{ id, label }`)。 */
function storedItemsOf(field: FieldDef, stored: unknown): StoredItem[] {
  if (
    [null, undefined, REDACTED].includes(stored as string | null | undefined)
  ) {
    return [];
  }
  const list = Array.isArray(stored) ? stored : [stored];
  return list.flatMap((item): StoredItem[] => {
    if (!isRecord(item)) {
      return [];
    }
    const key = field.type === "reference" ? item.id : item.value;
    if (typeof key !== "string") {
      return [];
    }
    return [
      {
        value: key,
        label: typeof item.label === "string" ? item.label : null,
        custom: item.custom === true,
      },
    ];
  });
}

/** 要解析顯示名的一格:一般欄位本身,或明細子欄(`items.status`,值 = 各列該子欄的值)。 */
interface DisplayTarget {
  field: FieldDef;
  stored: unknown;
}

/**
 * 一筆提交要解析顯示名的目標:一般欄位照舊;明細欄的單選 / 引用子欄攤成一個 `<明細 key>.<子欄 key>` 的目標,
 * 值 = 各列該子欄的值(去重)。被遮蔽的明細(`"[redacted]"`)沒有列,不解析。
 */
function displayTargetsOf(entry: DisplayNameEntry): DisplayTarget[] {
  return entry.fields.flatMap((field): DisplayTarget[] => {
    if (field.type !== "array") {
      return [{ field, stored: entry.values[field.key] }];
    }
    const rows = arrayRowsOf(entry.values[field.key]);
    return arrayColumnsOf(field)
      .filter(
        (column) => column.type === "select" || column.type === "reference",
      )
      .map((column) => {
        const seen = new Set<string>();
        const cells = rows
          .map((row) => row[column.key])
          .filter((cell) => {
            // 引用比 id(label 快照不同的同一筆只解析一次);選項比整個存值
            const identity =
              column.type === "reference" && isRecord(cell)
                ? String(cell.id)
                : JSON.stringify(cell ?? null);
            if (cell === null || cell === undefined || seen.has(identity)) {
              return false;
            }
            seen.add(identity);
            return true;
          });
        return {
          field: { ...column, key: columnPathOf(field.key, column.key) },
          stored: cells.length === 0 ? null : cells,
        };
      });
  });
}

/** 一個 lookup 來源描述的識別(同一個來源的值一次查完)。 */
function sourceSignature(
  source: LookupSourceDescriptor,
  field: string,
): string {
  return JSON.stringify([
    source.provider,
    source.formKey ?? null,
    source.completedOnly ?? null,
    source.filter ?? null,
    field,
    source.labelField,
    source.labelTemplate ?? null,
  ]);
}

type Resolver =
  | { kind: "category"; key: string }
  | { kind: "lookup"; source: LookupSourceDescriptor; field: string };

function resolverOf(field: FieldDef): Resolver | null {
  if (field.type === "reference" && field.source) {
    return { kind: "lookup", source: field.source, field: "id" };
  }
  if (field.type !== "select" && field.type !== "multiSelect") {
    return null;
  }
  if (field.options?.kind === "fieldCategory") {
    return { kind: "category", key: field.options.key };
  }
  if (field.options?.kind === "lookup") {
    return {
      kind: "lookup",
      source: field.options.source,
      field: field.options.source.valueField ?? "id",
    };
  }
  return null;
}

interface LookupGroup {
  source: LookupSourceDescriptor;
  field: string;
  values: Set<string>;
}

/** 整頁要解析的值依來源分組(類別 key、lookup 來源各一組)。 */
function groupsOf(entries: readonly DisplayNameEntry[]): {
  categoryKeys: Set<string>;
  lookupGroups: Map<string, LookupGroup>;
} {
  const categoryKeys = new Set<string>();
  const lookupGroups = new Map<string, LookupGroup>();
  for (const entry of entries) {
    for (const { field, stored } of displayTargetsOf(entry)) {
      const resolver = resolverOf(field);
      const items = storedItemsOf(field, stored);
      if (!resolver || items.length === 0) {
        continue;
      }
      if (resolver.kind === "category") {
        categoryKeys.add(resolver.key);
        continue;
      }
      const signature = sourceSignature(resolver.source, resolver.field);
      const group = lookupGroups.get(signature) ?? {
        source: resolver.source,
        field: resolver.field,
        values: new Set<string>(),
      };
      for (const item of items.filter((candidate) => !candidate.custom)) {
        group.values.add(item.value);
      }
      lookupGroups.set(signature, group);
    }
  }
  return { categoryKeys, lookupGroups };
}

/**
 * 顯示名怎麼決定(Spec 6a §5「顯示名怎麼決定(現名 vs 快照)」):類別 / lookup 選項與引用 ——
 * 來源還在且讀的人有權讀到 → **現名**;來源已刪或讀的人無權 → 快照 label + `available: false`。
 *
 * **批次**(DataLoader 的做法,不逐列查):先把整頁每一筆、每一欄要解析的值依來源分組,
 * 每個類別 / 每個 lookup 來源只查一次,再分回各筆。靜態選項的 label 從該筆綁的版本定義取,不在這裡。
 * 明細的類別 / lookup 選項子欄與引用子欄以 `fieldKey = "<明細 key>.<子欄 key>"` 回一組(各列的值合在一起;
 * 引用子欄同一來源的 id 一次查完)。
 */
@Injectable()
export class DisplayNamesService {
  constructor(
    private readonly categories: FieldCategoryOptionsService,
    private readonly lookups: LookupProvidersService,
  ) {}

  /** 每個類別一次:value → 現名(合併範圍內的選項;停用的也算「來源還在」)。 */
  private async categoryLabels(
    facts: FormOperatorFacts,
    keys: ReadonlySet<string>,
  ): Promise<Map<string, ReadonlyMap<string, string>>> {
    const labels = new Map<string, ReadonlyMap<string, string>>();
    for (const key of keys) {
      const options = await this.categories.options(facts.operator, key);
      labels.set(
        key,
        new Map([...options].map(([value, option]) => [value, option.label])),
      );
    }
    return labels;
  }

  /** 每個 lookup 來源一次:值 → 現名(讀不到的不在表裡 = 來源不可用)。 */
  private async lookupLabels(
    facts: FormOperatorFacts,
    groups: ReadonlyMap<string, LookupGroup>,
  ): Promise<Map<string, ReadonlyMap<string, string | null>>> {
    const labels = new Map<string, ReadonlyMap<string, string | null>>();
    for (const [signature, group] of groups) {
      const records = await this.lookups.findByValues(
        facts,
        group.source,
        group.field,
        [...group.values],
        lookupLabelFieldsOf(group.source),
      );
      // 讀得到那筆、但顯示欄因受保護被省略 → 不算「現名可用」(不在表裡 = 快照 + available false)
      labels.set(
        signature,
        new Map(
          records
            .filter((record) => hasLookupField(record, group.source.labelField))
            .map((record) => [
              String(lookupValueOf(record, group.field)),
              lookupDisplayLabelOf(record, group.source),
            ]),
        ),
      );
    }
    return labels;
  }

  async resolve(
    facts: FormOperatorFacts,
    entries: readonly DisplayNameEntry[],
  ): Promise<FormDisplayValue[][]> {
    const { categoryKeys, lookupGroups } = groupsOf(entries);
    const categoryLabels = await this.categoryLabels(facts, categoryKeys);
    const lookupLabels = await this.lookupLabels(facts, lookupGroups);

    return entries.map((entry) =>
      displayTargetsOf(entry).flatMap(
        ({ field, stored }): FormDisplayValue[] => {
          const resolver = resolverOf(field);
          const items = storedItemsOf(field, stored);
          if (!resolver || items.length === 0) {
            return [];
          }
          const current =
            resolver.kind === "category"
              ? categoryLabels.get(resolver.key)
              : lookupLabels.get(
                  sourceSignature(resolver.source, resolver.field),
                );
          return [
            {
              fieldKey: field.key,
              items: items.map((item): FormDisplayItem => {
                if (item.custom) {
                  return {
                    value: item.value,
                    label: item.label,
                    available: true,
                  };
                }
                const name = current?.get(item.value);
                return name === undefined
                  ? { value: item.value, label: item.label, available: false }
                  : { value: item.value, label: name, available: true };
              }),
            },
          ];
        },
      ),
    );
  }
}
