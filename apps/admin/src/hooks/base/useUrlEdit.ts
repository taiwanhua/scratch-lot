import { useCallback, useEffect } from "react";
import { useTranslations } from "use-intl";

import { useSnackbar } from "./useMutationFeedback";
import { useUrlSelectedId } from "./useUrlSelectedId";

/** 編輯彈窗打開的那一筆:`?edit=<id>`(REACT-14;只記 id,彈窗內容不進網址)。 */
export const EDIT_URL_KEY = "edit";

export interface UrlEdit {
  /** 網址上要編輯的那一筆(還沒驗權限、還沒確認存在);沒有 = null */
  requestedId: string | null;
  open: (id: string) => void;
  /** 關閉彈窗(取消、存完)= 以 `replace` 清掉 `?edit=` */
  close: () => void;
}

/**
 * 編輯彈窗記在網址(REACT-14 的編輯彈窗情境表):網址只記那一筆的 id,打開時由呼叫端用 id
 * 向伺服器讀最新資料來填;新增彈窗、確認類彈窗(刪除 / 停用 / 撤銷)不進網址。
 * 重新整理、分享網址、切路由頁籤再切回來(頁籤記住參數)彈窗都跟著回來。
 *
 * 讀到 `requestedId` 後,呼叫端以它查那一筆,再交給 `useUrlEditGuard` 決定開不開。
 */
export const useUrlEdit = (): UrlEdit => {
  const [requestedId, setEditId] = useUrlSelectedId(EDIT_URL_KEY);
  const open = useCallback(
    (id: string) => {
      setEditId(id);
    },
    [setEditId],
  );
  const close = useCallback(() => {
    setEditId(null);
  }, [setEditId]);
  return { requestedId, open, close };
};

/**
 * `useUrlEditGuard` 的 `canEdit`:頁面層沒有編輯權限 → `false`(不必等那一筆回來);
 * 有 → 看那一筆自己的能力(`abilities`,還沒回來是 `undefined`)。
 */
export const editAbilityOf = (
  hasPermission: boolean,
  itemCanEdit: boolean | undefined,
): boolean | undefined => (hasPermission ? itemCanEdit : false);

export interface UrlEditGuardOptions {
  edit: UrlEdit;
  /**
   * 能不能編輯網址上的那一筆:`false` → 不打開、清掉 `?edit=`(沒有權限不提示,停在原本的詳情或列表);
   * `undefined` = 還不知道(例:要等那一筆的 `abilities` 回來),先不動。
   */
  canEdit: boolean | undefined;
  /** 網址上的那一筆查完了,但不存在或看不到 → 不打開、清掉參數、提示「找不到這筆資料」 */
  isMissing: boolean;
  /** 沒有編輯權限、但看得到那一筆時,停在它的詳情(主從版面):清掉 `?edit=` 前先以 id 選它 */
  onNoPermission?: (id: string) => void;
}

/**
 * 網址帶了 `?edit=` 但不能開時把它清掉(`replace`),回傳真的要打開的那一筆 id(不能開 = null)。
 */
export const useUrlEditGuard = ({
  edit,
  canEdit,
  isMissing,
  onNoPermission,
}: UrlEditGuardOptions): string | null => {
  const t = useTranslations("admin.urlState");
  const show = useSnackbar();
  const { requestedId, close } = edit;

  useEffect(() => {
    if (requestedId === null) {
      return;
    }
    if (canEdit === false) {
      onNoPermission?.(requestedId);
      close();
      return;
    }
    if (isMissing) {
      close();
      show("warning", t("editNotFound"));
    }
  }, [requestedId, canEdit, isMissing, close, show, t, onNoPermission]);

  return canEdit === false || isMissing ? null : requestedId;
};
