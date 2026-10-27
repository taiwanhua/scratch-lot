import { assertProjectPublicConfig } from "./base/public-config";
import { projectPublic as projectPublicValues } from "./project/public";

export { createAdminStorageKeys } from "./base/admin-storage-keys";
export type { AdminStorageKeys } from "./base/admin-storage-keys";
export type {
  ProjectAdminWebApp,
  ProjectFrontMetadata,
  ProjectPublicConfig,
} from "./base/public-config";

/** 專案公開設定;載入時驗證一次,專案值不合法就讓 build / 啟動當場失敗。 */
export const projectPublic = assertProjectPublicConfig(projectPublicValues);
