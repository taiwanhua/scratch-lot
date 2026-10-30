import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import {
  type PrintButtonWorldOptions,
  printButtonWorld,
  printingModule,
} from "@/test/msw/print-button-handlers";
import {
  checkoutFormWorld,
  checkoutWorkflowWorld,
} from "@/test/msw/project/lottery/checkout-form-fixtures";
import {
  type CheckoutWorldOptions,
  checkoutWorld,
} from "@/test/msw/project/lottery/checkout-handlers";
import {
  type DailyCloseWorldOptions,
  dailyCloseWorld,
} from "@/test/msw/project/lottery/daily-close-handlers";
import { inventoryWorld } from "@/test/msw/project/lottery/inventory-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import { receiptLinksHandlers } from "@/test/msw/project/lottery/receipt-links-handlers";
import type { RedemptionFixture } from "@/test/msw/project/lottery/redemption-fixtures";
import { redemptionWorld } from "@/test/msw/project/lottery/redemption-handlers";
import {
  stocktakeFormWorld,
  stocktakeWorkflowWorld,
} from "@/test/msw/project/lottery/stocktake-form-fixtures";
import {
  type StocktakeWorldOptions,
  stocktakeWorld,
} from "@/test/msw/project/lottery/stocktake-handlers";
import {
  STORE_ALL_PERMISSIONS,
  storeModules,
} from "@/test/msw/project/lottery/store-fixtures";
import {
  type StoreFormsWorldOptions,
  storeFormsWorld,
} from "@/test/msw/project/lottery/store-forms-fixtures";
import {
  type StoreWorldOptions,
  storeWorld,
} from "@/test/msw/project/lottery/store-handlers";
import {
  type StoreSalesWorldOptions,
  storeSalesWorld,
} from "@/test/msw/project/lottery/store-sales-handlers";
import { scheduleSettingsWorld } from "@/test/msw/project/schedule-settings-handlers";
import { server } from "@/test/msw/server";
import { workflowRuntimeWorld } from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";

/** 開班視窗的 [打卡] 看我的班表的打卡權限(給在店面管理的模組上,`hasPermission` 只看 key)。 */
export const MY_PUNCH = "schedule.my.punch";

/**
 * 店面管理測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`storeWorld`;下拉選項借庫存管理與
 * 排班設定的假 api)。當前組織 = 中山店;本機收銀點存在 jsdom 的 localStorage(各測試自己清)。
 */
export const renderStore = ({
  path = "/store",
  permissions = [...STORE_ALL_PERMISSIONS, MY_PUNCH],
  world = {},
  sales = {},
  redemptionRows,
  forms = {},
  stocktakeOptions = {},
  checkoutOptions = {},
  dailyCloseOptions = {},
  printing,
  formRuntime = {},
}: {
  path?: string;
  permissions?: readonly string[];
  world?: StoreWorldOptions;
  /** 銷售的假 api 選項(看板狀態一律用 `storeWorld` 那一份) */
  sales?: Omit<StoreSalesWorldOptions, "board">;
  /** 兌獎紀錄的起始資料(預設 `sampleRedemptions()`) */
  redemptionRows?: RedemptionFixture[];
  /** 撤銷售出申請 / 現金更正單能不能新增(B9b) */
  forms?: StoreFormsWorldOptions;
  /** 盤點的假 api 選項(補登售出時已被處理的張、看板提醒) */
  stocktakeOptions?: StocktakeWorldOptions;
  /** 交班結帳的假 api 選項(精靈資料的覆寫) */
  checkoutOptions?: CheckoutWorldOptions;
  /** 日結 / 存銀行的假 api 選項(精靈、上次日結、存銀行視窗的覆寫) */
  dailyCloseOptions?: DailyCloseWorldOptions;
  /**
   * 列印(58mm 單據):給了才有 `api.printing`(`permissions` 預設列印 + 補印)與列印的假伺服器;
   * 不給 = 沒有收據機的租戶,不自動列印、沒有 [列印]
   */
  printing?: PrintButtonWorldOptions & { permissions?: string[] };
  /** 表單執行端的覆寫(送出失敗、送出後的狀態);表單 / 版本 / 提交是附加在內建四張之後(租戶自己綁的表單) */
  formRuntime?: Pick<
    FormRuntimeWorldOptions,
    | "failures"
    | "submitAs"
    | "moduleForms"
    | "versions"
    | "submissions"
    | "lookupRecords"
    | "lookupDefault"
  >;
} = {}) => {
  const printingFake =
    printing === undefined ? null : printButtonWorld(printing);
  const fake = storeWorld(world);
  const salesFake = storeSalesWorld({ ...sales, board: fake.state });
  const redemptions = redemptionWorld(redemptionRows);
  const formsFake = storeFormsWorld(forms);
  const stocktakeForms = stocktakeFormWorld();
  const checkoutForms = checkoutFormWorld();
  const runtime = formRuntimeWorld({
    ...formsFake.runtime,
    ...formRuntime,
    moduleForms: [
      ...(formsFake.runtime.moduleForms ?? []),
      ...(stocktakeForms.moduleForms ?? []),
      ...(checkoutForms.moduleForms ?? []),
      ...(formRuntime.moduleForms ?? []),
    ],
    versions: {
      ...formsFake.runtime.versions,
      ...stocktakeForms.versions,
      ...checkoutForms.versions,
      ...formRuntime.versions,
    },
    submissions: [
      ...(formsFake.runtime.submissions ?? []),
      ...(stocktakeForms.submissions ?? []),
      ...(checkoutForms.submissions ?? []),
      ...(formRuntime.submissions ?? []),
    ],
  });
  const stocktakeFlow = stocktakeWorkflowWorld();
  const checkoutFlow = checkoutWorkflowWorld();
  const stocktake = stocktakeWorld(stocktakeOptions);
  const workflow = workflowRuntimeWorld({
    instances: [...stocktakeFlow.instances, ...checkoutFlow.instances],
    tasks: [...stocktakeFlow.tasks, ...checkoutFlow.tasks],
  });
  const dailyClose = dailyCloseWorld(dailyCloseOptions);
  server.use(
    ...(printingFake?.handlers ?? []),
    ...(printing === undefined ? [] : receiptLinksHandlers()),
    ...stocktake.handlers,
    ...checkoutWorld(checkoutOptions).handlers,
    ...dailyClose.handlers,
    ...workflow.handlers,
    ...formsFake.handlers,
    ...runtime.handlers,
    ...fake.handlers,
    ...salesFake.handlers,
    ...redemptions.handlers,
    ...inventoryWorld().handlers,
    ...scheduleSettingsWorld().handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [masterDataOrgs.storeA],
      modules: [
        overviewModule,
        ...storeModules(permissions),
        ...(printing === undefined
          ? []
          : [
              printingModule(
                printing.permissions ?? [
                  "api.printing.print",
                  "api.printing.reprint",
                ],
              ),
            ]),
      ],
    }).handlers,
  );
  return {
    ...renderApp({ path }),
    fake,
    salesFake,
    redemptions,
    runtime,
    stocktake,
    dailyClose,
    printingFake,
    workflow,
  };
};
