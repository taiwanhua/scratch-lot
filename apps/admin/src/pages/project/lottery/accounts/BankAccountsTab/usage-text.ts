import type { LotteryBankAccountFieldsFragment } from "@repo/graphql";

type Translate = (key: string, values?: Record<string, string>) => string;

/** 使用組織的顯示:名稱以頓號接起;含下層的加註「(含下層)」;沒有設定 = 空字串。 */
export const usageText = (
  account: Pick<LotteryBankAccountFieldsFragment, "shareOrgs" | "usageOrgs">,
  t: Translate,
): string =>
  account.shareOrgs
    .map((entry) => {
      const name =
        account.usageOrgs.find((org) => org.id === entry.orgId)?.name ?? "";
      return entry.includeDescendants
        ? t("bankAccounts.includeDescendants", { name })
        : name;
    })
    .join("、");
