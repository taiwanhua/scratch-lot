import { Injectable } from "@nestjs/common";

import type { AudienceOptions } from "@repo/domain/audience";

import type { OperatorContext } from "../database/operator-context";

/**
 * 側欄數字「誰看得到」的人員條件能用的欄位(租戶在通知設定頁調整;與通知收件人同一套):
 * 不能「所有人」(沒調整就是程式預設)、只有使用者 / 角色 / 權限 —— 「綁了模組」一律是前提,條件只在它之上再收窄。
 */
export const SIDEBAR_BADGE_AUDIENCE_OPTIONS: AudienceOptions = {
  allowAll: false,
  fields: ["user", "role", "permission"],
  orgSources: [],
};

/** `registerBadge` 的參數。 */
export interface SidebarBadgeRegistration {
  /**
   * 模組 key(側欄節點與信號 `badge:<模組 key>` 用同一個);底座與專案共用一個命名空間。
   * 操作者的角色綁了這個模組(`me.modules` 有它,同進得去那一頁的判斷)才算「看得到」;填了 `requires` 時還要持有那條權限。
   * 租戶在通知設定頁調整了「誰看得到」(`sidebar_badge_settings`)時,綁了模組之後改看那份人員條件(不再看 `requires`)。
   * 看不到就不算、不回傳。
   */
  readonly moduleKey: string;
  /**
   * 這個操作者的數字;拋錯時這一筆不回傳(記 log),其他模組照常。
   * 數字本身的租戶、可見範圍、資料範圍由 `count` 自己負責(用 BaseRepository 帶操作者查);底座只依門檻(綁模組、`requires`)過濾。
   */
  readonly count: (operator: OperatorContext) => Promise<number>;
  /**
   * 選填:除了綁了模組,還要持有這條權限才算(`holdsPermission`,同層 `*` 照常展開)。
   * 沒填(預設)= 綁了模組就算。要讓數字與列表一樣只給看得到列表的人時填(例:`apply-center.view`)。
   */
  readonly requires?: string;
  /**
   * 選填:「數什麼」的說明文字在 admin 訊息檔的完整 key(例 `admin.sidebarBadgeSettings.descriptions.orders`),
   * 通知設定頁「側欄數字」區塊顯示;沒填 = 顯示「—」。底座的 key 寫在底座字典、專案的寫在專案字典。
   */
  readonly descriptionKey?: string;
}

/** 登記不合契約(key 空白、前後有空白或重複;descriptionKey 空白)時拋出;屬程式錯誤,讓 app 起不來。 */
export class SidebarBadgeRegistrationError extends Error {
  override name = "SidebarBadgeRegistrationError";
}

/**
 * 側欄計數的登記處:底座與專案的功能模組各自在 `onModuleInit` 呼叫
 * `registerBadge({ moduleKey, count })`;`sidebarBadges` 一次回傳操作者看得到的全部數字。
 * 數字變了由寫入端在交易後呼叫 `RealtimePublisher.publishBadge(tenantId, moduleKey, userIds)`。
 */
@Injectable()
export class SidebarBadgeRegistry {
  private readonly registered = new Map<string, SidebarBadgeRegistration>();

  registerBadge(registration: SidebarBadgeRegistration): void {
    const key = registration.moduleKey.trim();
    if (key === "" || key !== registration.moduleKey) {
      throw new SidebarBadgeRegistrationError(
        `側欄計數的模組 key 不可空白或前後有空白:「${registration.moduleKey}」`,
      );
    }
    if (
      registration.descriptionKey !== undefined &&
      (registration.descriptionKey.trim() === "" ||
        registration.descriptionKey.trim() !== registration.descriptionKey)
    ) {
      throw new SidebarBadgeRegistrationError(
        `側欄計數「${key}」的 descriptionKey 不可空白或前後有空白`,
      );
    }
    if (this.registered.has(key)) {
      throw new SidebarBadgeRegistrationError(
        `側欄計數的模組 key「${key}」重複登記`,
      );
    }
    this.registered.set(key, registration);
  }

  /** 某個模組的登記;沒登記 = undefined。 */
  badgeOf(moduleKey: string): SidebarBadgeRegistration | undefined {
    return this.registered.get(moduleKey);
  }

  /** 已登記的計數(依登記順序)。 */
  badges(): readonly SidebarBadgeRegistration[] {
    return [...this.registered.values()];
  }
}
