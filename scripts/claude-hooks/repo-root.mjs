/**
 * 找出被編輯檔案所屬的 repo 根:從檔案所在目錄往上找第一個有 `.git` 的目錄。
 * git worktree 的 `.git` 是檔案(內容指回主 repo),一般 checkout 是資料夾,兩者都算。
 * hook 的工作目錄以這裡為準,而不是 session 啟動的 `process.cwd()`:
 * session 在主 checkout、編輯的卻是 worktree 裡的檔案時,prettier / pnpm / 套件查找都要落在那個 worktree。
 */
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * @param {string} filePath 被編輯的檔案(相對路徑以 `cwd` 為基準)
 * @param {string} cwd session 的工作目錄;往上找不到 `.git` 時以它為 repo 根
 * @returns {string} 絕對路徑的 repo / worktree 根
 */
export const findRepoRoot = (filePath, cwd) => {
  let dir = path.dirname(path.resolve(cwd, filePath));
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
};
