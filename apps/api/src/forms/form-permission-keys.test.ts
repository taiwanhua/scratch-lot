import { describe, expect, it } from "@jest/globals";

import {
  fieldPermissionKey,
  parseFieldPermissionKey,
  parseFormPermissionKey,
} from "./form-permission-keys";

describe("表單動態權限 key 的解析", () => {
  it("欄位級權限 `show-` / `edit-<formKey>-<fieldKey>` 拆回四段", () => {
    const key = fieldPermissionKey("demo.form", "edit", "leave", "reason");
    const expected = {
      moduleKey: "demo.form",
      action: "edit",
      formKey: "leave",
      fieldKey: "reason",
    };
    expect(parseFormPermissionKey(key)).toEqual(expected);
    expect(parseFieldPermissionKey(key)).toEqual(expected);
    expect(parseFieldPermissionKey("demo-form.show-leave-days")).toMatchObject({
      action: "show",
      formKey: "leave",
      fieldKey: "days",
    });
  });

  it("依表單新增權限 `create-<formKey>`:表單動態權限認得,欄位級解析不認", () => {
    expect(parseFormPermissionKey("demo-form.create-leave_v2")).toEqual({
      moduleKey: "demo-form",
      action: "create",
      formKey: "leave_v2",
    });
    expect(parseFieldPermissionKey("demo-form.create-leave_v2")).toBeNull();
  });

  it("其他形狀一律 null:固定權限、wildcard、隱藏頁的權限、沒有模組段", () => {
    for (const key of [
      "demo-form.create",
      "demo-form.*",
      "demo-form.create-page.view",
      "demo-form.create-",
      "demo-form.create-leave-days",
      "demo-form.show-leave",
      "demo-form.delete-leave",
      "create-leave",
    ]) {
      expect(parseFormPermissionKey(key)).toBeNull();
      expect(parseFieldPermissionKey(key)).toBeNull();
    }
  });
});
