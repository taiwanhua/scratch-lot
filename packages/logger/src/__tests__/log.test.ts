/* eslint-disable no-console -- 測試需要 spy console 來驗證 logger 輸出 */
import { describe, expect, it, jest } from "@jest/globals";

import { log, warn } from "..";

jest.spyOn(globalThis.console, "log");
jest.spyOn(globalThis.console, "warn").mockImplementation(() => null);

describe("@repo/logger", () => {
  it("prints a message", () => {
    log("hello");

    expect(console.log).toHaveBeenCalledWith("LOGGER:", "hello");
  });

  it("prints a warning", () => {
    warn("print failed", { orgId: "org-1" });

    expect(console.warn).toHaveBeenCalledWith("LOGGER:", "print failed", {
      orgId: "org-1",
    });
  });
});
