import { describe, expect, it } from "@jest/globals";

import { resolveListSelection } from "./list-selection";

const keys = ["shopping", "leave"];

describe("resolveListSelection(主從版面選中哪一筆)", () => {
  it("沒指定 → 第一筆", () => {
    expect(
      resolveListSelection({
        pickedKey: null,
        keys,
        isFetching: false,
        isAwaiting: false,
      }),
    ).toEqual({ selectedKey: "shopping", isPending: false });
  });

  it("指定的在清單裡 → 就是它", () => {
    expect(
      resolveListSelection({
        pickedKey: "leave",
        keys,
        isFetching: true,
        isAwaiting: false,
      }),
    ).toEqual({ selectedKey: "leave", isPending: false });
  });

  it.each([
    ["清單還在查", true, false],
    ["正在等清單帶回剛建立的那一筆", false, true],
  ])(
    "不在清單裡、%s → 維持指定的 key,等待中",
    (_case, isFetching, isAwaiting) => {
      expect(
        resolveListSelection({
          pickedKey: "trip",
          keys,
          isFetching,
          isAwaiting,
        }),
      ).toEqual({ selectedKey: "trip", isPending: true });
    },
  );

  it("清單查完了還是沒有 → 退回第一筆", () => {
    expect(
      resolveListSelection({
        pickedKey: "trip",
        keys,
        isFetching: false,
        isAwaiting: false,
      }),
    ).toEqual({ selectedKey: "shopping", isPending: false });
  });
});
