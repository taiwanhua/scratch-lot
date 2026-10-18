import { PrintAgentPlatform } from "@repo/graphql";

/** 下載區四個按鈕的順序。 */
export const PRINT_AGENT_PLATFORMS: readonly PrintAgentPlatform[] = [
  PrintAgentPlatform.WindowsX64,
  PrintAgentPlatform.LinuxX64,
  PrintAgentPlatform.LinuxArm64,
  PrintAgentPlatform.MacosArm64,
];

/** 瀏覽器回報的系統資訊(`navigator` 的子集合;測試直接給字串)。 */
export interface BrowserPlatformHints {
  /** `navigator.userAgentData.platform`(Chromium 系才有),例 `"Windows"`、`"macOS"`、`"Linux"` */
  platform?: string | null;
  /** `navigator.userAgent` */
  userAgent?: string | null;
}

const ARM_PATTERN = /aarch64|arm64|armv8|armv7/i;

/**
 * 依瀏覽器偵測的系統,選出下載區要反白建議的平台;認不出來回 `null`
 * (四個按鈕都不反白)。只是建議:四個按鈕都可以按。
 *
 * - Windows → Windows x64;macOS → macOS arm64(不支援 Intel Mac,Apple 晶片也沒辦法從瀏覽器分辨)
 * - Linux:使用者代理字串帶 arm / aarch64 → Linux arm64,其餘 → Linux x64
 * - Android 的使用者代理字串也含 Linux,但手機不是安裝代理程式的地方 → 不建議
 */
export const suggestedPrintAgentPlatform = ({
  platform,
  userAgent,
}: BrowserPlatformHints): PrintAgentPlatform | null => {
  const text = `${platform ?? ""} ${userAgent ?? ""}`;
  if (/android|iphone|ipad/i.test(text)) {
    return null;
  }
  if (/windows|win32|win64/i.test(text)) {
    return PrintAgentPlatform.WindowsX64;
  }
  if (/mac/i.test(text)) {
    return PrintAgentPlatform.MacosArm64;
  }
  if (/linux|x11/i.test(text)) {
    return ARM_PATTERN.test(text)
      ? PrintAgentPlatform.LinuxArm64
      : PrintAgentPlatform.LinuxX64;
  }
  return null;
};

/** 從目前的瀏覽器讀出系統資訊(`userAgentData` 不在 TS 的 DOM 型別裡,以結構型別讀)。 */
export const browserPlatformHints = (): BrowserPlatformHints => {
  if (typeof navigator === "undefined") {
    return {};
  }
  const { userAgentData } = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return {
    platform: userAgentData?.platform ?? null,
    userAgent: navigator.userAgent,
  };
};
