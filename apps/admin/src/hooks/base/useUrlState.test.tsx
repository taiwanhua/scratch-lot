import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { MemoryRouter } from "react-router";
import { z } from "zod";

import { LocationProbe } from "@/test/location-probe";

import { useUrlState } from "./useUrlState";

const listSchema = z
  .object({ status: z.enum(["all", "done"]), page: z.number().int().min(1) })
  .default({ status: "all", page: 1 });

const ListProbe = () => {
  const [list, setList] = useUrlState("list", listSchema);
  return (
    <>
      <output data-testid="list">{JSON.stringify(list)}</output>
      <button
        type="button"
        onClick={() => {
          setList((current) => ({ ...current, page: current.page + 1 }));
        }}
      >
        next page
      </button>
      <button
        type="button"
        onClick={() => {
          setList({ status: "all", page: 1 });
        }}
      >
        reset
      </button>
    </>
  );
};

/**
 * nuqs 的 react-router adapter 讀的是 `window.location`(寫入時再交給 router 的 navigate),
 * 所以起始網址兩邊都要給:瀏覽器網址列 + MemoryRouter 的起點。
 */
const renderAt = (url: string) => {
  globalThis.history.replaceState(null, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NuqsAdapter>
        <ListProbe />
        <LocationProbe />
      </NuqsAdapter>
    </MemoryRouter>,
  );
};

const listValue = (): unknown =>
  JSON.parse(screen.getByTestId("list").textContent);

/** router 的 location(`LocationProbe` 印出來的)上的查詢參數。 */
const routerSearch = () =>
  new URLSearchParams(
    screen.getByTestId("location").textContent.split("?", 2)[1] ?? "",
  );

afterEach(() => {
  globalThis.history.replaceState(null, "", "/");
});

describe("useUrlState", () => {
  it("網址沒有這個 key → schema 的預設值", () => {
    renderAt("/report");

    expect(listValue()).toEqual({ status: "all", page: 1 });
  });

  it("網址有合法的值 → 讀出來", () => {
    renderAt(
      `/report?list=${encodeURIComponent('{"status":"done","page":3}')}`,
    );

    expect(listValue()).toEqual({ status: "done", page: 3 });
  });

  it.each([
    ["JSON 壞掉", '{"status":"done",'],
    ["值不在列舉裡", '{"status":"hacked","page":1}'],
    ["頁碼不是數字", '{"status":"done","page":"abc"}'],
  ])("網址參數被改壞(%s)→ 回預設值,不報錯", (_case, raw) => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {
      // 吞掉:只驗有沒有被呼叫
    });

    renderAt(`/report?list=${encodeURIComponent(raw)}`);

    expect(listValue()).toEqual({ status: "all", page: 1 });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("網址參數被改壞 → 以 replace 把那一個 key 從網址清掉,其他 key 不動", async () => {
    renderAt(
      `/report?keep=1&list=${encodeURIComponent('{"status":"hacked"}')}`,
    );
    const historyLength = globalThis.history.length;

    expect(listValue()).toEqual({ status: "all", page: 1 });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        /^\/report\?keep=1$/,
      );
    });
    expect(globalThis.location.search).toBe("?keep=1");
    expect(globalThis.history).toHaveLength(historyLength);
  });

  it("寫入 → 網址與 router 的 location 都更新;寫回預設值 → key 從網址拿掉", async () => {
    const user = userEvent.setup();
    renderAt("/report?keep=1");
    const historyLength = globalThis.history.length;

    await user.click(screen.getByRole("button", { name: "next page" }));

    await waitFor(() => {
      expect(listValue()).toEqual({ status: "all", page: 2 });
    });
    await waitFor(() => {
      expect(routerSearch().get("list")).toBe('{"status":"all","page":2}');
    });
    expect(routerSearch().get("keep")).toBe("1");
    expect(new URLSearchParams(globalThis.location.search).get("list")).toBe(
      '{"status":"all","page":2}',
    );

    await user.click(screen.getByRole("button", { name: "reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        /^\/report\?keep=1$/,
      );
    });
    // replace:切篩選、換頁不堆上一頁紀錄
    expect(globalThis.history).toHaveLength(historyLength);
  });
});
