/**
 * 以連結點擊開始下載(簽名網址指向私有 bucket 的壓縮檔):不換掉目前的頁面,
 * `download` 屬性在跨網域時瀏覽器會忽略,檔名改由 bucket 物件決定,這裡只是盡力而為。
 */
export const startDownload = (url: string, fileName: string): void => {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
};
