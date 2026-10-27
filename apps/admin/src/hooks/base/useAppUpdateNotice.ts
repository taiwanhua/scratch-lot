import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useTranslations } from "use-intl";

import {
  createVersionChecker,
  fetchDeployedVersion,
  isGraphqlValidationFailed,
} from "@/lib/base/app-version";
import { useAppUpdateStore } from "@/stores/base/useAppUpdateStore";
import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

/** Vite 在 lazy chunk / 動態 import 載入失敗時發在 window 上的事件。 */
export const PRELOAD_ERROR_EVENT = "vite:preloadError";

/** QueryClient 的 `queryCache` / `mutationCache` 的 `onError` 交給它:查詢驗證失敗就回報舊版。 */
export const reportAppUpdateError = (error: unknown): void => {
  if (isGraphqlValidationFailed(error)) {
    useAppUpdateStore.getState().markOutdated();
  }
};

export interface UseAppUpdateNoticeOptions {
  /** 這個 bundle 的版本(build 時烘入);沒有(`vite dev`、mock 模式)= 整個機制不啟動 */
  currentVersion: string | undefined;
  /** 抓目前部署的版本(測試用;預設抓 `/version.json`) */
  fetchVersion?: () => Promise<string | null>;
  /** 按下 [重新整理](測試用;預設 `globalThis.location.reload()`) */
  reload?: () => void;
}

/**
 * 偵測到新版本時提示重新整理(掛在 `app/AppUpdateNotice.tsx`,登入前後都在)。
 *
 * - **檢查時機**:分頁回到前景(`visibilitychange`)一律抓;換路由時距上次檢查滿 1 分鐘才抓。不定時輪詢。
 * - **不比版本、直接提示**:lazy chunk 載入失敗(`vite:preloadError`)、api 回 `GRAPHQL_VALIDATION_FAILED`
 *   (後者經 `reportAppUpdateError` 接在 QueryClient 上)。
 * - **提示**:資訊色「系統已更新」+ [重新整理],不自動消失;同時只有一則 —— 畫面上已有就不再加,
 *   按 ✕ 關掉後,下一次觸發再顯示。
 */
export const useAppUpdateNotice = ({
  currentVersion,
  fetchVersion = fetchDeployedVersion,
  reload = () => {
    globalThis.location.reload();
  },
}: UseAppUpdateNoticeOptions): void => {
  const t = useTranslations("admin.app.update");
  const { pathname } = useLocation();
  const signal = useAppUpdateStore((state) => state.signal);
  const markOutdated = useAppUpdateStore((state) => state.markOutdated);
  const isEnabled = currentVersion !== undefined && currentVersion !== "";
  const noticeIdRef = useRef<number | null>(null);
  const checkerRef = useRef<ReturnType<typeof createVersionChecker> | null>(
    null,
  );
  // 文案與 reload 每次 render 都可能是新的;用 ref 取最新的,顯示提示的 effect 只跟著訊號跑
  const latestRef = useRef({ t, reload });
  useEffect(() => {
    latestRef.current = { t, reload };
  });

  useEffect(() => {
    if (!isEnabled) {
      checkerRef.current = null;
      return;
    }
    const checker = createVersionChecker({
      currentVersion,
      fetchVersion,
      onOutdated: markOutdated,
    });
    checkerRef.current = checker;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checker.check();
      }
    };
    const onPreloadError = () => {
      markOutdated();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener(PRELOAD_ERROR_EVENT, onPreloadError);
      checkerRef.current = null;
    };
  }, [isEnabled, currentVersion, fetchVersion, markOutdated]);

  // 換路由(第一次 render 是進站,不算)
  const previousPathRef = useRef(pathname);
  useEffect(() => {
    if (previousPathRef.current === pathname) {
      return;
    }
    previousPathRef.current = pathname;
    void checkerRef.current?.checkOnRoute();
  }, [pathname]);

  useEffect(() => {
    if (!isEnabled || signal === 0) {
      return;
    }
    const { items, show } = useSnackbarStore.getState();
    if (items.some((item) => item.id === noticeIdRef.current)) {
      return;
    }
    const { t: translate, reload: doReload } = latestRef.current;
    noticeIdRef.current = show("info", translate("message"), {
      autoHideDuration: null,
      action: {
        label: translate("reload"),
        onClick: () => {
          doReload();
        },
      },
    });
  }, [isEnabled, signal]);
};
