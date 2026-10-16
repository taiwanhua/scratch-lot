import { describe, expect, it } from "@jest/globals";
import { waitFor } from "@testing-library/react";

import { type SessionMessage, createSessionChannel } from "./session-channel";

/** 每個案子自己一個名字,免得同一個 jest worker 裡的其他測試互相收到。 */
const uniqueName = (suffix: string) => `cookhome-admin-session-test-${suffix}`;

describe("session-channel:分頁間的登入狀態廣播", () => {
  it("login / logout 依原樣送到另一端;形狀不合的訊息忽略", async () => {
    const name = uniqueName("shape");
    const sender = createSessionChannel(name);
    const receiver = createSessionChannel(name);
    const noise = new BroadcastChannel(name);
    const received: SessionMessage[] = [];
    receiver.subscribe((message) => received.push(message));

    try {
      noise.postMessage({ type: "renamed" });
      noise.postMessage({ type: "login", userId: "user-2" }); // 少了 name
      sender.postLogin({ id: "user-2", name: "小明" });
      sender.postLogout("user-2");

      await waitFor(() => {
        expect(received).toHaveLength(2);
      });
      expect(received).toEqual([
        { type: "login", userId: "user-2", name: "小明" },
        { type: "logout", userId: "user-2" },
      ]);
    } finally {
      noise.close();
      sender.close();
      receiver.close();
    }
  });

  it("close 之後再廣播會重開一條,不丟 InvalidStateError(StrictMode 的卸載再掛載)", async () => {
    const name = uniqueName("reopen");
    const sender = createSessionChannel(name);
    const receiver = createSessionChannel(name);
    const received: SessionMessage[] = [];

    try {
      sender.close();
      receiver.subscribe((message) => received.push(message));
      expect(() => {
        sender.postLogout("user-1");
      }).not.toThrow();

      await waitFor(() => {
        expect(received).toEqual([{ type: "logout", userId: "user-1" }]);
      });
    } finally {
      sender.close();
      receiver.close();
    }
  });
});
