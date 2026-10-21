import type { TenantBoundaryContextPurpose } from "../../database/tenant-boundary-purposes";

/**
 * 專案裡**允許呼叫租戶邊界出口(`BaseRepository.existsInTenant` / `findRefsInTenant`)的檔案**
 * (相對 `apps/api/src/`;規則與底座清單見 `database/base.repository.ts` 的 `TENANT_BOUNDARY_CALLERS`)。
 * `database/exists-any-callers.test.ts` 合併兩份清單掃整個 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_TENANT_BOUNDARY_CALLERS: readonly string[] = [
  "project/lottery/accounts/bank-accounts.service.ts",
  "project/lottery/cash-points/cash-points.service.ts",
  "project/lottery/dealers/dealer-contacts.service.ts",
  "project/lottery/dealers/dealer-links.service.ts",
  "project/lottery/dealers/dealer-view.service.ts",
  "project/lottery/dealers/dealers.service.ts",
  "project/lottery/games/games.service.ts",
  // 遊戲是否有本引用(整個租戶有沒有)、本編號租戶內唯一
  "project/lottery/tickets/book-game-usage.ts",
  "project/lottery/tickets/books.service.ts",
  // 遊戲是否有叫貨單引用(整個租戶有沒有)
  "project/lottery/requisition/requisition-registrations.ts",
];

/**
 * 專案裡**允許呼叫 `tenantBoundaryContext` 的檔案**與用途(規則與底座清單見
 * `database/tenant-boundary-context.ts` 的 `TENANT_BOUNDARY_CONTEXT_CALLERS`)。
 * `database/tenant-boundary-context.test.ts` 合併兩份清單掃 src;這份只能列 `project/` 的檔案。
 */
export const PROJECT_TENANT_BOUNDARY_CONTEXT_CALLERS: Readonly<
  Record<string, readonly TenantBoundaryContextPurpose[]>
