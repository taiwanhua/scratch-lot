import { Injectable } from "@nestjs/common";

import type { OperatorContext } from "../database/operator-context";

/** `registerBadge` 的參數。 */
export interface SidebarBadgeRegistration {
  /**
   * 模組 key(側欄節點與信號 `badge:<模組 key>` 用同一個);底座與專案共用一個命名空間。
   * 操作者的角色綁了這個模組(`me.modules` 有它,同進得去那一頁的判斷)才算「看得到」;填了 `requires` 時還要持有那條權限。
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
}

/** 登記不合契約(key 空白、前後有空白或重複)時拋出;屬程式錯誤,讓 app 起不來。 */
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
    if (this.registered.has(key)) {
      throw new SidebarBadgeRegistrationError(
        `側欄計數的模組 key「${key}」重複登記`,
      );
    }
    this.registered.set(key, registration);
  }

  /** 已登記的計數(依登記順序)。 */
  badges(): readonly SidebarBadgeRegistration[] {
    return [...this.registered.values()];
  }
}
