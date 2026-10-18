import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import { demoGroupNode } from "@/test/msw/module-fixtures";
import { api, server } from "@/test/msw/server";
import {
  applyCenterModules,
  demoGroupFormModules,
} from "@/test/msw/workflow-fixtures";
import { FakeSocket } from "@/test/realtime";
import { renderApp } from "@/test/render";

/**
 * 側欄計數登記制:數字來自 `sidebarBadges`(api 只回看得到的模組),
 * 收到 `badge:<模組 key>` 信號就重抓 —— 走真的殼、真的 `RealtimeProvider` 與信號登記表,
 * 只把瀏覽器的 WebSocket 換成假的(測試預設的 `realtimeTicket` 是 null = 停用,這裡改發憑證)。
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
  jest.restoreAllMocks();
});

const findSideNav = () => screen.findByRole("navigation", { name: "主選單" });

const latestSocket = async (): Promise<FakeSocket> => {
  await waitFor(() => {
    expect(sockets.length).toBeGreaterThan(0);
  });
  const socket = sockets.at(-1);
  if (socket === undefined) {
    throw new Error("還沒有連線");
  }
  return socket;
};

/** 登入者看得到申請中心與示範表單(群組內);`counts` 是假 api 此刻的數字(可在測試中改)。 */
const renderShell = (counts: Record<string, number>) => {
  let calls = 0;
  // MSW 先列的先贏:發憑證的 RealtimeTicket 要排在 authWorld(回 null)前面
  server.use(
    api.query("RealtimeTicket", () =>
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
    ),
    api.query("SidebarBadges", () => {
      calls += 1;
      return HttpResponse.json({
        data: {
          sidebarBadges: Object.entries(counts).map(([moduleKey, count]) => ({
            moduleKey,
            count,
          })),
        },
      });
    }),
    ...authWorld({
      hasRefreshCookie: true,
      modules: [
        overviewModule,
        ...applyCenterModules(),
        demoGroupNode,
        ...demoGroupFormModules(["demo.form.*"]),
      ],
    }).handlers,
  );
  return { ...renderApp({ path: "/overview" }), calls: () => calls };
};

const signal = (type: string) => ({
  op: "signal",
  topic: "user:user-1",
  signal: { type },
});

describe("側欄計數登記制(sidebarBadges + badge:<模組 key>)", () => {
  it("收到 badge:apply-center 信號 → 側欄申請中心的數字更新", async () => {
    const counts: Record<string, number> = { "apply-center": 1 };
    renderShell(counts);
    const nav = await findSideNav();
    expect(
      await within(nav).findByRole("link", { name: /申請中心\s*1 筆待處理/ }),
    ).toBeInTheDocument();
    const socket = await latestSocket();
    act(() => {
      socket.open();
    });

    counts["apply-center"] = 3;
    act(() => {
      socket.receive(signal("badge:apply-center"));
    });

    expect(
      await within(nav).findByRole("link", { name: /申請中心\s*3 筆待處理/ }),
    ).toBeInTheDocument();
  });

  it("其他模組的 badge:<模組 key> 也重抓同一支(前端不必另外登記),數字掛到對應的模組", async () => {
    const counts: Record<string, number> = { "apply-center": 0 };
    renderShell(counts);
    const nav = await findSideNav();
    await within(nav).findByRole("link", { name: "申請中心" });
    const socket = await latestSocket();
    act(() => {
      socket.open();
    });

    counts["demo.form"] = 4;
    act(() => {
      socket.receive(signal("badge:demo.form"));
    });

    // 示範表單掛在群組底下(群組預設展開)
    expect(
      await within(nav).findByRole("link", {
        name: /^示範表單.*4 筆待處理$/,
      }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "申請中心" })).toBeVisible();
  });

  it("不是 badge: 的信號不重抓側欄計數", async () => {
    const { calls } = renderShell({ "apply-center": 2 });
    const nav = await findSideNav();
    await within(nav).findByRole("link", { name: /2 筆待處理/ });
    const socket = await latestSocket();
    act(() => {
      socket.open();
    });
    const before = calls();

    act(() => {
      socket.receive(signal("notification"));
    });

    expect(calls()).toBe(before);
  });
});