> = {
  // 共同銷售人 / 已被對應的分店 / 關係人掛在哪些經銷商、看得到的經銷商的關聯列、對應分店是否在租戶;
  // 關係人取消身分時連帶解除看不到的經銷商上的關聯
  "project/lottery/dealers/dealer-links.service.ts": ["反查", "例外寫入"],
  // 對應分店的名稱(分店可能不在讀者的可見範圍)
  "project/lottery/dealers/dealer-view.service.ts": ["反查"],
  // 證照到期 / 牌租提醒逐租戶跑
  "project/lottery/dealers/dealer-reminders.service.ts": ["排程"],
  // 批購日重算(進貨單 / 經銷商在交易內呼叫,沒有操作者;不是排程)
  "project/lottery/dealers/purchase-dates.ts": ["系統重算"],
  // 畫休屬於人、守門文件掛在租戶頂層:跨店讀寫
  "project/schedule/day-offs/schedule-day-offs.service.ts": ["以人為準的資料"],
  // 畫休開放 / 截止提醒逐租戶跑
  "project/schedule/day-offs/day-off-reminders.service.ts": ["排程"],
  // 候選使用者、排班檔案、可以排的分店關聯(以人為準,看不到的分店的關聯保留)
  "project/schedule/staff/schedule-staff.service.ts": ["以人為準的資料"],
  // 張數帳本:跨店的寫入(調入、尋回到刷到的那家店)與換店後重算本的持有分店(要看整本的張)
  "project/lottery/tickets/ticket-ledger.service.ts": ["例外寫入", "系統重算"],
  // 本的即時計算要看整本的張(各分店持有)
  "project/lottery/tickets/books.service.ts": ["反查"],
  // 已給本數:出貨店也要算得出收貨店的(整個租戶的張數事件)
  "project/lottery/tickets/allocations.service.ts": ["反查"],
  // 遊戲是否有本引用:沒有操作者,問的是整個租戶
  "project/lottery/tickets/book-game-usage.ts": ["系統重算"],
  // 庫存管理:看得到本就看得到它全部的張與事件(格子、時間軸、各分店持有)
  "project/lottery/inventory/inventory-view.service.ts": ["反查"],
  // 庫存管理:分店與使用者名稱、組織樹(分店可能不在讀者的可見範圍)
  "project/lottery/inventory/inventory-names.ts": ["反查"],
  // 尋回:刷到的張可能還在別的分店(先讀狀態;寫入經帳本的跨店寫入)
  "project/lottery/inventory/inventory-actions.service.ts": ["反查"],
  // 看得到帳戶 / 單據 / 交易,就看得到它掛的分店名稱與登記人(使用組織可能是讀者看不到的組織)
  "project/lottery/accounts/account-names.ts": ["反查"],
  // 看得到帳戶就看得到它的交易(交易可能是別家分店登記的);存入被沖正時連結的存銀行流水自動反向
  "project/lottery/accounts/bank-transactions.service.ts": ["反查", "例外寫入"],
  // 看得到單據就看得到它的收付(另一邊可能是別家分店記的)
  "project/lottery/settlement/settlement-ledger.ts": ["反查"],
  // 收付歷程、帳戶名稱、付款帳戶的使用組織比對分店的上層、自動記帳讀單據租戶的帳戶(只讀;寫入一律照可見範圍)
  "project/lottery/settlement/settlement.service.ts": ["反查"],
  // 一個人在整個租戶的排班:跨店不能重疊、別家店的班顯示灰色區塊
  "project/schedule/roster/roster-people.ts": ["以人為準的資料"],
  // 我的班表:我的班跨分店合併(分店不一定看得到)、打卡寫在班所在的分店
  "project/schedule/my/my-schedule.service.ts": ["以人為準的資料", "例外寫入"],
  // 出勤紀錄看自己的:我的班跨分店合併(支援別家店的班也列)
  "project/schedule/attendance/attendance.service.ts": ["以人為準的資料"],
  // 補打卡申請:本人在別家店的班(送出 / 核准時檢查);完成時以系統身分寫打卡(單據的組織不一定是班的分店)
  // 審核畫面查選的排班還在不在(審核者不一定看得到排班的組織)
  "project/schedule/attendance/makeup-punch.service.ts": [
    "以人為準的資料",
    "例外寫入",
    "反查",
  ],
  // 排班 / 畫休寫入的「人」守門文件掛在租戶頂層(兩家店同時排同一人、排班與畫休同時寫入互相衝突)
  "project/schedule/shared/schedule-person-locks.ts": ["例外寫入"],
  // 遊戲是否有叫貨單引用、某家店待購買的叫貨單本數(在途):沒有操作者,問的是整個租戶
  "project/lottery/requisition/requisition-registrations.ts": ["系統重算"],
  // 進貨單 / 調貨單引用叫貨單:系統身分只看得到單據所屬的店(調貨單是出貨店),叫貨單在收貨店
  "project/lottery/requisition/requisition-reference.ts": ["例外寫入"],
  // 進貨單:本號和其他有效進貨單 / 既有的本重複、已點收的列、叫貨單 / 甲類 / 受託人(總部建的單,系統身分
  // 只看得到單據的組織);作廢時撤銷點收過的本、寫「進貨作廢」事件
  "project/lottery/purchase/purchase-rules.service.ts": ["反查", "例外寫入"],
  // 店面:一個人在整個租戶開著的班(只能同時開同一家店的班)
  "project/lottery/store/store-shifts.service.ts": ["以人為準的資料"],
  // 店面:班次負責人的名稱(負責人可能是別家分店支援的人)
  "project/lottery/store/shift-views.ts": ["反查"],
  // 店面刷到刮刮樂:待查 / 遺失的張可能還在別家店(任何一家店刷到都提示尋回)、不是本店的也要說得出來
  "project/lottery/store/store-sales.service.ts": ["反查"],
  // 店面的登記:收付找開著的班、收銀點停用守門、崗位旁的收銀點名稱、被班次綁定的排班(沒有操作者)
  "project/lottery/store/store-registrations.ts": ["系統重算"],
  // 店面:開班的「人」守門文件掛在租戶頂層(兩家店同時開班互相衝突)
  "project/lottery/store/store-person-locks.ts": ["例外寫入"],
  // 撤銷售出申請 / 現金更正單:單據可能是總部建的,系統身分只看得到單據的組織;完成時寫分店的流水與班
  "project/lottery/store/store-forms-rules.service.ts": ["反查", "例外寫入"],
  // 遊戲是否有進貨單引用、在途本數、甲類的批購日來源:沒有操作者,問的是整個租戶
  "project/lottery/purchase/purchase-registrations.ts": ["系統重算"],
  // 調貨單:本 / 張 / 其他調貨單 / 叫貨單(單據可能是總部建的,系統身分只看得到單據的組織;張分在多家店)、
  // 點收關卡是流程實例的最後一關
  "project/lottery/transfer/transfer-rules.service.ts": ["反查"],
  // 調貨單讀取放行:出貨店、收貨店兩邊都看得到;點收資格讀流程實例的最後一關
  "project/lottery/transfer/transfer-access.ts": ["反查"],
  // 調貨點收:送錯分店時查別家店的調貨單與本
  "project/lottery/transfer/transfer-receiving.service.ts": ["反查"],
  // 新增頁的選本與張數格子(本的張分在多家店)、列表進度(兩邊店都看得到)
  "project/lottery/transfer/transfer-query.service.ts": ["反查"],
  // 在途本數、收付的已點收金額、側欄計數讀流程實例:沒有操作者,問的是整個租戶
  "project/lottery/transfer/transfer-registrations.ts": ["系統重算"],
  // 點收:店長從申請中心進來,總部建的單不在他的可見範圍;送錯分店要查別家店的進貨單
  // 進貨單檢視頁讀勾選的兌獎紀錄(兌獎紀錄在分店,讀取依據是讀得到這張進貨單)
  "project/lottery/purchase/purchase-receiving.service.ts": ["反查"],
  // 受託人的關聯(關係人可能是別的組織建的);點收進度讀點收紀錄
  "project/lottery/purchase/purchase-query.service.ts": ["反查"],
  // 兌獎:這張在整個租戶有沒有未撤銷的兌獎(別家店兌過也算)
  "project/lottery/redemption/redemption.service.ts": ["反查"],
  // 兌獎紀錄:登記人 / 撤銷人 / 班次負責人的名稱、班次、進貨單單號(人可能是別家分店支援的、進貨單是總部建的)
  "project/lottery/redemption/redemption-views.ts": ["反查"],
  // 進貨單勾選兌獎:掛接點以系統身分執行,兌獎紀錄在分店(送出前讀勾選的紀錄;送兌 / 回到店內持有)
  "project/lottery/redemption/redemption-purchase-link.ts": [
    "反查",
    "例外寫入",
  ],
  // 盤點:掛接點以系統身分建立盤點單、核准完成時套用待查 / 遺失 / 尋回(盤點單與張在分店,申請可能是總部送的)
  "project/lottery/stocktake/stocktake.service.ts": ["反查", "例外寫入"],
  // 盤點紀錄 / 檢視頁:審核者從申請中心進來讀盤點單、申請的單號(分店不一定在他的可見範圍)
  "project/lottery/stocktake/stocktake-query.service.ts": ["反查"],
  // 交班結帳:掛接點以系統身分建立結帳單、結束班次、更新下一班期初(例外寫入);人名、單號、接班人候選反查
  "project/lottery/checkout/checkout.service.ts": ["反查", "例外寫入"],
  "project/lottery/checkout/checkout-query.service.ts": ["反查"],
  // 日結:掛接點以系統身分建立結帳單、全店盤點單,完成時寫銀行「存入」與「存銀行」流水(例外寫入);
  // 精靈的人名、單號、流程任務反查
  "project/lottery/daily-close/daily-close.service.ts": ["反查", "例外寫入"],
  "project/lottery/daily-close/daily-close-query.service.ts": ["反查"],
  // 小金庫起算點、上一班是否已被日結涵蓋:沒有操作者,問的是整個租戶
  "project/lottery/daily-close/daily-close-registrations.ts": ["系統重算"],
  // 日結逾期提醒逐租戶跑
  "project/lottery/daily-close/daily-close-reminders.service.ts": ["排程"],
  // 「不能選已關帳月份」:關帳紀錄歸屬租戶頂層,分店的人也要被同一條規則擋下
  "project/lottery/accounts/period-lock.ts": ["反查"],
  // 關帳:檢查清單與快照看整個租戶(班、單據、帳戶、小金庫);關帳紀錄寫在租戶頂層
  "project/lottery/period-close/period-close.service.ts": ["反查", "例外寫入"],
  // 關帳逾期提醒逐租戶跑
  "project/lottery/period-close/period-close-reminders.service.ts": ["排程"],
  // 排班檢核:人的規則用那個人主要分店的生效設定(主要分店不一定在讀者的可見範圍)
  "project/schedule/check/schedule-check.service.ts": ["以人為準的資料"],
};
