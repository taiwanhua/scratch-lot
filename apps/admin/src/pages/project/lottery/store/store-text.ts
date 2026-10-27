/** 金額顯示(千分位;負數帶負號)。 */
export const moneyText = (value: number): string =>
  value.toLocaleString("en-US");
