import { moneyText } from "../store-text";

/** 帶正負號的金額文字(「+ 14,550」「− 1,200」「0」;規格 6.9 逐項列出的寫法)。 */
export const signedMoneyText = (amount: number): string => {
  if (amount === 0) {
    return "0";
  }
  return `${amount > 0 ? "+" : "−"} ${moneyText(Math.abs(amount))}`;
};

/** 審核中的單據文字:「現金更正 #C-012 +500、撤銷售出 #R-008 −500」(交班精靈第 ③ 步、檢視頁共用)。 */
export const pendingImpactsText = (
  t: (key: string, values?: Record<string, string | number>) => string,
  impacts: readonly {
    formKey: string;
    serialNo?: string | null;
    amount: number;
  }[],
): string =>
  impacts
    .map((impact) =>
      t("drawer.pendingItem", {
        form: t(`forms.${impact.formKey}`),
        serialNo: impact.serialNo ?? "",
        amount: signedMoneyText(impact.amount),
      }),
    )
    .join("、");

/** Stepper 每一步的狀態(目前那一步之前 = 已完成)。 */
export const stepStatusOf = (
  index: number,
  current: number,
): "done" | "current" | "todo" => {
  if (index < current) {
    return "done";
  }
  return index === current ? "current" : "todo";
};
