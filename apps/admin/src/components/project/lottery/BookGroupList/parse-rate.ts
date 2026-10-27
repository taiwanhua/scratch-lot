/** 批購金額率的輸入 → 整數 0–100;不合 → null(不改)。 */
export const parseRate = (raw: string): number | null => {
  const value = Number(raw);
  return raw.trim() !== "" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
};
