import { describe, expect, it } from "@jest/globals";

import { useSnackbarStore } from "./useSnackbarStore";

const onClick = () => {
  // 這個案子不驗撤銷本身
};

const texts = (): unknown[] =>
  useSnackbarStore.getState().items.map((item) => item.message);

describe("useSnackbarStore", () => {
  it("新的一則放在最後;第 4 則進來時丟掉最舊的,維持 3 則", () => {
    const { show } = useSnackbarStore.getState();
    show("success", "一");
    show("info", "二", { title: "新通知" });
    show("success", "三");
    expect(texts()).toEqual(["一", "二", "三"]);

    show("error", "四");

    expect(texts()).toEqual(["二", "三", "四"]);
  });

  it("標題與動作跟著那一則存進佇列", () => {
    useSnackbarStore
      .getState()
      .show("success", "已售出", { action: { label: "撤銷", onClick } });

    expect(useSnackbarStore.getState().items[0]).toMatchObject({
      severity: "success",
      message: "已售出",
      action: { label: "撤銷", onClick },
    });
  });

  it("dismiss 只移除那一則;關掉最新一則時 latest 清空(不把較舊的那則重念)", () => {
    const { show } = useSnackbarStore.getState();
    show("success", "舊");
    show("success", "新");
    const [older, newer] = useSnackbarStore.getState().items;

    useSnackbarStore.getState().dismiss(older.id);
    expect(texts()).toEqual(["新"]);
    expect(useSnackbarStore.getState().latest?.id).toBe(newer.id);

    useSnackbarStore.getState().dismiss(newer.id);
    expect(texts()).toEqual([]);
    expect(useSnackbarStore.getState().latest).toBeNull();
  });
});
