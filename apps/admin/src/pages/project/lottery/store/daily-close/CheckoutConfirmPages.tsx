import { useTranslations } from "use-intl";
import { z } from "zod";

import { CHECKOUT_TYPE } from "@repo/domain/project/lottery";
import { useLotteryCheckoutQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";

import {
  CheckoutCreatePage,
  CheckoutEditPage,
} from "../checkout/CheckoutWizardPage";
import {
  DailyCloseCreatePage,
  DailyCloseEditPage,
} from "./DailyCloseWizardPage";
import {
  DAILY_CLOSE_PREFILL,
  DAILY_CLOSE_TYPE_VALUE,
} from "./daily-close-keys";

const textSchema = z.string().default("");

/**
 * 結帳確認申請的新增頁(交班 / 日結同一張表單):`?type=daily` → 日結精靈(看板 [日結]);
 * 其他 → 交班精靈(看板 [交班結帳],`?shift=`)。
 */
export const CheckoutConfirmCreatePage = () => {
  const [type] = useUrlState(DAILY_CLOSE_PREFILL.type, textSchema);
  return type === DAILY_CLOSE_TYPE_VALUE ? (
    <DailyCloseCreatePage />
  ) : (
    <CheckoutCreatePage />
  );
};

/** 已退回的結帳確認申請:依結帳單的類型打開日結精靈或交班精靈(帶入原內容)。 */
export const CheckoutConfirmEditPage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { session } = useSession();
  const id = props.routeParam ?? "";
  const detail = useLotteryCheckoutQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  if (detail.isError) {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  const type = detail.data?.lotteryCheckout.type ?? null;
  if (type === null) {
    return null;
  }
  return type === CHECKOUT_TYPE.daily ? (
    <DailyCloseEditPage {...props} />
  ) : (
    <CheckoutEditPage {...props} />
  );
};
