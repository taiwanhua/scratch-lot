/**
 * 排序字串用的語系(正本在 `collation/`,STRUCT-10)。
 * 只用在「讓輸出順序穩定」的地方(依賴鏈、循環的簽章);表達式的 `<` / `>` 是字碼比較,不用它。
 */
export { COLLATION_LOCALE } from "../collation/compare-display-name";
