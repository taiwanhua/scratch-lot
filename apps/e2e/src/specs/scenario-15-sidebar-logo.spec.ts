import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { GCS_BUCKET_PRIVATE, GCS_ENDPOINT } from "../config";
import { ORG_MANAGER_ROUTE } from "../fixtures/demo-keys";
import { expect, test } from "../fixtures/test";
import {
  clearOrgLogoInUi,
  expectImageLoaded,
  setOrgLogoInUi,
  sideNav,
  sideNavLogo,
  signIn,
} from "../fixtures/ui";
import {
  assetPath,
  fakeGcsSkipReason,
  fetchAnonymously,
} from "../harness/fake-gcs";

/**
 * 劇本 15 — 側欄商標繼承
 * 正本:`docs/testing/permission-scenarios.md`「劇本 15」;規則見 ADR-0010 與
 * `docs/modules/org-manager.md`(商標上傳;`me.currentOrg.logoUrl` 沿 `ancestors` 由近到遠找)。
 * 用哪一頁:組織管理 → 編輯組織的商標欄(+tenant);結果看 +user 的側欄。
 *
 * 商標真的傳到 **fake GCS 容器**,側欄的 `<img>` 讀的是 api 現簽的讀取網址。
 * 「顯示的是哪一張」用**讀回來的內容**比對原檔判斷(兩張測試圖顏色不同、內容不同),
 * 不比網址 —— 每次取 `me` 都會重簽,網址本來就一直在變。本機沒有 Docker 時整條 skip。
 *
 * `rootPage` fixture 只是「自己一個 context 的第二個分頁」,這裡給 +user 用:
 * +tenant 在 `page` 改商標、+user 在另一個 context 看側欄,兩邊的登入互不干擾。
 */

const skipReason = fakeGcsSkipReason();
test.skip(skipReason !== null, skipReason ?? "");

const TENANT_LOGO = assetPath("logo-tenant.png");
const NANGANG_LOGO = assetPath("logo-nangang.png");
/** +user 的當前組織(`createScenarioTenant` 建的分店名稱);側欄商標的 `alt` 就是它。 */
const NANGANG = "南港店";

/** +user 的側欄商標:載得出來、是私有 bucket 的簽名網址,讀回來的內容等於 `expectedFile`。 */
async function expectSideNavLogo(
  memberPage: Page,
  expectedFile: string,
): Promise<string> {
  const logo = sideNavLogo(memberPage, NANGANG);
  await expectImageLoaded(logo);
  const url = new URL((await logo.getAttribute("src")) ?? "");
  expect(url.origin).toBe(GCS_ENDPOINT);
  expect(url.pathname).toMatch(
    new RegExp(
      String.raw`^/${GCS_BUCKET_PRIVATE}/org-logos/[0-9a-f-]{36}\.png$`,
    ),
  );
  expect(url.searchParams.get("X-Goog-Signature")).not.toBeNull();
  const read = await fetchAnonymously(url.href);
  expect(read.status).toBe(200);
  expect(read.body.equals(readFileSync(expectedFile))).toBe(true);
  return url.href;
}

test("劇本 15:下層沒設商標就沿上層繼承,自己設了顯示自己的,清掉又回到繼承的那張", async ({
  page,
  rootPage: memberPage,
  tenant,
}) => {
  const { tenantAdmin, member, tenantOrgName } = tenant;

  // 前置對照:還沒有人設商標 → +user 的側欄頂部是組織名稱的文字,沒有商標圖
  await signIn(memberPage, member.account, member.password);
  await expect(sideNav(memberPage).getByText(NANGANG)).toBeVisible();
  await expect(sideNavLogo(memberPage, NANGANG)).toHaveCount(0);

  await signIn(page, tenantAdmin.account, tenantAdmin.password);
  await page.goto(ORG_MANAGER_ROUTE);

  // 步驟 1:+tenant 在**租戶頂層**上傳商標、南港店不設 → +user 重新登入,側欄顯示租戶頂層那張
  await setOrgLogoInUi(page, tenantOrgName, TENANT_LOGO);
  await memberPage.reload();
  await expectSideNavLogo(memberPage, TENANT_LOGO);

  // 步驟 2:+tenant 在**南港店**也上傳一張 → +user 改顯示南港店自己的
  await setOrgLogoInUi(page, NANGANG, NANGANG_LOGO);
  await memberPage.reload();
  const nangangLogoUrl = await expectSideNavLogo(memberPage, NANGANG_LOGO);

  // 步驟 3:把南港店那張清掉 → +user 又回到繼承來的租戶頂層那張
  await clearOrgLogoInUi(page, NANGANG);
  await memberPage.reload();
  await expectSideNavLogo(memberPage, TENANT_LOGO);

  // 附帶:「換圖即刪舊」(ADR-0010)—— 清掉的那個物件真的從 bucket 刪了。
  // 步驟 2 簽的網址還在效期內,但物件已經不在(fake GCS 不驗簽章,所以 404 只可能是物件沒了)
  const removed = await fetchAnonymously(nangangLogoUrl);
  expect(removed.status).toBe(404);
});
