import { describe, expect, it } from "@jest/globals";

import {
  mergeNotificationPages,
  nextNotificationPage,
} from "./notification-pages";

const item = (id: string) => ({ id });

describe("通知清單的分頁合併", () => {
  it("各頁依序攤平", () => {
    expect(
      mergeNotificationPages([
        { items: [item("a"), item("b")], page: 1, pageSize: 2, totalCount: 4 },
        { items: [item("c"), item("d")], page: 2, pageSize: 2, totalCount: 4 },
      ]).map((entry) => entry.id),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("載入下一批的途中來了新通知:下一頁重複的那一筆只留一次,位置不變", () => {
    expect(
      mergeNotificationPages([
        { items: [item("b"), item("c")], page: 1, pageSize: 2, totalCount: 4 },
        // 新通知 a 插到最前面,整串後推一格:第二頁的第一筆是已經有的 c
        { items: [item("c"), item("d")], page: 2, pageSize: 2, totalCount: 5 },
      ]).map((entry) => entry.id),
    ).toEqual(["b", "c", "d"]);
  });

  it("還有下一頁 → 下一個頁碼;載完了 → 不再載入", () => {
    expect(
      nextNotificationPage({
        items: [],
        page: 1,
        pageSize: 20,
        totalCount: 21,
      }),
    ).toBe(2);
    expect(
      nextNotificationPage({
        items: [],
        page: 2,
        pageSize: 20,
        totalCount: 40,
      }),
    ).toBeUndefined();
  });
});
