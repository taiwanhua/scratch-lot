import { describe, expect, it, jest } from "@jest/globals";

import {
  type FormGuard,
  type FormLifecycleRegistration,
  FormLifecycleRegistrationError,
  composeFormLifecycles,
  registerFormLifecycle,
  resolveLifecycleInjections,
} from "./form-lifecycle-registration";
import { FormLifecycleService } from "./form-lifecycle.service";

class StockRepository {}
class MissingService {}
class UndeclaredService {}

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

  it('formKey 寫 "*" → 拋錯(整個模組請省略 formKey)', () => {
    expect(() => composeFormLifecycles([purchase({ formKey: "*" })])).toThrow(
      /formKey 不可是 "\*"/,
    );
  });

  it("inject 有空的 token 或重複 → 拋錯", () => {
    expect(() =>
      composeFormLifecycles([purchase({ inject: [undefined as never] })]),
    ).toThrow(/inject 有空的 token/);
    expect(() =>
      composeFormLifecycles([
        purchase({ inject: [StockRepository, StockRepository] }),
      ]),
    ).toThrow(/inject 重複列了 StockRepository/);
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

describe("resolveLifecycleInjections(inject 的解析)", () => {
  const stock = new StockRepository();
  const resolve = (token: unknown): unknown => {
    if (token === StockRepository) {
      return stock;
    }
    throw new Error(`Nest could not find ${String(token)}`);
  };

  it("宣告的拿得到;沒宣告的 → 拋錯", () => {
    const registration = purchase({ inject: [StockRepository] });
    const get = resolveLifecycleInjections([registration], resolve).get(
      registration,
    );
    expect(get?.(StockRepository)).toBe(stock);
    expect(() => get?.(UndeclaredService)).toThrow(
      /沒有在 inject 宣告 UndeclaredService/,
    );
  });

  it("宣告的 token 不存在 → FormLifecycleRegistrationError", () => {
    expect(() =>
      resolveLifecycleInjections(
        [purchase({ inject: [MissingService] })],
        resolve,
      ),
    ).toThrow(FormLifecycleRegistrationError);
  });

  it("FormLifecycleService 啟動(onModuleInit)時解析;找不到 → app 起不來", () => {
    const service = new FormLifecycleService(
      composeFormLifecycles([purchase({ inject: [MissingService] })]),
      {} as never,
      {} as never,
      { get: (token: unknown) => resolve(token) } as never,
      {} as never,
      {} as never,
    );
    expect(() => {
      service.onModuleInit();
    }).toThrow(/inject 的 MissingService 找不到/);
  });
});
