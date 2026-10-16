import {
  createAdminStorageKeys,
  projectPublic,
} from "@repo/project-config/public";

/**
 * 分頁間的登入狀態廣播(#61 登出同步、#375 換帳號同步)。
 *
 * access token 只活在各分頁的記憶體(ADR-0003),refresh cookie 卻是全分頁共用的一份 —— 所以「分頁 B 換帳號登入」
 * 在分頁 A 是看不見的,要等 A 的 access token 到期、用共用的 cookie 換票才會悄悄變成另一個人(混帳號)。
 * 這條 channel 就是補上那個缺口:誰是當前登入者由**廣播**告知,不靠各分頁自己去猜。
 *
 * 退路:不做 `storage` 事件退路(票面 2 由實作者決定)—— BroadcastChannel 是 Baseline「廣泛可用」
 * (Chrome 54 / Firefox 38 / Safari 15.4 / Edge 79),而 admin 自 #61 起的分頁登出同步本來就只靠它;
 * 兩套路徑並存要多一份去重與清 key 的邏輯,換到的只有 Safari 15.4 以前的版本。
 *
 * channel 名稱由專案設定的 slug 生成(`<slug>-admin-session`,登記於 docs/branding.md):
 * 同一個瀏覽器裡不同專案的後台各用各的 channel,互不收訊。
 */
export const SESSION_CHANNEL_NAME = createAdminStorageKeys(
  projectPublic.slug,
).sessionChannel;

/** 這個分頁當下的登入者(廣播內容與提示文案都要用到名字)。 */
export interface SessionIdentity {
  id: string;
  name: string;
}

/**
 * 廣播內容(票面 1 的 `{ type, userId }`,`login` 另帶 `name` —— 收訊端要顯示「已在其他分頁登入為 ○○」,
 * 而它在重新開機完成前查不到新帳號的名字)。`logout` 的 `userId` 可能是 null:登出當下本分頁不一定查過 `me`。
 */
export type SessionMessage =
  | { type: "login"; userId: string; name: string }
  | { type: "logout"; userId: string | null };

export interface SessionChannel {
  postLogin: (identity: SessionIdentity) => void;
  postLogout: (userId: string | null) => void;
  /** 訂閱其他分頁的廣播(自己發的不會收到);回傳取消訂閱 */
  subscribe: (listener: (message: SessionMessage) => void) => () => void;
  close: () => void;
}

/** 解析收到的訊息;形狀不合(舊版分頁、被改過)一律忽略,不讓廣播炸掉收訊端。 */
const parseSessionMessage = (value: unknown): SessionMessage | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { type, userId, name } = value as Record<string, unknown>;
  if (type === "logout") {
    return { type, userId: typeof userId === "string" ? userId : null };
  }
  if (
    type === "login" &&
    typeof userId === "string" &&
    typeof name === "string"
  ) {
    return { type, userId, name };
  }
  return null;
};

export const createSessionChannel = (
  name = SESSION_CHANNEL_NAME,
): SessionChannel => {
  const listeners = new Set<(message: SessionMessage) => void>();
  let channel: BroadcastChannel | null = null;

  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = parseSessionMessage(event.data);
    if (message === null) {
      return;
    }
    for (const listener of listeners) {
      listener(message);
    }
  };

  /**
   * 用到才開,關掉之後再用就重開一條。
   * `AuthSession` 活得比掛載它的 React 樹久(組裝根以 `useState` 只建一次),而 StrictMode 的開發模式會
   * 「掛載 → 卸載 → 再掛載」—— 中間那次卸載已經 `close()` 過,固定持有同一個 BroadcastChannel 的話,
   * 再掛載後第一次廣播就會丟 `InvalidStateError: Channel is closed`(#375 在 mock 模式抓到)。
   */
  const ensureChannel = (): BroadcastChannel => {
    channel ??= new BroadcastChannel(name);
    channel.addEventListener("message", handleMessage);
    return channel;
  };

  const post = (message: SessionMessage) => {
    ensureChannel().postMessage(message);
  };

  return {
    postLogin: ({ id, name: displayName }) => {
      post({ type: "login", userId: id, name: displayName });
    },
    postLogout: (userId) => {
      post({ type: "logout", userId });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      ensureChannel();
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      listeners.clear();
      channel?.close();
      channel = null;
    },
  };
};
