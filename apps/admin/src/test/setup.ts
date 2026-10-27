import "@testing-library/jest-dom/jest-globals";

import { afterAll, afterEach, beforeAll } from "@jest/globals";
import { cleanup, configure } from "@testing-library/react";

import { defaultLocale } from "@repo/i18n";

import { INITIAL_SESSION_SNAPSHOT } from "../lib/base/auth/session-store";
import { LOCALE_STORAGE_KEY } from "../lib/base/locale";
import { useAppUpdateStore } from "../stores/base/useAppUpdateStore";
import { useDesignerDraftStore } from "../stores/base/useDesignerDraftStore";
import {
  INITIAL_DESIGNER_DRAWER,
  useDesignerDrawerStore,
} from "../stores/base/useDesignerDrawerStore";
import { useLocaleStore } from "../stores/base/useLocaleStore";
import { useSessionStore } from "../stores/base/useSessionStore";
import {
  LEGACY_SIDE_NAV_STORAGE_KEY,
  SIDE_NAV_STORAGE_KEY,
  useSideNavStore,
} from "../stores/base/useSideNavStore";
import { useSnackbarStore } from "../stores/base/useSnackbarStore";
import {
  INITIAL_WORKFLOW_DRAFT,
  useWorkflowDraftStore,
} from "../stores/base/useWorkflowDraftStore";
import { resetHelpFiles } from "./help-registry";
import { server } from "./msw/server";

// `findBy*` / `waitFor` 的預設 1 秒在 CI runner 上不夠:一頁可能串好幾個查詢(樹 → 單筆 → 清單),
// 每一段都要等 MSW 回來再重新渲染。放寬到 5 秒,理由同 preset 把 testTimeout 放寬到 15 秒(TEST-08);
// 逾時只影響「失敗要等多久」,成功的測試不會因此變慢。
configure({ asyncUtilTimeout: 5000 });

// TEST-03:前端 mock 在網路層 — 每個測試檔都掛 MSW,未被 handler 接住的請求直接視為錯誤
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  server.events.removeAllListeners();
  // zustand store 是模組層單例(重構前登入狀態與語言各自掛在每次 renderApp 新建的物件上),每個測試後歸零;
  // 路由頁籤 store 不需要:殼 mount 時 `bind` 一律以 sessionStorage 覆蓋,測試各自 `sessionStorage.clear()`
  useSessionStore.setState(INITIAL_SESSION_SNAPSHOT);
  useLocaleStore.setState({ locale: defaultLocale });
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  // 側欄收合也是模組層單例:收合過的測試不能讓下一個測試一開始就是圖示列
  useSideNavStore.setState({ isCollapsed: false });
  localStorage.removeItem(SIDE_NAV_STORAGE_KEY);
  // 舊 key 也清:驗搬移的測試會塞它,留著會被下一個測試搬進新 key
  if (LEGACY_SIDE_NAV_STORAGE_KEY !== null) {
    localStorage.removeItem(LEGACY_SIDE_NAV_STORAGE_KEY);
  }
  // 操作結果提示也是模組層單例:上一個測試留下的那一則不能跟著進下一個測試
  useSnackbarStore.getState().reset();
  // 新版本提示的訊號也是模組層單例
  useAppUpdateStore.getState().reset();
  // 模組說明的假 registry 也是模組層單例;改過的測試不影響下一個
  resetHelpFiles();
  // 表單設計器的「未存變更」回報也是模組層單例
  useDesignerDraftStore.setState({ formKey: null, isDirty: false, save: null });
  // 流程設計器的「未存變更」回報同理
  useWorkflowDraftStore.setState(INITIAL_WORKFLOW_DRAFT);
  // 設計器屬性抽屜的開關回報同理
  useDesignerDrawerStore.setState(INITIAL_DESIGNER_DRAWER);
  // `useUrlState`(nuqs)寫入時也改 `window.history`:網址列回到起點,不讓上一個測試的網址參數漏進下一個
  globalThis.history.replaceState(null, "", "/");
});

afterAll(() => {
  server.close();
});
