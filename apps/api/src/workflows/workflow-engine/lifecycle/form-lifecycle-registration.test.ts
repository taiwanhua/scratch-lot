import { describe, expect, it, jest } from "@jest/globals";

import {
  type FormGuard,
  type FormLifecycleRegistration,
  FormLifecycleRegistrationError,
  composeFormLifecycles,
  registerFormLifecycle,
} from "./form-lifecycle-registration";

const pass: FormGuard = () => null;

function purchase(
  overrides: Partial<FormLifecycleRegistration> = {},
): FormLifecycleRegistration {
  return registerFormLifecycle({
    moduleKey: "purchasing.purchase",
    formKey: "purchase",
    guards: { beforeApprove: pass },
    ...overrides,
  });
}

describe("composeFormLifecycles(掛接點登記的組裝驗證)", () => {
  it("依 (moduleKey, formKey) 找到那一筆;省略 formKey = 整個模組", () => {
    const moduleWide = purchase({
      moduleKey: "stock.count",
      formKey: undefined,
    });
    const lifecycles = composeFormLifecycles([purchase(), moduleWide]);
    expect(lifecycles.lookup("purchasing.purchase", "purchase")?.formKey).toBe(
      "purchase",
    );
    expect(lifecycles.lookup("purchasing.purchase", "other")).toBeNull();
    expect(lifecycles.lookup("stock.count", "anything")).toBe(moduleWide);
    expect(lifecycles.lookup("unknown", "purchase")).toBeNull();
  });

  it("同一個 (moduleKey, formKey) 重複 → 拋錯", () => {
    expect(() => composeFormLifecycles([purchase(), purchase()])).toThrow(
      FormLifecycleRegistrationError,
    );
    const moduleWide = purchase({ formKey: undefined });
    expect(() => composeFormLifecycles([moduleWide, moduleWide])).toThrow(
      /重複登記/,
    );
  });

  it("同一個模組不能同時登記整個模組與指定表單", () => {
    expect(() =>
      composeFormLifecycles([purchase(), purchase({ formKey: undefined })]),
    ).toThrow(/不能同時登記整個模組與指定表單/);
  });

  it("不認得的守門 / 事後動作名、不是函式、key 空白 → 拋錯", () => {
    expect(() =>
      composeFormLifecycles([
        purchase({ guards: { beforeApproved: pass } as never }),
      ]),
    ).toThrow(/沒有 守門「beforeApproved」/);
    expect(() =>
      composeFormLifecycles([
        purchase({ effects: { approved: () => null } as never }),
      ]),
    ).toThrow(/沒有 事後動作「approved」/);
    expect(() =>
      composeFormLifecycles([
        purchase({ effects: { completed: "nope" } as never }),
      ]),
    ).toThrow(/必須是函式/);
    expect(() => composeFormLifecycles([purchase({ moduleKey: " " })])).toThrow(
      /不可空白/,
    );
    expect(() => composeFormLifecycles([purchase({ formKey: "" })])).toThrow(
      /不可空白/,
    );
  });

  it("固定入口重複登記 → 載入組裝入口(DatabaseModule)就拋錯,app 起不來", () => {
    jest.isolateModules(() => {
      jest.doMock("../../../project/form-lifecycles", () => ({
        PROJECT_FORM_LIFECYCLES: [purchase(), purchase()],
      }));
      expect(() =>
        jest.requireActual("../../../database/database.module"),
      ).toThrow(/purchasing\.purchase \/ purchase 重複登記/);
    });
  });
});
