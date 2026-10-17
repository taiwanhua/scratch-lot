import { expect, jest } from "@jest/globals";
import { act, screen, waitFor } from "@testing-library/react";
import {
  type ReactNode,
  createElement,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  RealtimeContext,
  type RealtimeContextValue,
  type RealtimeSignalHandler,
} from "@/hooks/base/useRealtime";
import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  type PrintButtonWorld,
  type PrintButtonWorldOptions,
  printButtonWorld,
  printingModule,
} from "@/test/msw/print-button-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { PrintButton, type PrintButtonProps } from "./PrintButton";

/** 真的 PNG 開頭 8 bytes(內容不重要:假伺服器不解碼)。 */
const PNG_BYTES = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/**
 * 假的即時通道:元件不在殼裡(本輪沒有頁面使用列印按鈕),以注入用 context 換掉
 * `RealtimeProvider`,測試用 `emit()` 送信號(只有類型與 id,RT-02)。
 */
type RealtimeStatusValue = RealtimeContextValue["status"];

const fakeRealtime = (initialStatus: RealtimeStatusValue) => {
  const handlers = new Map<string, Set<RealtimeSignalHandler>>();
  const statusSetter: {
    current: ((status: RealtimeStatusValue) => void) | null;
  } = { current: null };
  const base: Omit<RealtimeContextValue, "status"> = {
    listen: (type, handler) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => {
        set.delete(handler);
      };
    },
    setBoard: jest.fn<RealtimeContextValue["setBoard"]>(),
    refresh: jest.fn<RealtimeContextValue["refresh"]>(),
  };
  /** 連線狀態可在測試中途切換(`setStatus`),模擬斷線 / 恢復。 */
  const Host = ({ children }: { children: ReactNode }) => {
    const [status, setStatus] = useState(initialStatus);
    useEffect(() => {
      statusSetter.current = setStatus;
    }, []);
    const value = useMemo(() => ({ ...base, status }), [status]);
    return createElement(RealtimeContext.Provider, { value }, children);
  };
  const setStatus = (status: RealtimeStatusValue) => {
    act(() => {
      statusSetter.current?.(status);
    });
  };
  const emit = (type: string, id: string) => {
    act(() => {
      for (const handler of handlers.get(type) ?? []) {
        handler({ type, id }, "user:user-1");
      }
    });
  };
  return { Host, emit, setStatus };
};

export interface RenderPrintButtonOptions extends PrintButtonWorldOptions {
  /** 登入者的列印權限(預設列印 + 補印) */
  permissions?: string[];
  /** 即時通道狀態(預設 `live`;`slow` = 斷線改輪詢) */
  realtimeStatus?: RealtimeStatusValue;
  props?: Partial<PrintButtonProps>;
}

/** 登入後在總覽頁旁掛一顆列印按鈕(收據 `order` / `order-1`,分店 `store-a`)。 */
export const renderPrintButton = ({
  permissions = ["api.printing.print", "api.printing.reprint"],
  props = {},
  realtimeStatus = "live",
  ...worldOptions
}: RenderPrintButtonOptions = {}) => {
  const world = printButtonWorld(worldOptions);
  const realtime = fakeRealtime(realtimeStatus);
  const renderImage = jest.fn<PrintButtonProps["renderImage"]>(() =>
    Promise.resolve(new Blob([PNG_BYTES], { type: "image/png" })),
  );
  server.use(
    ...world.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, printingModule(permissions)],
    }).handlers,
  );
  const view = renderApp({
    path: "/overview",
    extra: createElement(
      realtime.Host,
      null,
      createElement(
        "div",
        { "data-testid": "print-button" },
        createElement(PrintButton, {
          orgId: "store-a",
          documentType: "receipt",
          refType: "order",
          refId: "order-1",
          documentName: "收據 C-0031",
          renderImage,
          ...props,
        }),
      ),
    ),
  });
  return {
    ...view,
    world,
    renderImage,
    emit: realtime.emit,
    setRealtimeStatus: realtime.setStatus,
  };
};

/**
 * 等登入者資料與印表機、已印次數都回來:按鈕可以按。
 * 每次重新查:不能按時 `Tooltip` 會在外面包一層 span(disabled 元素不發 hover 事件),按鈕節點會換掉。
 */
export const findPrintButton = async (name: "列印" | "補印" = "列印") =>
  waitFor(() => {
    const button = screen.getByRole("button", { name });
    expect(button).toBeEnabled();
    return button;
  });

/**
 * 等工作建立好(`createPrintJob` 回來、元件開始等這張工作的結果)。
 * 「已送到印表機…」在轉圖片前就出現,不能拿它判斷工作已經建立。
 */
export const waitForSentJob = async (world: PrintButtonWorld) => {
  await waitFor(() => {
    expect(world.created).toHaveLength(1);
  });
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  });
};
