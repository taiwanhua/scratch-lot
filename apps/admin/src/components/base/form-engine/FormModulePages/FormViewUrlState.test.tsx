import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { routeTabsStorageKey } from "@/lib/base/route-tabs";
import { testUser } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  shoppingDefinition,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { renderShopping, shoppingForm } from "./form-module-test-support";

setupFakeViewport();

const EARLY = "2026-01-05T02:00:00.000Z";
const VIEW = `${DEMO_FORM_ROUTES.viewPage}/sub-1`;

const world = () => ({
  moduleForms: [shoppingForm],
  versions: { [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition() },
  submissions: [
    submissionFragment({
      revision: 2,
      revisions: [
        { revision: 1, at: EARLY, user: { id: "user-1", name: "小華" } },
        { revision: 2, at: EARLY, user: { id: "user-2", name: "阿明" } },
      ],
    }),
  ],
  snapshots: {
    "sub-1": {
      1: { item: "雞蛋", qty: "1", unit_price: "30", total: "30" },
      2: { item: "雞蛋", qty: "2", unit_price: "30", total: "60" },
    },
  },
});

beforeEach(() => {
  sessionStorage.clear();
});

describe("表單模組詳情頁:唯讀檢視存在網址(REACT-14)", () => {
  it("修訂紀錄彈窗(唯讀檢視)開著記在 `?dialog=revisions`:帶參數打開就開著", async () => {
    renderShopping({ path: `${VIEW}?dialog=revisions`, world: world() });

    expect(
      await screen.findByRole("dialog", { name: "修訂紀錄" }),
    ).toBeInTheDocument();
  });

  it("檢視中的舊修訂記在 `?revision=<n>`:帶參數打開就停在那個修訂", async () => {
    renderShopping({ path: `${VIEW}?revision=1`, world: world() });

    expect(await screen.findByText("正在檢視修訂 1")).toBeInTheDocument();
  });

  it("「返回列表」帶回列表頁籤記下的條件", async () => {
    const listSearch = `?list=${encodeURIComponent('{"keyword":"雞蛋"}')}`;
    sessionStorage.setItem(
      routeTabsStorageKey(testUser.id),
      JSON.stringify([
        { route: DEMO_FORM_ROUTES.list, search: listSearch },
        { route: VIEW },
      ]),
    );
    const { user } = renderShopping({ path: VIEW, world: world() });

    await user.click(await screen.findByRole("button", { name: /返回列表/ }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${DEMO_FORM_ROUTES.list}${listSearch}`,
      );
    });
    expect(screen.getByLabelText("搜尋")).toHaveValue("雞蛋");
  });
});
