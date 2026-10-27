import { useLotteryFieldOptionsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

export interface LotteryFieldOption {
  value: string;
  label: string;
}

export interface LotteryFieldOptions {
  options: LotteryFieldOption[];
  /** 選項 value → 顯示名稱;找不到(選項已停用或刪除)時回 value 本身 */
  labelOf: (value: string) => string;
  isLoading: boolean;
}

/**
 * 刮刮樂的下拉選項(欄位管理的尋回原因、報廢原因、更正跳號原因…;類別 key 見
 * `@repo/domain/project/lottery-fields`)。只要登入即可讀,不需要欄位管理的權限。
 */
export const useLotteryFieldOptions = (
  categoryKey: string,
): LotteryFieldOptions => {
  const { session } = useSession();
  const query = useLotteryFieldOptionsQuery(session.client, { categoryKey });
  const options = query.data?.lotteryFieldOptions.items ?? [];
  const labels = new Map(options.map((option) => [option.value, option.label]));
  return {
    options,
    labelOf: (value) => labels.get(value) ?? value,
    isLoading: query.isLoading,
  };
};
