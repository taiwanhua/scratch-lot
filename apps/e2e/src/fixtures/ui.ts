import { type Locator, type Page, expect } from "@playwright/test";

/** admin 畫面上共用的操作與定位(TEST-11:UI 只走要驗的那一段,共用動作抽在這裡)。 */

/** 從登入頁登入;停在非登入頁才算成功。 */
export async function signIn(
  page: Page,
  account: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="account"]').fill(account);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * 權限矩陣的一列。
 *
 * 每一列的列尾都印著那一筆的 key(`MatrixTree` 的 `labelSuffix`),而 key 全樹唯一,
 * 所以用它定位最穩;子列住在自己的 `ul` 裡,不會被父列的 `.MuiTreeItem-content` 撈到。
 */
export function matrixRow(page: Page, key: string): Locator {
  return page
    .locator(".MuiTreeItem-content")
    .filter({ has: page.getByText(key, { exact: true }) });
}

/** 某一列自己的勾選框。 */
export function matrixCheckbox(page: Page, key: string): Locator {
  return matrixRow(page, key).locator('input[type="checkbox"]');
}

/**
 * MUI 的 `TextField select`:點開下拉、點一個選項。
 * 下拉的無障礙名字只取浮動標籤(`SelectInput` 的 `aria-labelledby` 只指標籤),
 * 選中值不會混進名字裡;選單渲染在 `body` 底下的 Popover,所以選項從 `page` 查。
 */
export async function chooseOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/**
 * 多選下拉(`slotProps={{ select: { multiple: true } }}`):勾一個選項後**選單不會自己關**,
 * 所以最後按 Esc 收掉,否則它會蓋住下一個要點的東西。
 */
export async function checkOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

/**
 * 按一個按鈕,並等那一次 GraphQL 操作真的回來。
 *
 * 同一個操作連按兩次時(劇本 4 的切 OR → 切 AND),Snackbar **不是**可靠的同步點:
 * 它 4 秒才自動關,上一則還在畫面上就會讓斷言提早綠,接著讀到的是還沒更新的清單。
 */
export async function clickAndWaitFor(
  page: Page,
  buttonName: string,
  operationName: string,
): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/graphql") &&
        (response.request().postData() ?? "").includes(operationName),
    ),
    page.getByRole("button", { name: buttonName }).click(),
  ]);
}

/**
 * 示範模組的列表:看得到哪幾筆、看不到哪幾筆、總筆數是多少。
 *
 * 先斷「共 N 筆」那一行:它是頁尾那一句(`<ns>.total`),清單還在路上時是「共 0 筆」,
 * 所以它也順便當「這一份清單已經回來了」的同步點。
 */
export async function expectDemoItems(
  page: Page,
  expected: {
    total: number;
    pageSize?: number;
    visible: readonly string[];
    hidden?: readonly string[];
  },
): Promise<void> {
  const pageSize = expected.pageSize ?? 10;
  await expect(
    page.getByText(
      `共 ${String(expected.total)} 筆,每頁 ${String(pageSize)} 筆`,
    ),
  ).toBeVisible();
  for (const name of expected.visible) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  for (const name of expected.hidden ?? []) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
}

/**
 * 頁面區域(`AdminShell/ShellLayout` 的 `<main>`)。
 *
 * **右下角的 Snackbar 不在這裡面** —— 它掛在 `app/providers/SnackbarProvider` 上、是整個
 * app 根層的兄弟節點。自 #376 起同一句錯誤文案會**同時**出現在頁內橫幅與 Snackbar 兩處
 * (前者說明脈絡、後者是全站回饋,兩個都要留),所以驗頁內文案時一律從這個範圍往下找,
 * 否則 `getByText` 會撞上 strict mode。
 */
export function pageArea(page: Page): Locator {
  return page.getByRole("main");
}

/**
 * 頁內的橫幅錯誤(表單底部的 `Alert`,`shared/DemoForm.tsx`)。
 * 用 `role=alert` 定位、範圍限在 `<main>` 內 —— 理由同 `pageArea`。
 */
export function pageAlert(page: Page): Locator {
  return pageArea(page).getByRole("alert");
}

/** 無權限頁(`app/guards/ForbiddenPage.tsx`)。 */
export async function expectForbiddenPage(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "沒有權限進入此頁面" }),
  ).toBeVisible();
}

