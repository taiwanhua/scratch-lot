import { createDemoItemOne, createDemoItemTwo, switchOrg } from "./api";
import type { ScenarioTenant } from "./scenario-tenant";

/**
 * 「劇本 2 / 12 的共同前置資料」(`docs/testing/permission-scenarios.md` 的同名小節):
 * 同一個可見範圍裡、**建立者與所屬組織都不同**的幾筆業務資料。
 *
 * **與 `scenario-tenant.ts` 分開一支**:租戶 fixture 做的是文件的
 * 「驗收前的準備」四步(組織 / 帳號 / 角色),劇本 1 / 5 / 7 根本不需要這幾筆業務資料 ——
 * 塞進去等於每條劇本都多付建資料的時間。要用的劇本自己在測試開頭叫一次。
 *
 * seed 的 10 筆示範資料全部落在根組織(`apps/db-migrator/seeds/base/demo-items.ts`),
 * 租戶帳號一登入兩支示範模組的列表都是空的 —— 所以要比「看得到 / 看不到」一律自己先建。
 *
 * 名稱一律帶租戶的隨機字尾:同一個資料庫上跑很多條劇本,定位才不會撈到別條劇本的資料。
 */

export interface ScenarioDemoItem {
  id: string;
  name: string;
}

export interface ScenarioDemoItems {
  /** 示範模組1:+user(當前組織 = 南港店)自己建的第 1 筆。 */
  ownedOne: ScenarioDemoItem;
  /** 示範模組1:+user 自己建的第 2 筆。 */
  ownedTwo: ScenarioDemoItem;
  /** 示範模組1:+tenant 站在**南港店**建的 —— 與 +user 同一個可見範圍、建立者不同。 */
  peerInNangang: ScenarioDemoItem;
  /** 示範模組1:+tenant 站在**租戶頂層**建的 —— +user 不屬租戶頂層,看不到。 */
  peerAtTenantTop: ScenarioDemoItem;
  /** 示範模組2 的對照組(劇本 3):同樣三種擁有者 / 組織的組合各一筆。 */
  two: {
    owned: ScenarioDemoItem;
    peerInNangang: ScenarioDemoItem;
    peerAtTenantTop: ScenarioDemoItem;
  };
  /** 沒有任何資料範圍規則時,+user 在**示範模組1** 列表上看得到的三筆。 */
  memberVisibleOne: readonly string[];
  /** 沒有任何資料範圍規則時,+user 在**示範模組2** 列表上看得到的兩筆。 */
  memberVisibleTwo: readonly string[];
}

/** 四筆 / 三筆一律照文件的順序建,建完回傳每一筆的 id 與名稱。 */
export async function createScenarioDemoItems(
  tenant: ScenarioTenant,
): Promise<ScenarioDemoItems> {
  const { slug, member, tenantAdmin, tenantOrgId, nangangOrgId } = tenant;

  /**
   * +tenant 同時屬於租戶頂層與南港店,建出來的資料掛在**當前組織**上,
   * 所以兩張 token 各自代表一個「站在哪裡」(`switchOrg` 是換發、舊的那張不失效)。
   */
  const adminAtTop = await switchOrg(tenantAdmin.token, tenantOrgId);
  const adminAtNangang = await switchOrg(tenantAdmin.token, nangangOrgId);

  const one = async (
    token: string,
    name: string,
  ): Promise<ScenarioDemoItem> => ({
    id: await createDemoItemOne(token, { name }),
    name,
  });
  const two = async (
    token: string,
    name: string,
  ): Promise<ScenarioDemoItem> => ({
    id: await createDemoItemTwo(token, { name }),
    name,
  });

  // 1. +user(當前組織 = 南港店)在示範模組1 新增 2 筆
  const ownedOne = await one(member.token, `南港-自建1-${slug}`);
  const ownedTwo = await one(member.token, `南港-自建2-${slug}`);
  // 2. +tenant 切到南港店,新增 1 筆
  const peerInNangang = await one(adminAtNangang, `南港-他人-${slug}`);
  // 3. +tenant 切回租戶頂層,新增 1 筆
  const peerAtTenantTop = await one(adminAtTop, `頂層-他人-${slug}`);
  // 4. 示範模組2 也照樣各建一筆(劇本 3 的對照組)
  const twoOwned = await two(member.token, `模組2-南港-自建-${slug}`);
  const twoPeerInNangang = await two(adminAtNangang, `模組2-南港-他人-${slug}`);
  const twoPeerAtTenantTop = await two(adminAtTop, `模組2-頂層-他人-${slug}`);

  return {
    ownedOne,
    ownedTwo,
    peerInNangang,
    peerAtTenantTop,
    two: {
      owned: twoOwned,
      peerInNangang: twoPeerInNangang,
      peerAtTenantTop: twoPeerAtTenantTop,
    },
    memberVisibleOne: [ownedOne.name, ownedTwo.name, peerInNangang.name],
    memberVisibleTwo: [twoOwned.name, twoPeerInNangang.name],
  };
}
