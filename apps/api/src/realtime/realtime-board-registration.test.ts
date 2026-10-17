import { describe, expect, it } from "@jest/globals";

import {
  RealtimeBoardRegistrationError,
  composeRealtimeBoards,
} from "./realtime-board-registration";

const board = (key: string, permission = `${key}.view`) => ({
  key,
  moduleKey: key,
  permission,
});

describe("看板登記的組裝檢查", () => {
  it("key 不重複 → 原樣回傳", () => {
    expect(composeRealtimeBoards([board("a"), board("b")])).toEqual([
      board("a"),
      board("b"),
    ]);
    expect(composeRealtimeBoards([])).toEqual([]);
  });

  it("key 重複 → 拋錯(app 起不來)", () => {
    expect(() =>
      composeRealtimeBoards([board("a"), board("a", "x.view")]),
    ).toThrow(RealtimeBoardRegistrationError);
    expect(() => composeRealtimeBoards([board("a"), board("a")])).toThrow(
      /看板 key「a」重複登記/,
    );
  });

  it("key 或 permission 空白 → 拋錯", () => {
    expect(() => composeRealtimeBoards([board(" ")])).toThrow(
      RealtimeBoardRegistrationError,
    );
    expect(() => composeRealtimeBoards([board("a", "")])).toThrow(
      RealtimeBoardRegistrationError,
    );
  });
});