/**
 * 側欄(`AdminShell/SideNav` 的 `<nav aria-label="主選單">`)。
 * 模組列是連結(`NavLinkItem`,名稱 = 模組名稱);斷「有沒有某一列」時從這個範圍往下找,
 * 路由頁籤或頁面標題裡的同名文字才不會混進來。
 */
export function sideNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "主選單" });
}

/** 角色管理的權限矩陣(`MatrixTree` 的 `aria-label`);斷「樹上有沒有某一列」時的範圍。 */
export function matrixTree(page: Page): Locator {
  return page.getByRole("tree", { name: "權限矩陣" });
}

/**
 * 重新登入:清掉 refresh cookie 再走登入頁(劇本 13 要看的是**登入後的落點**)。
 * access token 只在記憶體裡,`signIn` 的 `page.goto` 是完整導覽,清掉 cookie 就回到未登入。
 */
export async function signInAgain(
  page: Page,
  account: string,
  password: string,
): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, account, password);
}

/* ---- 劇本 8 / 9(#398):使用者管理的所屬組織彈窗、「組織外」標示 ---- */

/** 「組織外」標籤的文案(使用者管理 / 分配使用者 / 指派角色三處同一句)。 */
export const OUT_OF_SCOPE_TAG = "組織外";

/** 使用者管理清單(`UserTable` 的 `aria-label`)裡、帳號是 `account` 的那一列。 */
export function userRow(page: Page, account: string): Locator {
  return page
    .getByRole("table", { name: "使用者清單" })
    .getByRole("row")
    .filter({ has: page.getByText(account, { exact: true }) });
}

/**
 * 畫面上唯一開著的那個彈窗,以它自己的按鈕辨認(`@repo/ui/dialog` 的標題不是無障礙名字)。
 * 用按鈕而不是標題:標題含全形 / 半形標點,照打很容易打錯(issue-tracker「全形 / 半形標點」)。
 */
export function dialogWithButton(page: Page, buttonName: string): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: buttonName }) });
}

/** 組織樹某一列的勾選框(列文字 = 組織名稱;同一棵樹內分店名稱不重複)。 */
export function orgTreeCheckbox(scope: Locator, orgName: string): Locator {
  return scope
    .locator(".MuiTreeItem-content")
    .filter({ has: scope.page().getByText(orgName, { exact: true }) })
    .locator('input[type="checkbox"]');
}

/**
 * 按一個按鈕、等那一次 GraphQL 回應,回傳它的 `data`(要斷言 payload 內容時用;
 * 只要同步點用 `clickAndWaitFor`)。
 */
export async function clickAndReadData(
  button: Locator,
  operationName: string,
): Promise<Record<string, unknown>> {
  const [response] = await Promise.all([
    button
      .page()
      .waitForResponse(
        (candidate) =>
          candidate.url().includes("/graphql") &&
          (candidate.request().postData() ?? "").includes(operationName),
      ),
    button.click(),
  ]);
  const body = (await response.json()) as { data: Record<string, unknown> };
  return body.data;
}

/**
 * 使用者管理 → 那一列的「所屬組織」→ 在「選擇所屬組織」彈窗(`OrgPickerDialog`)取消勾選 `orgName`
 * → 確定。有移除就會先送 `setUserOrgs(dryRun: true)`,回來後換成「確認所屬組織變更」彈窗
 * (`OrgChangeDialog`),回傳那個彈窗。
 */
export async function removeUserOrgInPicker(
  page: Page,
  account: string,
  orgName: string,
): Promise<Locator> {
  await userRow(page, account)
    .getByRole("button", { name: "所屬組織" })
    .click();
  const picker = dialogWithButton(page, "確定");
  const checkbox = orgTreeCheckbox(picker, orgName);
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await clickAndWaitFor(page, "確定", "SetUserOrgs");
  const confirm = dialogWithButton(page, "確認變更");
  await expect(confirm).toBeVisible();
  return confirm;
}

/** `OrgChangeDialog` 的三個 radio(文案正本 `docs/modules/user-manager.md` 的 radio 文案表)。 */
export const REMOVAL_OPTIONS = {
  keepAll: "保留所有角色授予",
  revokeOwned: "只解除此組織擁有的角色",
  revokeAll: "解除所有因此失去資格的角色",
} as const;

