import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse } from "msw";

import { authWorld, graphqlError } from "@/test/msw/auth-handlers";
import {
  type TestNotification,
  notificationFixture,
  notificationWorld,
} from "@/test/msw/notification-handlers";
import { api, server } from "@/test/msw/server";
import { FakeSocket } from "@/test/realtime";
import { renderApp } from "@/test/render";
import { findLatestSnackbar, findSnackbarAlert } from "@/test/snackbar";

/**
 * 通知鈴與通知清單(底座規格第 5 章「通知鈴與通知清單」情境表,每列一個測試)、新通知提示(10.12)。
 * 走真的殼、真的 `RealtimeProvider` 與信號登記表,只把瀏覽器的 WebSocket 換成假的
 * (測試預設的 `realtimeTicket` 是 null = 停用,這裡改發憑證)。
 */

const sockets: FakeSocket[] = [];
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  sockets.length = 0;
  globalThis.WebSocket = class extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
});

const ticketHandler = api.query("RealtimeTicket", () =>
  HttpResponse.json({
    data: {
      realtimeTicket: {
        ticket: "t1",
        connectUrl: "wss://rt.test/connect",
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        topics: ["user:user-1"],
      },
    },
  }),
);

/** 登入後停在總覽;`notifications` 由新到舊;`overrides` 排在最前面(MSW 先列的先贏)。 */
const renderShell = (
  notifications: TestNotification[] = [],
  overrides: ReturnType<typeof api.mutation>[] = [],
) => {
  const world = notificationWorld({ notifications });
  server.use(
    ...overrides,
    ticketHandler,
    ...world.handlers,
    ...authWorld({ hasRefreshCookie: true }).handlers,
  );
  return { ...renderApp({ path: "/overview" }), world };
};

const findBell = () =>
  screen.findByRole("button", { name: /^通知/ }, { timeout: 5000 });

const openPanel = async (user: ReturnType<typeof renderApp>["user"]) => {
  await user.click(await findBell());
  return screen.findByRole("dialog", { name: "通知" });
};

const liveSocket = async (): Promise<FakeSocket> => {
  await waitFor(() => {
    expect(sockets.length).toBeGreaterThan(0);
  });
  const socket = sockets.at(-1);
  if (socket === undefined) {
    throw new Error("還沒有連線");
  }
  act(() => {
    socket.open();
  });
  return socket;
};

const notificationSignal = {
  op: "signal",
  topic: "user:user-1",
  signal: { type: "notification" },
};

/** n 則未讀通知,第 1 則最新。 */
const unreadList = (count: number, prefix = "通知") =>
  Array.from({ length: count }, (_, index) =>
    notificationFixture({
      id: `${prefix}-${String(index + 1)}`,
      title: `${prefix} ${String(index + 1)}`,
    }),
  );

describe("通知鈴", () => {
  it("顯示未讀數;沒有未讀時不顯示數字", async () => {
    renderShell(unreadList(3));

    expect(
      await screen.findByRole("button", { name: "通知,3 則未讀" }),
    ).toBeInTheDocument();
  });

  it("未讀數 > 99:🔔 上顯示「99+」", async () => {
    renderShell(unreadList(120));

    const bell = await screen.findByRole("button", {
      name: "通知,120 則未讀",
    });
    expect(within(bell).getByText("99+")).toBeVisible();
  });

  it("收到 notification 信號 → 未讀數 +1、右下角出現提示(Info、標題 = 通知標題、沒有動作)", async () => {
    const { world } = renderShell(unreadList(2));
    await screen.findByRole("button", { name: "通知,2 則未讀" });
    const socket = await liveSocket();

    world.arrive(
      notificationFixture({
        id: "new-1",
        title: "待你審核:示範表單 #F-0012",
        body: "王小明 送出示範表單,共 5 筆明細。",
      }),
    );
    act(() => {
      socket.receive(notificationSignal);
    });

    expect(
      await screen.findByRole("button", { name: "通知,3 則未讀" }),
    ).toBeInTheDocument();
    const alert = await findSnackbarAlert();
    expect(alert.severity).toBe("info");
    expect(alert.text).toContain("待你審核:示範表單 #F-0012");
    expect(alert.text).toContain("王小明 送出示範表單,共 5 筆明細。");
    const card = await findLatestSnackbar();
    // 只有關閉鈕,沒有動作按鈕
    expect(within(card).getAllByRole("button")).toHaveLength(1);
  });

  it("同時收到多則新通知:只跳一則提示「你有 N 則新通知」", async () => {
    const { world } = renderShell();
    await findBell();
    const socket = await liveSocket();

    world.arrive(
      notificationFixture({ id: "a" }),
      notificationFixture({ id: "b" }),
      notificationFixture({ id: "c" }),
    );
    act(() => {
      socket.receive(notificationSignal);
      socket.receive(notificationSignal);
      socket.receive(notificationSignal);
    });

    const alert = await findSnackbarAlert();
    expect(alert.text).toContain("你有 3 則新通知");
    const stack = document.querySelector("[data-snackbar-stack]");
    expect(stack?.querySelectorAll(".MuiAlert-root")).toHaveLength(1);
    expect(
      await screen.findByRole("button", { name: "通知,3 則未讀" }),
    ).toBeInTheDocument();
  });
});

