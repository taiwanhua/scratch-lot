import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useMe } from "@/hooks/base/useMe";
import { useSession } from "@/hooks/base/useSession";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

/** 提示停留多久才重新開機(票面「1 到 2 秒後」);夠久到看得完那句話,又不會讓人以為當掉。 */
export const TAB_SWITCH_DELAY_MS = 1500;

/** 換帳號後的落點:回首頁,由 ADR-0011 的規則轉到新帳號側欄的第一個模組。 */
const AFTER_SWITCH_PATH = "/";

export interface MultiTabSessionState {
  /** 別的分頁登入了另一個帳號時,那個帳號的名字(提示文案用);沒有在切換就是 null */
  switchingTo: string | null;
}

/**
 * 多分頁的登入狀態同步(#375)。refresh cookie 是全分頁共用的一份,access token 卻各分頁一份記憶體
 * (ADR-0003),所以要靠廣播讓所有分頁對齊「現在登入的是誰」:
 *
 * - 本分頁查到 `me` → `announce`(同一個人不重發),讓其他分頁知道現在是誰
 * - 收到 `logout` → 清掉本分頁狀態,守門(RequireAuth)接著導去登入頁
 * - 收到 `login` 且不是同一個人 → 清狀態回 `booting`、顯示提示,`TAB_SWITCH_DELAY_MS` 後用 cookie 換票並回首頁
 * - 收到 `login` 而本分頁還沒有登入者(停在登入頁 / 開機中)→ 不提示,直接跟著換票
 */
export const useMultiTabSession = (): MultiTabSessionState => {
  const { session, snapshot } = useSession();
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const meUserId = me.data?.me.id ?? null;
  const meDisplayName = me.data?.me.name;

  useEffect(() => {
    if (snapshot.status !== "authenticated" || meDisplayName === undefined) {
      return;
    }
    if (meUserId !== null) {
      session.announce({ id: meUserId, name: meDisplayName });
    }
  }, [session, snapshot.status, meUserId, meDisplayName]);

  useEffect(() => {
    // `meUserId` 進 deps:收訊端要拿它比對「是不是同一個人」,而 REACT-06 禁止 render 期間寫 ref,
    // 所以換人時重新訂閱一次(一個 Set 的增刪,成本可忽略)
    const clearTabState = () => {
      queryClient.clear();
      useRouteTabsStore.getState().reset();
    };

    return session.channel.subscribe((message) => {
      if (message.type === "logout") {
        clearTabState();
        session.store.getState().clear();
        return;
      }
      if (message.userId === meUserId) {
        return;
      }
      clearTabState();
      // 丟掉舊身分但不標成「未登入」:守門顯示恢復中,不會閃一下登入頁再跳回來
      session.store.getState().reset();
      if (meUserId === null) {
        void session.restore();
        return;
      }
      setSwitchingTo(message.name);
    });
  }, [session, queryClient, meUserId]);

  useEffect(() => {
    if (switchingTo === null) {
      return;
    }
    const timer = setTimeout(() => {
      void session.restore().finally(() => {
        setSwitchingTo(null);
        void navigate(AFTER_SWITCH_PATH, { replace: true });
      });
    }, TAB_SWITCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [switchingTo, session, navigate]);

  return { switchingTo };
};