/**
 * 某一檔的 radio 與它整個標籤(標籤 = 檔名 + 「將解除:…」那一行說明)。
 * 說明列的是**這一檔會解除哪些授予**,劇本 9 的 (b) / (c) 差異就是比這一行。
 */
export function removalOption(
  dialog: Locator,
  option: keyof typeof REMOVAL_OPTIONS,
): { radio: Locator; label: Locator } {
  const text = REMOVAL_OPTIONS[option];
  return {
    radio: dialog.getByRole("radio", { name: text }),
    label: dialog.locator("label").filter({ hasText: text }),
  };
}

/* ---- 劇本 12(#399):可見性開關、治理頁不動 ---- */

/** 可見性開關的文案(`admin.orgManager.form.visibility`;文件寫的「使用者可見下層組織資料」是簡稱)。 */
export const VISIBILITY_SWITCH = "使用者可見自身組織的下層組織資料";

/** 組織管理的組織樹(`OrgTreePanel` 的 `aria-label`;預設全部展開)。 */
export function orgTree(page: Page): Locator {
  return page.getByRole("tree", { name: "組織樹" });
}

/**
 * 組織管理 → 選 `orgName` →「編輯」→ 把可見性開關從 `from` 切到另一邊 →「儲存」。
 * 只動開關時編輯彈窗只送 `setOrgVisibility` 一個 mutation(`EditOrgDialog` 依「有變的欄位」送),
 * 所以等的就是它。呼叫前要已經在組織管理頁上。
 */
export async function toggleOrgVisibility(
  page: Page,
  orgName: string,
  from: { isOn: boolean },
): Promise<void> {
  await orgTree(page).getByText(orgName, { exact: true }).click();
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const dialog = dialogWithButton(page, "儲存");
  const toggle = dialog.getByRole("switch", { name: VISIBILITY_SWITCH });
  await expect(toggle).toBeChecked({ checked: from.isOn });
  await toggle.click();
  await expect(toggle).toBeChecked({ checked: !from.isOn });
  await clickAndWaitFor(page, "儲存", "SetOrgVisibility");
  await expect(dialog).toBeHidden();
}

/** 三個治理頁各自「畫面上列了什麼」(比對切開關前後用)。 */
export interface GovernanceSnapshot {
  /** 組織管理的樹:每個節點的標籤(依畫面順序)。 */
  orgTree: string[];
  /** 使用者管理的清單:每一列的文字(含表頭)。 */
  userRows: string[];
  /** 角色管理的左清單:整份文字(含分組標題)。 */
  roleList: string[];
}

/**
 * 依序打開組織管理 / 使用者管理 / 角色管理,讀出畫面上列著的東西。
 *
 * 每一頁先等一個「一定在」的錨點出現(清單還在路上時讀到的是空的),錨點由呼叫端給:
 * 樹上最深的那個組織、清單上一定有的帳號、一定有的角色。路由也由呼叫端給(`demo-keys.ts`)。
 */
export async function readGovernancePages(
  page: Page,
  anchors: { orgName: string; account: string; roleName: string },
  routes: { org: string; user: string; role: string },
): Promise<GovernanceSnapshot> {
  await page.goto(routes.org);
  const tree = orgTree(page);
  await expect(tree.getByText(anchors.orgName, { exact: true })).toBeVisible();
  const orgLabels = await tree.locator(".MuiTreeItem-label").allInnerTexts();

  await page.goto(routes.user);
  const users = page.getByRole("table", { name: "使用者清單" });
  await expect(users.getByText(anchors.account, { exact: true })).toBeVisible();
  const userRows = await users.getByRole("row").allInnerTexts();

  await page.goto(routes.role);
  const roles = page.getByRole("list", { name: "角色清單" });
  await expect(
    roles.getByText(anchors.roleName, { exact: true }),
  ).toBeVisible();
  const roleList = await roles.allInnerTexts();

  return { orgTree: orgLabels, userRows, roleList };
}

/* ---- 劇本 14(#400):管理範圍的樹根、搬移候選 ---- */

/**
 * 組織樹**各個樹根**的標籤(依畫面順序)。
 * `RichTreeView` 的樹根是 `role="tree"` 底下直屬的 `li`,子節點住在自己的 `ul role="group"` 裡,
 * 所以用直屬子選擇器就只撈得到樹根。呼叫前先等樹上某個節點出現(清單還在路上時是空的)。
 */