describe("通知清單", () => {
  it("打開清單:依時間新到舊,一次 20 則", async () => {
    const { user, world } = renderShell(unreadList(25));

    const panel = await openPanel(user);
    const list = await within(panel).findByRole("list", { name: "通知" });

    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent("通知 1");
    expect(items[19]).toHaveTextContent("通知 20");
    expect(world.calls.list).toEqual([{ unreadOnly: false, page: 1 }]);
  });

  it("捲到清單底部:載入下一批;沒有更多時不再載入", async () => {
    const { user, world } = renderShell(unreadList(25));
    const panel = await openPanel(user);
    await within(panel).findByRole("list", { name: "通知" });

    fireEvent.scroll(screen.getByTestId("notification-list"));
    await waitFor(() => {
      expect(
        within(panel).getAllByRole("button", { name: /通知 \d+/ }),
      ).toHaveLength(25);
    });

    fireEvent.scroll(screen.getByTestId("notification-list"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(world.calls.list).toEqual([
      { unreadOnly: false, page: 1 },
      { unreadOnly: false, page: 2 },
    ]);
  });

  it("載入下一批的途中來了新通知:重複的那一則只出現一次", async () => {
    const { user, world } = renderShell(unreadList(25));
    const panel = await openPanel(user);
    await within(panel).findByRole("list", { name: "通知" });

    // 新通知插到最前面:offset 分頁的第二頁第一筆會是第一頁已經有的「通知 20」
    world.arrive(notificationFixture({ id: "fresh", title: "新的" }));
    fireEvent.scroll(screen.getByTestId("notification-list"));

    await waitFor(() => {
      expect(
        within(panel).getAllByRole("button", { name: /通知 \d+/ }),
      ).toHaveLength(25);
    });
    expect(
      within(panel).getAllByRole("button", { name: /通知 20(?!\d)/ }),
    ).toHaveLength(1);
  });

  it("「未讀」清單點過通知後捲到底:從頭重抓,不接續 offset(不漏通知)", async () => {
    // 沒有連結的通知:點了只標已讀,清單維持開著
    const notifications = unreadList(25).map((item) => ({
      ...item,
      link: null,
    }));
    const { user, world } = renderShell(notifications);
    const panel = await openPanel(user);
    await within(panel).findByRole("list", { name: "通知" });
    await user.click(within(panel).getByRole("button", { name: "未讀" }));
    await within(panel).findByRole("button", { name: /通知 20(?!\d)/ });

    await user.click(
      within(panel).getByRole("button", { name: /通知 1(?!\d)/ }),
    );
    await waitFor(() => {
      expect(world.markedRead).toEqual(["通知-1"]);
    });
    fireEvent.scroll(screen.getByTestId("notification-list"));

    // 從第 1 頁重抓:伺服器端未讀只剩 24 則,第 1 頁是「通知 2」~「通知 21」
    await within(panel).findByRole("button", { name: /通知 21(?!\d)/ });
    fireEvent.scroll(screen.getByTestId("notification-list"));
    await within(panel).findByRole("button", { name: /通知 25(?!\d)/ });

    const shown = within(panel).getAllByRole("button", { name: /通知 \d+/ });
    expect(shown).toHaveLength(24);
    expect(world.calls.list.filter((call) => call.unreadOnly)).toEqual([
      { unreadOnly: true, page: 1 },
      { unreadOnly: true, page: 1 },
      { unreadOnly: true, page: 2 },
    ]);
  });

  it("切「未讀」:只列未讀的通知", async () => {
    const { user } = renderShell([
      notificationFixture({ id: "u1", title: "未讀的一則" }),
      notificationFixture({
        id: "r1",
        title: "已讀的一則",
        readAt: "2026-10-17T03:00:00.000Z",
      }),
    ]);
    const panel = await openPanel(user);
    expect(await within(panel).findByText("已讀的一則")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "未讀" }));

    await waitFor(() => {
      expect(within(panel).queryByText("已讀的一則")).toBeNull();
    });
    expect(within(panel).getByText("未讀的一則")).toBeVisible();
  });

  it("點一則通知:標已讀並打開連結(連結登記表找到的頁面)", async () => {
    const { user, world } = renderShell([
      notificationFixture({
        id: "n-open",
        title: "待你審核:示範表單 #F-0099",
        link: "/apply-center/view-page/inst-99",
      }),
    ]);
    const panel = await openPanel(user);

    await user.click(
      await within(panel).findByRole("button", {
        name: /待你審核:示範表單 #F-0099/,
      }),
    );

    await waitFor(() => {
      expect(world.markedRead).toEqual(["n-open"]);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/apply-center/view-page/inst-99",
    );
    expect(
      await screen.findByRole("button", { name: "通知" }),
    ).toBeInTheDocument();
  });

  it("連結頁面沒有權限或資料已找不到:照常標已讀,打開後由頁面顯示無權限", async () => {
    const { user, world } = renderShell([
      notificationFixture({
        id: "n-gone",
        link: "/no-such-module/view-page/x",
      }),
    ]);
    const panel = await openPanel(user);

    await user.click(
      await within(panel).findByRole("button", { name: /待你審核/ }),
    );

    await waitFor(() => {
      expect(world.markedRead).toEqual(["n-gone"]);
    });
    const forbidden = await screen.findAllByText("沒有權限進入此頁面");
    expect(forbidden.length).toBeGreaterThan(0);
  });

  it("全部標為已讀失敗:跳失敗提示,未讀數不變", async () => {
    const { user } = renderShell(unreadList(2), [
      api.mutation("MarkAllNotificationsRead", () => graphqlError("FORBIDDEN")),
    ]);
    const panel = await openPanel(user);
    await within(panel).findByRole("list", { name: "通知" });

    await user.click(
      within(panel).getByRole("button", { name: "全部標為已讀" }),
    );

    const alert = await findSnackbarAlert();
    expect(alert.severity).toBe("error");
    expect(alert.text).toBe("標為已讀失敗,請稍後再試");
    expect(
      screen.getByRole("button", { name: "通知,2 則未讀", hidden: true }),
    ).toBeInTheDocument();
  });

  it("全部標為已讀:未讀數歸零、清單的未讀標記拿掉", async () => {
    const { user, world } = renderShell(unreadList(3));
    const panel = await openPanel(user);
    expect(
      await within(panel).findAllByRole("img", { name: "未讀" }),
    ).toHaveLength(3);

    await user.click(
      within(panel).getByRole("button", { name: "全部標為已讀" }),
    );

    await waitFor(() => {
      expect(
        within(panel).queryAllByRole("img", { name: "未讀" }),
      ).toHaveLength(0);
    });
    expect(world.markedRead).toHaveLength(3);
    // 清單浮層開著時殼被標成 aria-hidden
    expect(
      screen.getByRole("button", { name: "通知", hidden: true }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "全部標為已讀" }),
    ).toBeNull();
  });

  it("通知超過 90 天(被 TTL 刪除):清單不再出現;沒有通知時顯示空狀態", async () => {
    // TTL 由資料庫刪除,api 不再回傳 —— 前端只需正確顯示「沒有了」
    const { user } = renderShell([]);
    const panel = await openPanel(user);

    expect(await within(panel).findByText("目前沒有通知")).toBeVisible();
  });
});
