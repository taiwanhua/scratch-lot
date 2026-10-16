import { describe, expect, it } from "@jest/globals";

import type { FieldDef } from "@repo/domain/form";

import { OPEN_PERMISSIONS, resolveFormState } from "./field-states";

const field = (key: string, overrides: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label: key,
  type: "number",
  precision: 0,
  widget: { kind: "number" },
  valueSource: { kind: "input" },
  permission: { show: false, edit: false },
  ...overrides,
});

const fields: FieldDef[] = [
  field("qty"),
  field("price"),
  field("total", {
    valueSource: {
      kind: "computed",
      expr: { "*": [{ var: "qty" }, { var: "price" }] },
    },
  }),
  field("note", {
    type: "text",
    widget: { kind: "textField" },
    visibleWhen: { ">": [{ var: "qty" }, 0] },
  }),
  field("late", {
    type: "text",
    widget: { kind: "textField" },
    visibleWhen: { ">": [{ now: [] }, "2026-06-01"] },
  }),
  field("locked", {
    type: "text",
    widget: { kind: "textField" },
    readonlyWhen: { "==": [{ var: "qty" }, 9] },
  }),
  field("secret", { permission: { show: true, edit: false } }),
];

const ctxAt = (now: string) => ({
  now,
  timezone: "Asia/Taipei",
  user: { id: "user-1", orgId: "org-1" },
});

describe("resolveFormState:FormRenderer 五種 mode 的語意", () => {
  it("design:不跑條件與計算,全部顯示、全部不可輸入", () => {
    const { states, values } = resolveFormState({
      definition: { fields },
      values: {},
      ctx: ctxAt("2026-09-01T00:00:00Z"),
      mode: "design",
      permissions: OPEN_PERMISSIONS,
    });
    expect(values).toEqual({});
    expect(
      [...states.values()].every((state) => state.visible && state.readonly),
    ).toBe(true);
  });

  it("create / preview:計算欄位即時算、條件即時套;缺依賴的計算結果是 null", () => {
    const filled = resolveFormState({
      definition: { fields },
      values: { qty: "3", price: "40" },
      ctx: ctxAt("2026-09-01T00:00:00Z"),
      mode: "preview",
      permissions: OPEN_PERMISSIONS,
    });
    expect(filled.values.total).toBe("120");
    expect(filled.states.get("note")?.visible).toBe(true);
    expect(filled.states.get("total")?.readonlyReason).toBe("computed");

    const missing = resolveFormState({
      definition: { fields },
      values: { qty: "3" },
      ctx: ctxAt("2026-09-01T00:00:00Z"),
      mode: "create",
      permissions: OPEN_PERMISSIONS,
    });
    expect(missing.values.total).toBeNull();
  });

  it("readonly:不重算存值,條件用傳進來的(該修訂的)ctx", () => {
    const { values, states } = resolveFormState({
      definition: { fields },
      values: { qty: "2", price: "30", total: "999", late: "x" },
      ctx: ctxAt("2026-01-05T00:00:00Z"),
      mode: "readonly",
      permissions: OPEN_PERMISSIONS,
    });
    expect(values.total).toBe("999");
    expect(states.get("late")?.visible).toBe(false);
    expect(states.get("note")?.visible).toBe(true);
    expect(states.get("qty")?.readonlyReason).toBe("mode");
  });

  it("欄位級三態:沒有 show → 不渲染;有 show 沒有 edit → 唯讀(permission);readonlyWhen → 唯讀(condition)", () => {
    const { states } = resolveFormState({
      definition: { fields },
      values: { qty: "9" },
      ctx: ctxAt("2026-09-01T00:00:00Z"),
      mode: "edit",
      permissions: {
        canShow: (key) => key !== "secret",
        canEdit: (key) => key !== "price",
      },
    });
    expect(states.get("secret")).toMatchObject({
      visible: false,
      redacted: true,
    });
    expect(states.get("price")?.readonlyReason).toBe("permission");
    expect(states.get("locked")?.readonlyReason).toBe("condition");
    expect(states.get("qty")?.readonly).toBe(false);
  });

  it("api 回的 `[redacted]` 一律視為看不到", () => {
    const { states } = resolveFormState({
      definition: { fields },
      values: { price: "[redacted]" },
      ctx: ctxAt("2026-09-01T00:00:00Z"),
      mode: "readonly",
      permissions: OPEN_PERMISSIONS,
    });
    expect(states.get("price")?.visible).toBe(false);
  });
});
