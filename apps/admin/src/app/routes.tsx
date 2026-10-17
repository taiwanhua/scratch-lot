import { Route, Routes } from "react-router";

import {
  CHANGE_PASSWORD_PATH,
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  PERSONAL_SETTINGS_PATH,
  SET_PASSWORD_PATH,
} from "../lib/base/paths";
import { ChangePasswordPage } from "../pages/base/auth/ChangePasswordPage/ChangePasswordPage";
import { ForgotPasswordPage } from "../pages/base/auth/ForgotPasswordPage/ForgotPasswordPage";
import { LoginPage } from "../pages/base/auth/LoginPage/LoginPage";
import { SetPasswordPage } from "../pages/base/auth/SetPasswordPage/SetPasswordPage";
import { PersonalSettingsPage } from "../pages/base/personal-settings/PersonalSettingsPage/PersonalSettingsPage";
import { AdminShell } from "./AdminShell/AdminShell";
import { ModuleRoute } from "./guards/ModuleRoute/ModuleRoute";
import { RequireAuth } from "./guards/RequireAuth";
import { modulePageMinWidths, modulePages } from "./module-pages";

/**
 * 路由表(#61「admin — 三頁與殼」):
 * - 公開:/login、/forgot-password、/set-password(登入線7)
 * - 已登入者的 /change-password(首登強改也走它;守門在 RequireAuth)
 * - 受保護:殼(`AdminShell`)包住 `/` 與所有模組路由;路由由 `me.modules` 決定(ADR-0011「路由與導向規則」):
 *   `/` 轉到側欄第一個能進的頁、模組路由顯示該模組頁面(`module-pages.tsx` 登記,否則佔位頁)、其餘無權限頁
 * - 殼層路由 `/settings/personal`(個人設定;規格 10.6):不是模組、不看權限,所有登入者都能開
 */
export const AppRoutes = () => (
  <Routes>
    <Route path={LOGIN_PATH} element={<LoginPage />} />
    <Route path={FORGOT_PASSWORD_PATH} element={<ForgotPasswordPage />} />
    <Route path={SET_PASSWORD_PATH} element={<SetPasswordPage />} />
    <Route
      path={CHANGE_PASSWORD_PATH}
      element={
        <RequireAuth>
          <ChangePasswordPage />
        </RequireAuth>
      }
    />
    <Route
      path="/"
      element={
        <RequireAuth>
          <AdminShell pageMinWidths={modulePageMinWidths} />
        </RequireAuth>
      }
    >
      <Route index element={<ModuleRoute pages={modulePages} />} />
      <Route path={PERSONAL_SETTINGS_PATH} element={<PersonalSettingsPage />} />
      <Route path="*" element={<ModuleRoute pages={modulePages} />} />
    </Route>
  </Routes>
);
