import { useMemo } from "react";

import type { FormDefinition } from "@repo/domain/form";
import { useFormRuntimeVersionQuery } from "@repo/graphql";

import { definitionOf } from "@/lib/base/form-engine/definition";

import { useSession } from "./useSession";

/**
 * 填寫 / 詳情渲染要的版本定義(已發布或已退役版;api `formRuntimeVersion`,填寫者不需要
 * `system.forms.view`)。提交綁哪一版就讀哪一版 —— 改版不影響舊單的顯示。
 */
export const useFormRuntimeVersion = (
  formKey: string | null,
  version: number | null,
) => {
  const { session } = useSession();
  const query = useFormRuntimeVersionQuery(
    session.client,
    { formKey: formKey ?? "", version: version ?? 0 },
    {
      enabled: formKey !== null && version !== null,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );
  const raw = query.data?.formRuntimeVersion.formVersion;
  const definition = useMemo<FormDefinition | null>(
    () => (raw === undefined ? null : definitionOf(raw)),
    [raw],
  );
  return { definition, isLoading: query.isLoading, error: query.error };
};
