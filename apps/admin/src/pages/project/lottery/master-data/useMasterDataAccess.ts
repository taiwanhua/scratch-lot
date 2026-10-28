// 收銀點選單底部的「找不到?到欄位管理新增」連到底座的欄位管理模組
import { FIELD_MANAGER_MODULE_KEY } from "@/components/base/FieldManager/field-manager-permissions";
import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";

import {
  MASTER_DATA_MODULE_KEYS as KEYS,
  MASTER_DATA_PERMISSIONS as PERMISSIONS,
  PRINT_PERMISSION,
} from "./master-data-config";

export interface MasterDataAccess {
  /** 遊戲分頁(綁了 `master-data.games`) */
  hasGames: boolean;
  /** 收銀點分頁(綁了 `master-data.cash-points`) */
  hasCashPoints: boolean;
  listRoute: string | null;
  gameViewRoute: string | null;
  gameCreateRoute: string | null;
  gameEditRoute: string | null;
  /** [+ 新增遊戲]:有 `games.create` 且綁了新增頁 */
  canCreateGame: boolean;
  canCreateCashPoint: boolean;
  /** 收銀點的印表機選單(底座 `printablePrinters` 要 `api.printing.print`) */
  canPickPrinter: boolean;
  /** 「找不到?到欄位管理新增」的連結;沒有欄位管理就是 null */
  fieldManagerRoute: string | null;
}

/**
 * 檔案管理各頁共用的「進得去哪、做得了什麼」(ADR-0011):
 * 分頁與頁面看 `me.modules` 有沒有那個模組(本模組沒有 view 權限,規格 3.2),
 * 新增鈕看權限集;逐筆的編輯 / 刪除讀 api 的 `abilities`,不在這裡。
 */
export const useMasterDataAccess = (): MasterDataAccess => {
  const me = useMe();
  const { hasPermission } = usePermissions();
  const modules = me.data?.me.modules ?? [];
  const hasModule = (key: string) =>
    modules.some((module) => module.key === key);
  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;

  const gameCreateRoute = routeOf(KEYS.gameCreatePage);
  const hasCashPoints = hasModule(KEYS.cashPoints);
  return {
    hasGames: hasModule(KEYS.games),
    hasCashPoints,
    listRoute: routeOf(KEYS.list),
    gameViewRoute: routeOf(KEYS.gameViewPage),
    gameCreateRoute,
    gameEditRoute: routeOf(KEYS.gameEditPage),
    canCreateGame:
      gameCreateRoute !== null && hasPermission(PERMISSIONS.gamesCreate),
    canCreateCashPoint:
      hasCashPoints && hasPermission(PERMISSIONS.cashPointsCreate),
    canPickPrinter: hasPermission(PRINT_PERMISSION),
    fieldManagerRoute: routeOf(FIELD_MANAGER_MODULE_KEY),
  };
};
