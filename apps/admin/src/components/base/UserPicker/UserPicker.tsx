import { UserPickerField, type UserPickerFieldProps } from "./UserPickerField";
import { useUserCandidates } from "./useUserCandidates";

/** 選人欄的設定(候選固定是 `useUserCandidates`)。 */
export type UserPickerProps = Omit<UserPickerFieldProps, "users">;

/**
 * 選一位使用者(流程的改派 / 新增審核者、使用者管理的複製組織與角色):
 * 候選 = 操作者管理範圍內的使用者,關鍵字丟回 api 查。
 * 停用的人預設列出但不能選;`allowDisabled` 時照常可選。
 */
export const UserPicker = (props: UserPickerProps) => {
  const users = useUserCandidates();
  return <UserPickerField {...props} users={users} />;
};
