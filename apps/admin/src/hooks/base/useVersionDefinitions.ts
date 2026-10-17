import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { FormDefinition } from "@repo/domain/form";
import { useFormRuntimeVersionQuery } from "@repo/graphql";

import { definitionOf } from "@/lib/base/form-engine/definition";

import { useSession } from "./useSession";

export interface VersionRef {
  formKey: string;
  version: number;
}

const refKeyOf = (ref: VersionRef): string =>
  `${ref.formKey}@${String(ref.version)}`;

/**
 * 一頁提交裡出現過的每個(表單, 版本)各取一次定義(列表的表單欄位欄要知道那一筆綁的版本有沒有這一欄、
 * 靜態選項的 label)。同一版只查一次,之後永不過期(已發布的版本凍結)。
 */
export const useVersionDefinitions = (refs: readonly VersionRef[]) => {
  const { session } = useSession();
  const unique = useMemo(() => {
    const seen = new Map<string, VersionRef>();
    for (const ref of refs) {
      seen.set(refKeyOf(ref), ref);
    }
    return [...seen.values()];
  }, [refs]);

  const results = useQueries({
    queries: unique.map((ref) => {
      const variables = { formKey: ref.formKey, version: ref.version };
      return {
        queryKey: useFormRuntimeVersionQuery.getKey(variables),
        queryFn: useFormRuntimeVersionQuery.fetcher(session.client, variables),
        staleTime: Number.POSITIVE_INFINITY,
      };
    }),
  });

  const definitions = new Map<string, FormDefinition>();
  for (const [index, ref] of unique.entries()) {
    const raw = results[index]?.data?.formRuntimeVersion.formVersion;
    if (raw !== undefined) {
      definitions.set(refKeyOf(ref), definitionOf(raw));
    }
  }

  return (formKey: string, version: number): FormDefinition | undefined =>
    definitions.get(refKeyOf({ formKey, version }));
};