export async function orgTreeRootLabels(page: Page): Promise<string[]> {
  return orgTree(page)
    .locator(':scope > li[role="treeitem"] > .MuiTreeItem-content')
    .locator(".MuiTreeItem-label")
    .allInnerTexts();
}

/** 編輯彈窗的「上層組織」下拉(`admin.orgManager.form.parent`;選項文字 = 含祖先的完整路徑)。 */
export const MOVE_TARGET_SELECT = "上層組織(搬移)";

/** 「上層組織」下拉的第一個選項 = 不搬(`admin.orgManager.form.parentUnset`)。 */
export const MOVE_TARGET_UNSET = "不變更";

/**
 * 組織管理 → 選 `orgName` →「編輯」,回傳編輯彈窗。呼叫前要已經在組織管理頁上。
 * 彈窗以「儲存」按鈕辨認(理由見 `dialogWithButton`)。
 */
export async function openEditOrgDialog(
  page: Page,
  orgName: string,
): Promise<Locator> {
  await orgTree(page).getByText(orgName, { exact: true }).click();
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const dialog = dialogWithButton(page, "儲存");
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * 編輯彈窗裡「上層組織」下拉列出的選項(不含第一個「不變更」),讀完按 Esc 收掉選單。
 * 候選 = 管理範圍 ∩ 同租戶 − 自己子樹(`useMoveTargets.ts`),api 會再驗一次。
 */
export async function readMoveTargets(
  page: Page,
  dialog: Locator,
): Promise<string[]> {
  await dialog.getByRole("combobox", { name: MOVE_TARGET_SELECT }).click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.first()).toHaveText(MOVE_TARGET_UNSET);
  const labels = await options.allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  return labels.filter((label) => label !== MOVE_TARGET_UNSET);
}

/* ---- 劇本 16 / 17(#401):開通租戶、撤銷開通、租戶頂層保護 ---- */

/** 組織管理右側的資料區(`OrgDetailPanel` 的 `aria-label`);動作列(編輯 / 停用 / 刪除 / 撤銷開通)在裡面。 */
export function orgDetail(page: Page): Locator {
  return page.getByRole("region", { name: "組織資料" });
}

/**
 * 組織樹上名稱含 `orgName` 的那一列(`.MuiTreeItem-content` 只含自己那一列)。
 *
 * **掛了標籤的列不能用 `getByText(名稱, { exact: true })` 找**:標籤(「停用」「租戶」,
 * `OrgTreePanel` 的 `labelSuffixOf`)與名稱是同一個 `.MuiTreeItem-label` 裡的兄弟 ——
 * 名稱是裸的文字節點、沒有自己的元素,所以最小的那個元素的文字是「名稱租戶」,精確比對永遠落空。
 * 這裡改用子字串比對,名稱要夠獨特(劇本裡的租戶名一律帶隨機字尾)。
 */
export function orgTreeRow(page: Page, orgName: string): Locator {
  return orgTree(page)
    .locator(".MuiTreeItem-content")
    .filter({ hasText: orgName });
}

/** 樹上「租戶」標籤的文案(`admin.orgManager.tree.tenantTag`;只標父節點是平台根組織的節點)。 */
export const TENANT_TAG = "租戶";

/**
 * 組織管理 →「開通租戶」→ 填表 → 取消勾選 `uncheckModules` →「開通」,回傳新租戶頂層的 id。
 * 呼叫前要已經在組織管理頁上(root 視角)。模組勾選是連動的:取消群組會連同下層一起取消。
 * 回傳值取自那一次 `ProvisionTenant` 的回應(成功提示 4 秒就關,不當同步點)。
 */
export async function provisionTenantInUi(
  page: Page,
  input: {
    name: string;
    /** 租戶短碼(`^[a-z][a-z0-9_]{1,19}$`、全域唯一) */
    slug: string;
    adminEmail: string;
    adminAccount: string;
    uncheckModules: readonly string[];
  },
): Promise<string> {
  await page.getByRole("button", { name: "開通租戶", exact: true }).click();
  const dialog = dialogWithButton(page, "開通");
  // 表單要等 `tenantModuleOptions` 回來才掛上(之前只有轉圈)
  const nameField = dialog.getByLabel("租戶名稱");
  await expect(nameField).toBeVisible();
  await nameField.fill(input.name);
  await dialog.getByLabel("租戶短碼").fill(input.slug);
  await dialog.getByLabel("首任租戶管理員 Email").fill(input.adminEmail);
  await dialog.getByLabel("首任租戶管理員帳號").fill(input.adminAccount);
  for (const moduleName of input.uncheckModules) {
    const checkbox = dialog.getByRole("checkbox", {
      name: moduleName,
      exact: true,
    });
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  }
  const data = await clickAndReadData(
    dialog.getByRole("button", { name: "開通", exact: true }),
    "ProvisionTenant",
  );
  await expect(dialog).toBeHidden();
  const payload = data.provisionTenant as { org: { id: string } };
  return payload.org.id;
}

