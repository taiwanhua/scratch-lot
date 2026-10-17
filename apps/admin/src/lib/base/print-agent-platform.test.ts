import { describe, expect, it } from "@jest/globals";

import { PrintAgentPlatform } from "@repo/graphql";

import { suggestedPrintAgentPlatform } from "./print-agent-platform";

describe("suggestedPrintAgentPlatform", () => {
  it.each([
    [
      "Windows(userAgentData)",
      { platform: "Windows", userAgent: "" },
      PrintAgentPlatform.WindowsX64,
    ],
    [
      "Windows(只有使用者代理字串)",
      {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0",
      },
      PrintAgentPlatform.WindowsX64,
    ],
    [
      "macOS",
      {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      },
      PrintAgentPlatform.MacosArm64,
    ],
    [
      "Linux x64",
      { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0" },
      PrintAgentPlatform.LinuxX64,
    ],
    [
      "Linux arm64",
      { userAgent: "Mozilla/5.0 (X11; Linux aarch64) Chrome/141.0" },
      PrintAgentPlatform.LinuxArm64,
    ],
  ])("%s → 對應的平台", (_label, hints, expected) => {
    expect(suggestedPrintAgentPlatform(hints)).toBe(expected);
  });

  it("手機、平板與認不出來的系統不建議(四個按鈕都不反白)", () => {
    expect(
      suggestedPrintAgentPlatform({
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0",
      }),
    ).toBeNull();
    expect(
      suggestedPrintAgentPlatform({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
      }),
    ).toBeNull();
    expect(suggestedPrintAgentPlatform({})).toBeNull();
  });
});
