import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

import type { FormDefinition, RegexSafetyCheck } from "@repo/domain/form";

// recheck 的懶載入換成可控的替身:測「載入中 / 載入失敗」兩態,也確認沒有正則時根本不載
const loadRegexSafety = jest.fn<() => Promise<RegexSafetyCheck>>();
jest.unstable_mockModule("@/lib/base/form-engine/regex-safety-loader", () => ({
  loadRegexSafety,
}));
const { useRegexSafety } = await import("./useRegexSafety");
const { shoppingDefinition } = await import("@/test/msw/form-fixtures");

const UNSAFE = "^(a+)+$";

/** 手動決定何時載完的 recheck(jsdom 環境沒有 `Promise.withResolvers`)。 */
const deferredCheck = () => {
  const box: { resolve?: (check: RegexSafetyCheck) => void } = {};
  const promise = new Promise<RegexSafetyCheck>((done) => {
    box.resolve = done;
  });
  return {
    promise,
    resolve: (check: RegexSafetyCheck) => {
      box.resolve?.(check);
    },
  };
};

const withPattern = (pattern: string | null): FormDefinition => {
  const base = shoppingDefinition();
  return {
    ...base,
    fields: base.fields.map((field) =>
      field.key === "item" && pattern !== null
        ? { ...field, rules: { required: true, pattern } }
        : field,
    ),
  };
};

beforeEach(() => {
  loadRegexSafety.mockReset();
});

describe("useRegexSafety:正則的 ReDoS 即時檢查(recheck 懶載入)", () => {
  it("草稿沒有正則:不載 recheck,狀態 idle", async () => {
    const { result } = renderHook(() => useRegexSafety(withPattern(null)));

    expect(result.current.status).toBe("idle");
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    expect(loadRegexSafety).not.toHaveBeenCalled();
  });

  it("有正則:停手前與載入中都是 checking(先當安全),載完照 recheck 的判定", async () => {
    const loading = deferredCheck();
    loadRegexSafety.mockReturnValue(loading.promise);
    const { result } = renderHook(() => useRegexSafety(withPattern(UNSAFE)));

    expect(result.current.status).toBe("checking");
    expect(result.current.regexSafety(UNSAFE)).toBe(true);
    await waitFor(() => {
      expect(loadRegexSafety).toHaveBeenCalledTimes(1);
    });
    expect(result.current.status).toBe("checking");

    loading.resolve((source) => source !== UNSAFE);
    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });
    expect(result.current.regexSafety(UNSAFE)).toBe(false);
  });

  it("recheck 載不下來:狀態 failed(畫面提示存草稿時再檢查),不把正則判成不安全", async () => {
    loadRegexSafety.mockRejectedValue(new Error("chunk load failed"));
    const { result } = renderHook(() => useRegexSafety(withPattern(UNSAFE)));

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.regexSafety(UNSAFE)).toBe(true);
  });

  it("連續改正則:停手才檢查,只檢查最後一版", async () => {
    loadRegexSafety.mockResolvedValue(() => true);
    const { result, rerender } = renderHook(
      ({ pattern }) => useRegexSafety(withPattern(pattern)),
      { initialProps: { pattern: "^a" } },
    );
    rerender({ pattern: "^ab" });
    rerender({ pattern: "^abc" });

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });
    expect(loadRegexSafety).toHaveBeenCalledTimes(1);
  });
});
