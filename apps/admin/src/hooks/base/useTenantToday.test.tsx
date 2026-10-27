import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react";

import { authWorld } from "../../test/msw/auth-handlers";
import { server } from "../../test/msw/server";
import { renderApp } from "../../test/render";
import { useMe } from "./useMe";
import { useTenantToday } from "./useTenantToday";

/** UTC 10/31 15:30 = 台北 10/31 23:30 = 東京 11/1 00:30 */
const NOW = Date.UTC(2026, 9, 31, 15, 30);

const TodayProbe = () => {
  const today = useTenantToday();
  // 等 `me` 載到再印,才看得到租戶時區的結果
  return useMe().data === undefined ? null : (
    <span data-testid="today">{today}</span>
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useTenantToday", () => {
  it.each([
    ["Asia/Taipei", "2026-10-31"],
    ["Asia/Tokyo", "2026-11-01"],
  ])("租戶時區 %s:今天是 %s(不看瀏覽器時區)", async (timezone, expected) => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    server.use(
      ...authWorld({ hasRefreshCookie: true, currentOrgTimezone: timezone })
        .handlers,
    );

    renderApp({ path: "/", extra: <TodayProbe /> });

    expect(await screen.findByTestId("today")).toHaveTextContent(expected);
  });
});
