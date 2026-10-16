import {
  type ApplicableFormsQuery,
  useApplicableFormsQuery,
} from "@repo/graphql";

import { useSession } from "./useSession";

export type ApplicableModule = ApplicableFormsQuery["applicableForms"][number];

/**
 * 申請中心「新申請」的選單(Spec 6b §7 `applicableForms`):我有 `create`、此刻可新增、且本租戶綁了流程的表單,
 * 依模組分組。也拿來當兩個頁籤的「模組 / 表單」篩選選項。
 */
export const useApplicableForms = () => {
  const { session } = useSession();
  const query = useApplicableFormsQuery(session.client);
  return {
    modules: query.data?.applicableForms ?? [],
    isLoading: query.isLoading,
  };
};
