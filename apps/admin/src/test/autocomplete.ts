import { screen } from "@testing-library/react";

/**
 * `@repo/ui/autocomplete` 的選項在測試裡怎麼點(TEST-08 的「Autocomplete 的兩行選項」)。
 *
 * 選項是**主文字 + 次文字**兩行(次文字放擁有組織、停用原因…),`getByRole("option", { name })`
 * 的完整比對因此對不上 —— 無障礙名稱會是兩行串起來的那一長串。一律只比對**主文字那一行**。
 *
 * 原本有三份各自的實作(角色的「加入使用者」、指派角色彈窗、資料範圍頁),
 * TEST-08 定的是「三份以內各自一份,第四處出現時上提」;「加入成員」是第四處,
 * 所以搬到這裡共用。
 */

/** 主文字那一行(`Typography variant="body2"`);抓不到就退回整個選項的文字。 */
const labelLineOf = (option: HTMLElement): string =>
  option.querySelector(".MuiTypography-body2")?.textContent ??
  option.textContent;

/**
 * 目前展開的選單裡,主文字命中 `text` 的那一列:**先比開頭、再比包含**。
 *
 * 兩段是因為主文字本身有兩種寫法:角色選單的主文字就是角色名(開頭即命中),
 * 而使用者選單的主文字是「帳號 · 姓名(組織)」,用姓名找時只能比包含。
 * 找不到就把現有選項印出來 —— 「選項沒出現」與「名字打錯」在斷言上長得一樣。
 */
export const autocompleteOption = (text: string): HTMLElement => {
  const options = screen.getAllByRole("option");
  const found =
    options.find((option) => labelLineOf(option).startsWith(text)) ??
    options.find((option) => labelLineOf(option).includes(text));
  if (found === undefined) {
    throw new Error(
      `找不到主文字含「${text}」的選項;目前有:${options
        .map((option) => labelLineOf(option))
        .join(" / ")}`,
    );
  }
  return found;
};

/** 打開某個 Autocomplete(以無障礙名稱找 combobox)並回傳展開後的選項。 */
export const openAutocomplete = async (
  actor: { click: (element: Element) => Promise<void> },
  name: string,
): Promise<HTMLElement[]> => {
  await actor.click(screen.getByRole("combobox", { name }));
  return screen.getAllByRole("option");
};
