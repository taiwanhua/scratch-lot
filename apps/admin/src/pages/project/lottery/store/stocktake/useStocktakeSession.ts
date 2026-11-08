import { useEffect, useRef, useState } from "react";

import {
  STOCKTAKE_REASONS,
  type StocktakeType,
} from "@repo/domain/project/lottery";
import {
  ClientError,
  type LotteryStocktakeSessionFieldsFragment,
  useEndLotteryStocktakeSessionMutation,
  useLotteryStocktakeSessionsQuery,
  useSaveLotteryStocktakeSessionMutation,
  useStartLotteryStocktakeSessionMutation,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

export type StocktakeSessionView = LotteryStocktakeSessionFieldsFragment;

/** 存進度的間隔:最後一次變動後等這麼久才存(連續點格子不逐次送)。 */
const SAVE_DELAY_MS = 800;
/** 倒數重算的間隔。 */
const TICK_MS = 30_000;

/** 擋下的原因與擋住的那一筆(api `extensions.session`)。 */
export interface StocktakeSessionFailure {
  reason: string | null;
  session: StocktakeSessionView | null;
}

/** 讀 api 的錯誤:原因(`STOCKTAKE_REASONS`)與擋住的那一筆。 */
export const sessionFailureOf = (error: unknown): StocktakeSessionFailure => {
  if (!(error instanceof ClientError)) {
    return { reason: null, session: null };
  }
  const { errors } = error.response as {
    errors?: { extensions?: { reason?: unknown; session?: unknown } }[];
  };
  const extensions = errors?.[0]?.extensions;
  return {
    reason: typeof extensions?.reason === "string" ? extensions.reason : null,
    session:
      typeof extensions?.session === "object" && extensions.session !== null
        ? (extensions.session as StocktakeSessionView)
        : null,
  };
};

/** 同一個範圍的登記(全店 = `wholeStore`;單一收銀點 = 那台)。 */
const sameScope = (
  session: Pick<StocktakeSessionView, "wholeStore" | "cashPointId">,
  scopeCashPointId: string | null,
): boolean =>
  scopeCashPointId === null
    ? session.wholeStore
    : !session.wholeStore && session.cashPointId === scopeCashPointId;

export interface StocktakeSessionInput {
  orgId: string;
  type: StocktakeType;
  /** 補點編號(全店、全部遊戲暫停移櫃;張數店規格 9.3、8.5);不給 = 一般盤點 */
  purpose?: "normal" | "renumber";
  /** 只盤一個收銀點;全店 = null */
  scopeCashPointId: string | null;
  /** 要登記了(例:交班第 ① 步選了「現在盤點」) */
  enabled: boolean;
  /** 從看板登記好、帶進來的那一筆(盤點頁 `?session=`);進來就 [繼續] 這一筆 */
  sessionId?: string | null;
  /** 現在的盤點進度(`serializeStocktakeDraft`;還沒有 = null):變動就存到登記上 */
  draft: string | null;
  /** [繼續] 成功:帶回存在登記上的進度(沒有 = null) */
  onResume: (draft: string | null) => void;
}

/**
 * 盤點中登記(張數店規格 8.5a;Figma ST-13-2a~d、ST-17a-2a / 2b):進入盤點時登記這些位置,別人盤同一個位置被擋;
 * 進度每次變動就存到登記上(重算 1 小時倒數);重新整理後先問 [繼續] [放棄];店長看得到 [結束這個盤點]。
 *
 * - `resumable`:自己在這個範圍有一筆(重新整理、換裝置、失效後回來)→ 先問
 * - `blocked`:被別人的登記擋住(誰、幾點開始、剩幾分鐘;店長 `canEnd`)
 * - `active`:登記中(`minutesLeft` 倒數)
 * - `ended`:存進度時發現登記已解除(店長結束、失效後被別人接手)
 */
export const useStocktakeSession = ({
  orgId,
  type,
  purpose = "normal",
  scopeCashPointId,
  enabled,
  sessionId = null,
  draft,
  onResume,
}: StocktakeSessionInput) => {
  const { session: auth } = useSession();
  /** 登記中的那一筆與收到它的時間(倒數以伺服器回的「剩幾分鐘」為準,不受裝置時鐘影響) */
  const [activeAt, setActiveAt] = useState<{
    session: StocktakeSessionView;
    receivedAt: number;
  } | null>(null);
  const active = activeAt?.session ?? null;
  const setActive = (session: StocktakeSessionView | null) => {
    setActiveAt(session === null ? null : { session, receivedAt: Date.now() });
  };
  const [blocked, setBlocked] = useState<StocktakeSessionView | null>(null);
  const [own, setOwn] = useState<StocktakeSessionView | null>(null);
  const [ended, setEnded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const startedRef = useRef(false);
  const savedRef = useRef<string | null>(null);

  const sessions = useLotteryStocktakeSessionsQuery(
    auth.client,
    { orgId },
    { enabled: enabled && orgId !== "", retry: false },
  );
  const startMutation = useStartLotteryStocktakeSessionMutation(auth.client);
  const { mutate: save } = useSaveLotteryStocktakeSessionMutation(auth.client);
  const endMutation = useEndLotteryStocktakeSessionMutation(auth.client);

  const items = sessions.data?.lotteryStocktakeSessions.items ?? [];
  const resumable =
    active === null && sessionId === null && !dismissed
      ? (items.find(
          (item) =>
            item.mine &&
            item.type === type &&
            item.purpose === purpose &&
            sameScope(item, scopeCashPointId),
        ) ?? null)
      : null;

  /** 登記(新的 / [繼續] 一筆);結果只在回應裡寫進狀態(進來就登記的那一次在 effect 裡呼叫)。 */
  const start = (resumeId: string | null) => {
    startMutation.mutate(
      {
        input: {
          orgId,
          type,
          cashPointId: scopeCashPointId,
          sessionId: resumeId,
          ...(purpose === "renumber" && { purpose }),
        },
      },
      {
        onSuccess: (data) => {
          const started = data.startLotteryStocktakeSession;
          setActive(started);
          setBlocked(null);
          setOwn(null);
          setEnded(false);
          savedRef.current = started.draft ?? null;
          if (resumeId !== null) {
            onResume(started.draft ?? null);
          }
        },
        onError: (error) => {
          const failure = sessionFailureOf(error);
          if (failure.reason === STOCKTAKE_REASONS.sessionOwn) {
            setOwn(failure.session);
          } else if (failure.reason === STOCKTAKE_REASONS.sessionBusy) {
            setBlocked(failure.session);
          } else {
            setEnded(true);
          }
        },
      },
    );
  };

  // 換了用途(日結第 ② 步「現在盤點」↔「這次做補點編號」):放棄目前的登記,重新登記(補點的暫停跟著登記)
  const purposeRef = useRef(purpose);
  useEffect(() => {
    if (purposeRef.current === purpose) {
      return;
    }
    purposeRef.current = purpose;
    const previous = active;
    setActive(null);
    const restart = () => {
      startedRef.current = false;
      void sessions.refetch();
    };
    if (previous === null) {
      restart();
      return;
    }
    void endMutation
      .mutateAsync({ input: { orgId, sessionId: previous.sessionId } })
      .finally(restart);
  }, [purpose, active, endMutation, orgId, sessions]);

  // 進來就登記:帶了那一筆 → [繼續];自己在這個範圍有一筆 → 先問;沒有 → 新登記
  useEffect(() => {
    if (!enabled || startedRef.current || sessions.data === undefined) {
      return;
    }
    if (sessionId === null && resumable !== null) {
      return;
    }
    startedRef.current = true;
    start(sessionId);
  });

  // 盤點進度變動就存到登記上(重算倒數)
  useEffect(() => {
    if (active === null || draft === null || draft === savedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      savedRef.current = draft;
      save(
        { input: { orgId, sessionId: active.sessionId, draft } },
        {
          onSuccess: (data) => {
            setActive(data.saveLotteryStocktakeSession);
          },
          onError: () => {
            setEnded(true);
          },
        },
      );
    }, SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [active, draft, orgId, save]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const minutesLeft =
    activeAt === null
      ? 0
      : Math.max(
          0,
          activeAt.session.minutesLeft -
            Math.floor(Math.max(0, now - activeAt.receivedAt) / 60_000),
        );

  return {
    active,
    blocked,
    /** 自己另一個重疊的登記(先 [繼續] 或 [放棄]) */
    own,
    resumable,
    ended,
    minutesLeft,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
    /** [繼續] 自己的那一筆 */
    resume: (target: StocktakeSessionView) => {
      startedRef.current = true;
      setDismissed(true);
      start(target.sessionId);
    },
    /** [放棄] 自己的那一筆(之後新登記) */
    abandon: (target: StocktakeSessionView | null = active) => {
      setDismissed(true);
      if (target === null) {
        return Promise.resolve();
      }
      return endMutation
        .mutateAsync({ input: { orgId, sessionId: target.sessionId } })
        .then(() => {
          if (target.sessionId === active?.sessionId) {
            setActive(null);
          }
          setOwn(null);
          void sessions.refetch();
        });
    },
    /** 開始新的登記(放棄舊的之後;被擋後重試) */
    startNew: () => {
      startedRef.current = true;
      setDismissed(true);
      start(null);
    },
    /** 店長 [結束這個盤點](別人的;留稽核),之後重試登記 */
    endBlocked: () => {
      if (blocked === null) {
        return;
      }
      void endMutation
        .mutateAsync({ input: { orgId, sessionId: blocked.sessionId } })
        .then(() => {
          start(null);
        });
    },
  };
};

export type StocktakeSessionLink = ReturnType<typeof useStocktakeSession>;

/** 盤點頁的狀態(`useStocktakeFlow`)要的部分:現在的進度與 [繼續] 帶回進度。 */
export interface StocktakeFlowForSession {
  serializedDraft: string | null;
  isRestoring: boolean;
  restore: (draft: string | null) => void;
}

/**
 * 把盤點頁接上盤點中登記:進度變動就存;[繼續] 帶回的進度交給盤點頁(讀到盤點資料後才套用,套用前不存)。
 */
export const useStocktakeFlowSession = (
  flow: StocktakeFlowForSession,
  input: Omit<StocktakeSessionInput, "draft" | "onResume">,
): StocktakeSessionLink =>
  useStocktakeSession({
    ...input,
    // 帶回的進度套用前不存(免得空的進度蓋掉存著的)
    draft: flow.isRestoring ? null : flow.serializedDraft,
    onResume: flow.restore,
  });
