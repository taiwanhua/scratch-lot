import { describe, expect, it } from "@jest/globals";
import { act, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";

import { useFlashTarget } from "./useFlashTarget";

describe("useFlashTarget(閃爍提示的狀態)", () => {
  it("一開始沒有目標;flash 記下目標並給序號,同一個目標再閃序號也會換", () => {
    const { result } = renderHook(() => useFlashTarget<{ rowId: string }>());
    expect(result.current.target).toBeNull();

    act(() => {
      result.current.flash({ rowId: "a" });
    });
    expect(result.current.target).toEqual({ rowId: "a", nonce: 1 });

    act(() => {
      result.current.flash({ rowId: "a" });
    });
    expect(result.current.target).toEqual({ rowId: "a", nonce: 2 });

    act(() => {
      result.current.flash({ rowId: "b" });
    });
    expect(result.current.target).toEqual({ rowId: "b", nonce: 3 });

    act(() => {
      result.current.clear();
    });
    expect(result.current.target).toBeNull();
  });

  it("序號當 key:再閃一次元件會重掛(動畫重播),沒再閃就不重掛", () => {
    let mounts = 0;
    const Row = () => {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <p>row</p>;
    };
    const { result } = renderHook(() => useFlashTarget<{ rowId: string }>());
    act(() => {
      result.current.flash({ rowId: "a" });
    });
    const { rerender } = render(<Row key={result.current.target?.nonce} />);
    rerender(<Row key={result.current.target?.nonce} />);
    expect(mounts).toBe(1);
    act(() => {
      result.current.flash({ rowId: "a" });
    });
    rerender(<Row key={result.current.target?.nonce} />);
    expect(mounts).toBe(2);
  });
});
