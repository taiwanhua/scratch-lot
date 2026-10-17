/**
 * 主從版面「選中哪一筆」的推導(純函式,`useListSelection` 用):
 *
 * - 指定的 key 在清單裡 → 就是它
 * - 不在清單裡,但清單還在查(`isFetching`)或正在等清單把剛建立 / fork 的那一筆帶回來(`isAwaiting`)
 *   → 維持指定的 key,`isPending` 為真(右欄顯示載入中,不先閃第一筆)
 * - 清單查完了還是沒有(手改網址、被收回、已刪除)→ 退回第一筆
 */
export interface ListSelectionInput {
  pickedKey: string | null;
  keys: readonly string[];
  isFetching: boolean;
  isAwaiting: boolean;
}

export interface ListSelection {
  selectedKey: string | null;
  /** 指定的那一筆還沒出現在清單上,正在等清單更新 */
  isPending: boolean;
}

export const resolveListSelection = ({
  pickedKey,
  keys,
  isFetching,
  isAwaiting,
}: ListSelectionInput): ListSelection => {
  if (pickedKey === null) {
    return { selectedKey: keys.at(0) ?? null, isPending: false };
  }
  if (keys.includes(pickedKey)) {
    return { selectedKey: pickedKey, isPending: false };
  }
  if (isFetching || isAwaiting) {
    return { selectedKey: pickedKey, isPending: true };
  }
  return { selectedKey: keys.at(0) ?? null, isPending: false };
};
