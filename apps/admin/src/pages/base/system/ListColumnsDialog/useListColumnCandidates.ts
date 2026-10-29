import {
  type FieldType,
  fieldProtections,
  isProtected,
} from "@repo/domain/form";
import { useFormsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { useVersionDefinitions } from "@/hooks/base/useVersionDefinitions";

export interface FieldCandidate {
  formKey: string;
  formName: string;
  key: string;
  label: string;
  /** 欄位型別(組合欄的「插入欄位」給日期 / 日期時間多列格式快捷) */
  type: FieldType;
}

/**
 * 列表欄位配置可選的表單欄位(api 的寫入規則,docs/modules/forms.md「列表欄位配置」):
 * 該模組**共用表單**目前版本裡、**不是受保護欄位**(含只因依賴而受保護的計算欄位)的欄位;
 * 組合欄模板可插入的欄位也是這一份。
 */
export const useListColumnCandidates = (moduleKey: string) => {
  const { session } = useSession();
  const forms = useFormsQuery(session.client, {
    input: { moduleKey, page: 1, pageSize: 100 },
  });
  const shared = (forms.data?.forms.items ?? []).filter(
    (form) =>
      form.isShared &&
      form.currentVersion !== null &&
      form.currentVersion !== undefined,
  );
  const definitionOf = useVersionDefinitions(
    shared.map((form) => ({
      formKey: form.key,
      version: form.currentVersion ?? 0,
    })),
  );

  const candidates: FieldCandidate[] = shared.flatMap((form) => {
    const definition = definitionOf(form.key, form.currentVersion ?? 0);
    if (definition === undefined) {
      return [];
    }
    const protections = fieldProtections(definition.fields);
    return (
      definition.fields
        // 明細欄不能當列表欄(列表只顯示單值;api 同樣擋)
        .filter(
          (field) =>
            field.type !== "array" && !isProtected(protections.get(field.key)),
        )
        .map((field) => ({
          formKey: form.key,
          formName: form.name,
          key: field.key,
          label: field.label,
          type: field.type,
        }))
    );
  });

  /** 共用表單(有目前版本的;組合欄「限定表單」的選項) */
  const sharedForms = shared.map((form) => ({
    key: form.key,
    name: form.name,
  }));

  return { candidates, sharedForms, isLoading: forms.isLoading };
};
