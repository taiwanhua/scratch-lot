import { useTranslations } from "use-intl";

import {
  type FormError,
  isCapacityError,
} from "@/lib/base/form-engine/form-errors";

import { useSnackbar } from "./useMutationFeedback";

/**
 * 提交的容量上限(修訂次數 / 文件大小,docs/modules/forms.md「錯誤」)以 Snackbar 告知:
 * 這兩種不是欄位錯、也不是「被別人更新」,重新載入沒用,要使用者換一種做法(建新的申請 / 縮減內容)。
 * 回傳的函式對其他錯誤什麼都不做(那些照舊在表單下方的提示顯示)。
 */
export const useCapacityErrorSnackbar = (): ((error: FormError) => void) => {
  const tErrors = useTranslations("admin.formEngine.errors");
  const showSnackbar = useSnackbar();
  return (error) => {
    if (isCapacityError(error)) {
      showSnackbar("error", tErrors(error.code));
    }
  };
};
