import { useScheduleFieldOptionsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

export interface ScheduleFieldOption {
  value: string;
  label: string;
}

export interface ScheduleFieldOptions {
  options: ScheduleFieldOption[];
  /** 選項 value → 顯示名稱;找不到(選項已停用或刪除)時回 value 本身 */
  labelOf: (value: string) => string;
  isLoading: boolean;
}

/**
 * 班表管理的下拉選項(欄位管理的崗位、執行任務、特殊日類別…;類別 key 見
 * `@repo/domain/project/schedule-fields`)。只要登入即可讀,不需要欄位管理的權限。
 */
export const useScheduleFieldOptions = (
  categoryKey: string,
): ScheduleFieldOptions => {
  const { session } = useSession();
  const query = useScheduleFieldOptionsQuery(session.client, { categoryKey });
  const options = query.data?.scheduleFieldOptions.items ?? [];
  const labels = new Map(options.map((option) => [option.value, option.label]));
  return {
    options,
    labelOf: (value) => labels.get(value) ?? value,
    isLoading: query.isLoading,
  };
};
