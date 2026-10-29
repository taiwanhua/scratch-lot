import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { PRINT_IMAGE_MAX_HEIGHT_DOTS } from "@repo/domain/printing";

import {
  RealtimeContext,
  type RealtimeContextValue,
} from "@/hooks/base/useRealtime";
import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  type PrintButtonWorldOptions,
  printButtonWorld,
  printerFixture,
  printingModule,
} from "@/test/msw/print-button-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { type AutoPrintRequest, useAutoPrint } from "./useAutoPrint";

/** 只有簽章 + IHDR 的 PNG(高 `height`;讀得出尺寸)。 */
const pngOfHeight = (height: number): Blob => {
  const bytes = new Uint8Array(36);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 384);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
};

const noop = () => null;
/** 探針掛在路由旁(殼外面):等列印結果要的即時通道給一份不連線的。 */
const offlineRealtime: RealtimeContextValue = {
  status: "connecting",
  listen: () => noop,
  setBoard: noop,
  refresh: noop,
};

type Request = Omit<AutoPrintRequest, "renderImage" | "onTooLarge">;

const REQUEST: Request = {
  orgId: "store-a",
  preferredPrinterId: "printer-2",
  document: {
    documentType: "demo-slip",
    refType: "demo-order",
    refId: "order-1",
    documentName: "示範單 A-1",
  },
  logDetail: { kind: "demo" },
};

/** 按一下就送一次自動列印;送完顯示「完成」(有沒有拋錯都看得到)。 */
const Probe = ({
  renderImage,
  onTooLarge,
}: {
  renderImage: () => Promise<Blob>;
  onTooLarge: (printed: number) => void;
}) => {
  const autoPrint = useAutoPrint();
  const [state, setState] = useState("idle");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          autoPrint
            .printAfterCommit({
              ...REQUEST,
              renderImage,
              onTooLarge,
            })
            .then(
              () => {
                setState("done");
              },
              () => {
                setState("threw");
              },
            );
        }}
      >
        送出
      </button>
      <p>{state}</p>
      {autoPrint.host}
    </>
  );
};

const renderProbe = ({
  permissions = ["api.printing.print"],
  image = pngOfHeight(100),
  renderImage = () => Promise.resolve(image),
  world: worldOptions = {},
}: {
  permissions?: string[];
  image?: Blob;
  renderImage?: () => Promise<Blob>;
  world?: PrintButtonWorldOptions;
} = {}) => {
  const world = printButtonWorld({
    printers: [
      printerFixture(),
      printerFixture({ id: "printer-2", isDefault: false, name: "工作站" }),
    ],
    ...worldOptions,
  });
  const onTooLarge = jest.fn<(printed: number) => void>();
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, printingModule(permissions)],
    }).handlers,
    ...world.handlers,
  );
  const view = renderApp({
    path: "/overview",
    extra: (
      <RealtimeContext.Provider value={offlineRealtime}>
        <Probe renderImage={renderImage} onTooLarge={onTooLarge} />
      </RealtimeContext.Provider>
    ),
  });
  return { ...view, world, onTooLarge };
};

const send = async (user: ReturnType<typeof renderProbe>["user"]) => {
  await user.click(await screen.findByRole("button", { name: "送出" }));
  expect(await screen.findByText("done")).toBeInTheDocument();
};

describe("useAutoPrint(寫入成功後的自動列印)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("送到使用處指定的印表機,帶單據資訊與 base64 影像", async () => {
    const { user, world } = renderProbe();
    await send(user);
    expect(world.created).toHaveLength(1);
    expect(world.created[0]).toMatchObject({
      printerId: "printer-2",
      ...REQUEST.document,
    });
    expect(world.created[0]?.image).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("指定的印表機不在可選清單 → 退回組織預設", async () => {
    const { user, world } = renderProbe({
      world: { printers: [printerFixture()] },
    });
    await send(user);
    expect(world.created[0]?.printerId).toBe("printer-1");
  });

  it("沒有列印權限 → 什麼都不印、也不查印表機", async () => {
    const { user, world } = renderProbe({ permissions: [] });
    await send(user);
    expect(world.created).toEqual([]);
    expect(world.printerReads()).toBe(0);
  });

  it("組織沒有可用的印表機 → 不送,只記 log(不拋錯)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(noop);
    const { user, world } = renderProbe({
      world: { printers: [printerFixture({ available: false })] },
    });
    await send(user);
    expect(world.created).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "LOGGER:",
      "[print] no printer",
      expect.objectContaining({ orgId: "store-a", kind: "demo" }),
    );
  });

  it("影像超過高度上限 → 不送,交給 onTooLarge(帶已印次數)", async () => {
    jest.spyOn(console, "warn").mockImplementation(noop);
    const { user, world, onTooLarge } = renderProbe({
      image: pngOfHeight(PRINT_IMAGE_MAX_HEIGHT_DOTS + 1),
      world: { printedCount: 2 },
    });
    await send(user);
    expect(world.created).toEqual([]);
    await waitFor(() => {
      expect(onTooLarge).toHaveBeenCalledWith(2);
    });
  });

  it("轉圖失敗也不拋錯,只記 log", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(noop);
    const { user, world } = renderProbe({
      renderImage: () => Promise.reject(new Error("render failed")),
    });
    await send(user);
    expect(world.created).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "LOGGER:",
      "[print] print failed",
      expect.objectContaining({ orgId: "store-a", error: expect.any(Error) }),
    );
  });
});
