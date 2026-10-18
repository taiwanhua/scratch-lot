import { readFileSync } from "node:fs";

import { GCS_BUCKET_PRIVATE, GCS_BUCKET_PUBLIC, GCS_ENDPOINT } from "../config";
import {
  createUploadUrlRaw,
  demoItemOneAttachmentUrlRaw,
} from "../fixtures/api";
import {
  SAMPLE_ONE_CREATE_ROUTE,
  SAMPLE_ONE_VIEW,
  SAMPLE_ONE_VIEW_ROUTE,
} from "../fixtures/demo-keys";
import { errorCodeOf } from "../fixtures/graphql";
import { expect, test } from "../fixtures/test";
import {
  clickAndReadData,
  expectImageLoaded,
  pageArea,
  signIn,
  uploadInput,
} from "../fixtures/ui";
import {
  assetPath,
  fakeGcsSkipReason,
  fetchAnonymously,
} from "../harness/fake-gcs";

/**
 * 劇本 11 — 儲存雙路(公開封面 / 私有附件)
 * 正本:`docs/testing/permission-scenarios.md`「劇本 11」;規則見 ADR-0010(雙路儲存、簽名網址)。
 * 用哪一頁:示範模組1 的新增頁(上傳)+ 詳情頁(顯示與下載);帳號:+user。
 *
 * 檔案真的傳到 **fake GCS 容器**(`apps/e2e/docker-compose.yml`),api 以
 * `GCS_API_ENDPOINT` 指過去、用假憑證簽 V4 網址。本機沒有 Docker 時整條 skip(原因寫在 skip 說明)。
 *
 * **fake GCS 不驗簽章、也不管 bucket 的公開 / 私有**,所以這裡驗得到的是「api 發了什麼網址」
 * (哪個 bucket、有沒有簽名、效期多長)與「檔案真的傳上去、讀得回來」;步驟 3 的
 * 「過一陣子網址就失效」是真 GCS 的行為,仍屬 dev 環境的人工驗收。
 */

const skipReason = fakeGcsSkipReason();
test.skip(skipReason !== null, skipReason ?? "");

const COVER_FILE = assetPath("cover.png");
const ATTACHMENT_FILE = assetPath("attachment.pdf");
/** `GCS_SIGNED_URL_TTL` 的預設 1h(harness 沒覆寫)。 */
const READ_URL_TTL_SECONDS = "3600";

