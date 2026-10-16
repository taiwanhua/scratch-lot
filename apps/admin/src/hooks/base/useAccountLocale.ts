import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import {
  type MyPreferencesQuery,
  useMyPreferencesQuery,
  useUpdateMyPreferencesMutation,
} from "@repo/graphql";
import type { Locale } from "@repo/i18n";

import { ACCOUNT_LOCALE_KEY, resolveAccountLocale } from "@/lib/base/locale";
import { useLocaleStore } from "@/stores/base/useLocaleStore";

import { useSnackbar } from "./useMutationFeedback";
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
 * 登入後把語言對齊帳號(規格 10.6;I18N-05):殼在偏好回來前顯示載入中(用本機快取的語言),
 * 回來後依 `resolveAccountLocale` —— 帳號有設定就用帳號的並覆寫本機快取;沒有就沿用快取並寫回帳號(寫回失敗不提示)。
 * 回傳 `isSettled`:偏好已回來(或失敗)、語言已定,殼可以開始渲染,第一個畫面就是對的語言。
 * `enabled`:`me` 載入成功才查(`me` 失敗時殼已顯示錯誤,不必再多打一支)。
 */
export const useAccountLocaleSync = (
  enabled: boolean,
): { isSettled: boolean } => {
  const { session } = useSession();
  const preferences = useMyPreferences(enabled);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const setCached = useSetCachedAccountLocale();
  const writeBack = useUpdateMyPreferencesMutation(session.client);
  const { mutate } = writeBack;
  const appliedFor = useRef<MyPreferencesQuery | null>(null);

  const { data } = preferences;
  useEffect(() => {
    if (data === undefined || appliedFor.current === data) {
      return;
    }
    appliedFor.current = data;
    const decision = resolveAccountLocale(
      data.myPreferences.settings[ACCOUNT_LOCALE_KEY],
      useLocaleStore.getState().locale,
    );
    setLocale(decision.locale);
    if (decision.writeBack) {
      setCached(decision.locale);
      mutate({
        input: { settings: { [ACCOUNT_LOCALE_KEY]: decision.locale } },
      });
    }
  }, [data, setLocale, setCached, mutate]);

  return { isSettled: preferences.isError || data !== undefined };
};

/**
 * 頭像選單的「語言」:立即生效(本機快取),同時寫入帳號;寫入失敗 → 畫面維持新語言、跳失敗提示,
 * 下次登入以帳號為準(規格 10.6 情境表)。
 */
export const useChangeLocale = () => {
  const t = useTranslations("admin.shell.userMenu");
  const { session } = useSession();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const setCached = useSetCachedAccountLocale();
  const showSnackbar = useSnackbar();
  const { mutate } = useUpdateMyPreferencesMutation(session.client, {
    onError: () => {
      showSnackbar("error", t("localeSaveFailed"));
    },
  });

  return useCallback(
    (locale: Locale) => {
      setLocale(locale);
      setCached(locale);
      mutate({ input: { settings: { [ACCOUNT_LOCALE_KEY]: locale } } });
    },
    [setLocale, setCached, mutate],
  );
};