/**
 * 組織管理 → 選 `orgName` →「撤銷開通」,回傳確認彈窗(`RevokeProvisionDialog`)。
 * 按鈕只在 root 視角選中租戶頂層時出現(#374)。被擋之後彈窗裡就沒有「撤銷開通」鈕了,
 * 所以不用 `dialogWithButton` 認它 —— 畫面上同時只會有這一個彈窗。
 */
export async function openRevokeProvisionDialog(
  page: Page,
  orgName: string,
): Promise<Locator> {
  await orgTreeRow(page, orgName).click();
  await orgDetail(page)
    .getByRole("button", { name: "撤銷開通", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 撤銷開通彈窗:名稱沒打之前按不下去 → 照打租戶名稱 →「撤銷開通」,等那一次 `RevokeTenantProvision` 回來。 */
export async function confirmRevokeProvision(
  dialog: Locator,
  orgName: string,
): Promise<void> {
  const confirm = dialog.getByRole("button", {
    name: "撤銷開通",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`請輸入租戶名稱「${orgName}」以確認`).fill(orgName);
  await expect(confirm).toBeEnabled();
  await clickAndReadData(confirm, "RevokeTenantProvision");
}

/* ---- 劇本 11 / 15(#402):上傳欄、圖片真的載得出來、側欄商標 ---- */

/**
 * `@repo/ui/upload-field` 藏起來的 `<input type="file">`(無障礙名字 = 欄位標題)。
 * 上傳一律走這個 input 的 `setInputFiles`,不去點「點擊或拖曳圖片至此」(那會開系統的檔案對話框)。
 */
export function uploadInput(scope: Page | Locator, label: string): Locator {
  return scope.locator(`input[type="file"][aria-label="${label}"]`);
}

/**
 * 一張 `<img>` 真的載入完成(`complete` 且有寬度)。只斷 `toBeVisible` 不夠:
 * 破圖也是「看得到的元素」,網址指錯、物件不在時照樣綠。
 */
export async function expectImageLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete ? img.naturalWidth : 0;
      }),
    )
    .toBeGreaterThan(0);
}

/**
 * 側欄頂部的商標圖(`AdminShell/SideNav`:有商標才畫 `<img>`,`alt` = 當前組織名稱;
 * 沒有商標時那個位置是組織名稱的文字,不會有這個 img)。
 */
export function sideNavLogo(page: Page, orgName: string): Locator {
  return sideNav(page).getByRole("img", { name: orgName, exact: true });
}

/**
 * 組織管理 → 選 `orgName` →「編輯」→ 商標欄選 `filePath` →「儲存」,等那一次 `UpdateOrg` 回來
 * (送出時先 `createUploadUrl` → 瀏覽器直傳 bucket → 才送 `UpdateOrg`,`useLogoUpload`)。
 * 呼叫前要已經在組織管理頁上。
 */
export async function setOrgLogoInUi(
  page: Page,
  orgName: string,
  filePath: string,
): Promise<void> {
  const dialog = await openEditOrgDialog(page, orgName);
  await dialog.locator('input[type="file"]').setInputFiles(filePath);
  await clickAndWaitFor(page, "儲存", "UpdateOrg");
  await expect(dialog).toBeHidden();
}

/**
 * 組織管理 → 選 `orgName` →「編輯」→ 商標欄按「移除」→「儲存」(送 `logoPath: null` = 清空)。
 * 彈窗一開就顯示既有商標的預覽,所以「移除」鈕一定在。
 */
export async function clearOrgLogoInUi(
  page: Page,
  orgName: string,
): Promise<void> {
  const dialog = await openEditOrgDialog(page, orgName);
  await dialog.getByRole("button", { name: "移除", exact: true }).click();
  await clickAndWaitFor(page, "儲存", "UpdateOrg");
  await expect(dialog).toBeHidden();
}
