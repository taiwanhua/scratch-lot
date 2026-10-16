import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useTranslations } from "use-intl";

import {
  type MyPreferencesQuery,
  type UpdateMyPreferencesMutation,
  useMyPreferencesQuery,
  useUpdateMyPreferencesMutation,
} from "@repo/graphql";
import type { Locale } from "@repo/i18n";

import { ACCOUNT_LOCALE_KEY, resolveAccountLocale } from "@/lib/base/locale";
import { useLocaleStore } from "@/stores/base/useLocaleStore";

import { useMutationFeedback } from "./useMutationFeedback";
import { useSession } from "./useSession";

/**
 * 我的個人偏好(`myPreferences`):進殼取一次(登出時 SessionProvider 清快取,換帳號登入會重取)。
 * 失敗不重試:語言退回本機快取照常進站,不讓偏好擋住整個後台。
 */
const useMyPreferences = (enabled: boolean) => {
  const { session, snapshot } = useSession();
  return useMyPreferencesQuery(session.client, undefined, {
    enabled: enabled && snapshot.status === "authenticated",
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    retryOnMount: false,
  });
};

/** 改寫快取裡我的偏好的語言(切換語言時先寫,同一次登入裡再進殼不會被舊值蓋回去)。 */
const useSetCachedAccountLocale = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (locale: Locale) => {
      queryClient.setQueryData<MyPreferencesQuery>(
        useMyPreferencesQuery.getKey(),
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                myPreferences: {
                  ...current.myPreferences,
                  settings: {
                    ...current.myPreferences.settings,
                    [ACCOUNT_LOCALE_KEY]: locale,
                  },
                },
              },
      );
    },
    [queryClient],
  );
};

/**
 * 寫入個人偏好的 mutation 共用同一個 scope:連續快速切語言時請求依序送出,
 * 帳號最後存的就是畫面上最後選的那一個(不會被先送晚到的請求蓋掉)。
 */
const PREFERENCES_WRITE_SCOPE = { id: "update-my-preferences" };

/**
 * 登入後把語言對齊帳號(規格 10.6;I18N-05):殼在偏好回來前顯示載入中(用本機快取的語言),
 * 回來後依 `resolveAccountLocale` —— 帳號有設定就用帳號的並覆寫本機快取;沒有就沿用快取並寫回帳號
 * (背景寫回,成功失敗都不提示)。
 *
 * 回傳 `isSettled`:偏好已回來(或失敗)**而且語言已經換好**。要換語言的那一次 render 仍回 false
 * (在 render 階段就算出結果,不等 effect),殼第一次掛載就是帳號的語言,不會先提交一次快取的語言再換。
 * `enabled`:`me` 載入成功才查(`me` 失敗時殼已顯示錯誤,不必再多打一支)。
 */
export const useAccountLocaleSync = (
  enabled: boolean,
): { isSettled: boolean } => {
  const { session } = useSession();
  const preferences = useMyPreferences(enabled);
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const setCached = useSetCachedAccountLocale();
  const { mutate } = useUpdateMyPreferencesMutation(session.client, {
    scope: PREFERENCES_WRITE_SCOPE,
    ...useMutationFeedback<UpdateMyPreferencesMutation>({
      success: null,
      error: () => null,
    }),
  });

  const { data } = preferences;
  const decision =
    data === undefined
      ? undefined
      : resolveAccountLocale(
          data.myPreferences.settings[ACCOUNT_LOCALE_KEY],
          locale,
        );

  const decidedLocale = decision?.locale;
  const needsWriteBack = decision?.writeBack === true;
  useEffect(() => {
    if (decidedLocale === undefined) {
      return;
    }
    setLocale(decidedLocale);
    if (needsWriteBack) {
      setCached(decidedLocale);
      mutate({ input: { settings: { [ACCOUNT_LOCALE_KEY]: decidedLocale } } });
    }
  }, [decidedLocale, needsWriteBack, setLocale, setCached, mutate]);

  const isApplied = decidedLocale === undefined || decidedLocale === locale;
  return {
    isSettled: preferences.isError || (data !== undefined && isApplied),
  };
};

/**
 * 頭像選單的「語言」:立即生效(本機快取),同時寫入帳號;寫入失敗 → 畫面維持新語言、跳失敗提示,
 * 下次登入以帳號為準(規格 10.6 情境表)。成功不提示:畫面已經換好,沒有「還沒完成」的東西要告訴使用者。
 */
export const useChangeLocale = () => {
  const t = useTranslations("admin.shell.userMenu");
  const { session } = useSession();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const setCached = useSetCachedAccountLocale();
  const { mutate } = useUpdateMyPreferencesMutation(session.client, {
    scope: PREFERENCES_WRITE_SCOPE,
    ...useMutationFeedback<UpdateMyPreferencesMutation>({
      success: null,
      error: () => t("localeSaveFailed"),
    }),
  });

  return useCallback(
    (next: Locale) => {
      setLocale(next);
      setCached(next);
      mutate({ input: { settings: { [ACCOUNT_LOCALE_KEY]: next } } });
    },
    [setLocale, setCached, mutate],
  );
};