test("劇本 11:封面走公開穩定 URL、附件走短效簽名網址,拿掉 view 之後 api 拒發", async ({
  page,
  tenant,
}) => {
  const { member } = tenant;
  const itemName = `儲存雙路-${tenant.slug}`;
  await signIn(page, member.account, member.password);

  // 步驟 1:新增一筆,封面上傳 PNG、附件上傳 PDF(上傳走畫面:選檔 → 儲存時直傳 bucket)
  await page.goto(SAMPLE_ONE_CREATE_ROUTE);
  await page.getByLabel("名稱").fill(itemName);
  await uploadInput(page, "封面").setInputFiles(COVER_FILE);
  await uploadInput(page, "附件").setInputFiles(ATTACHMENT_FILE);
  const created = await clickAndReadData(
    page.getByRole("button", { name: "儲存" }),
    "CreateDemoItemOne",
  );
  const itemId = (created.createDemoItemOne as { item: { id: string } }).item
    .id;

  // 步驟 2:詳情頁的封面直接顯示;網址是**公開 bucket 的穩定 URL**(不簽名),
  //         不帶任何登入狀態去開也拿得到同一個檔(= 複製到無痕視窗)
  await page.goto(`${SAMPLE_ONE_VIEW_ROUTE}/${itemId}`);
  const cover = pageArea(page).getByRole("img", {
    name: `${itemName} 的封面`,
  });
  await expectImageLoaded(cover);
  const coverUrl = new URL((await cover.getAttribute("src")) ?? "");
  expect(coverUrl.origin).toBe(GCS_ENDPOINT);
  expect(coverUrl.pathname).toMatch(
    new RegExp(String.raw`^/${GCS_BUCKET_PUBLIC}/demo/[0-9a-f-]{36}\.png$`),
  );
  expect(coverUrl.search).toBe("");
  const coverRead = await fetchAnonymously(coverUrl.href);
  expect(coverRead.status).toBe(200);
  expect(coverRead.body.equals(readFileSync(COVER_FILE))).toBe(true);

  // 步驟 3:附件按「下載」才向 api 要一條**私有 bucket 的短效簽名網址**
  const attachmentPanel = pageArea(page);
  // 附件顯示使用者選檔時的原始檔名(存原始檔名 / 大小;物件路徑仍是 `<uuid>.pdf`)
  await expect(
    attachmentPanel.getByText("attachment.pdf", { exact: true }),
  ).toBeVisible();
  // 按下去之前頁面上沒有任何下載連結(不預先簽)
  await expect(
    attachmentPanel.getByRole("link", { name: "開啟下載連結" }),
  ).toHaveCount(0);
  await clickAndReadData(
    attachmentPanel.getByRole("button", { name: "下載", exact: true }),
    "DemoItemOneAttachmentUrl",
  );
  const link = attachmentPanel.getByRole("link", { name: "開啟下載連結" });
  await expect(link).toBeVisible();
  const downloadUrl = new URL((await link.getAttribute("href")) ?? "");
  expect(downloadUrl.origin).toBe(GCS_ENDPOINT);
  expect(downloadUrl.pathname).toMatch(
    new RegExp(String.raw`^/${GCS_BUCKET_PRIVATE}/demo/[0-9a-f-]{36}\.pdf$`),
  );
  expect(downloadUrl.searchParams.get("X-Goog-Algorithm")).toBe(
    "GOOG4-RSA-SHA256",
  );
  expect(downloadUrl.searchParams.get("X-Goog-Expires")).toBe(
    READ_URL_TTL_SECONDS,
  );
  expect(downloadUrl.searchParams.get("X-Goog-Signature")).not.toBeNull();
  const attachmentRead = await fetchAnonymously(downloadUrl.href);
  expect(attachmentRead.status).toBe(200);
  expect(attachmentRead.body.equals(readFileSync(ATTACHMENT_FILE))).toBe(true);

  // 步驟 4:不在白名單的檔型、超過上限的大小 → 簽票那一步就 `UPLOAD_REJECTED`(訊息帶 purpose)。
  //         畫面上的 `accept` / `maxSize` 只是先擋一手,這裡直接打 api 驗真正把關的那一層
  const wrongType = await createUploadUrlRaw(member.token, {
    purpose: "DEMO_ATTACHMENT",
    contentType: "application/x-msdownload",
    size: 1024,
  });
  expect(errorCodeOf(wrongType)).toBe("UPLOAD_REJECTED");
  expect(wrongType.errors?.[0]?.message).toContain("DEMO_ATTACHMENT");
  const tooLarge = await createUploadUrlRaw(member.token, {
    purpose: "DEMO_COVER",
    contentType: "image/png",
    size: 2 * 1024 * 1024 + 1,
  });
  expect(errorCodeOf(tooLarge)).toBe("UPLOAD_REJECTED");
  expect(tooLarge.errors?.[0]?.message).toContain("DEMO_COVER");

  // 步驟 5:+tenant 把「客服」的 `view` 拿掉 → 同一筆再要下載網址,api **拒發**。
  //         對照:拿掉之前同一個 token 要得到(每一次取用都重新檢查權限)
  const before = await demoItemOneAttachmentUrlRaw(member.token, itemId);
  expect(errorCodeOf(before)).toBeNull();
  await tenant.setSupportPermissions({ omitPermissions: [SAMPLE_ONE_VIEW] });
  const denied = await demoItemOneAttachmentUrlRaw(member.token, itemId);
  expect(errorCodeOf(denied)).toBe("FORBIDDEN");
  expect(denied.data).toBeNull();
});
