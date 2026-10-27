/**
 * 專案登記給 demo 指令的示範資料(底座機制,`docs/deployment.md`「示範資料(demo)」)。
 *
 * 專案在 `seeds/project/registry.ts` 匯出 `projectDemoSource`,由固定入口 `seeds/registry.ts` 轉成
 * `demoSource`(STRUCT-12:底座不 import 專案)。示範資料是業務資料,不進一般 seed(ADR-0002):
 * 指令先以平台管理員(root)建立標「示範」的機構與首任租戶管理員,再把登入成那位管理員的 client
 * 交給專案的 `populate` 建出其餘內容(專案可讓示範機構和真正開通的租戶走同一套步驟)。
 */
import type { GraphqlClient } from "./graphql-client";

export interface DemoTenant {
  /** 示範機構(租戶頂層)的名稱;固定,重跑時以它找回同一個機構。 */
  name: string;
  /** 租戶短碼(`^[a-z][a-z0-9_]{1,19}$`、全域唯一)。 */
  slug: string;
  /** 首任租戶管理員信箱的 `+` 別名(`<基底>+<alias>@…`;帳號同信箱)。 */
  adminAlias: string;
}

export interface DemoPopulateContext {
  /** 已登入成示範機構首任租戶管理員的 client(權限照常檢查、操作紀錄記在這位管理員名下)。 */
  client: GraphqlClient;
  /** 基底信箱(示範帳號的信箱一律 `<基底>+<別名>@…`,用 `aliasEmail` 產生)。 */
  emailBase: string;
  /** 示範帳號的密碼(只在記憶體裡傳遞;新建的帳號才用到,已存在的帳號不改)。 */
  password: string;
  print: (line: string) => void;
}

export interface DemoSource {
  tenant: DemoTenant;
  /** 建出 / 補齊示範內容(冪等:重跑只補缺的,不把已改過的密碼或資料改回去)。 */
  populate: (context: DemoPopulateContext) => Promise<void>;
}

/**
 * `<local>@<domain>` → `<local>+<alias>@<domain>`。基底不是一個信箱、已經帶 `+` 別名或別名不是
 * 小寫英數與 `-` → 丟錯(錯誤訊息不帶出基底本身:它是真實信箱,不進 log)。
 */
export function aliasEmail(base: string, alias: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(alias)) {
    throw new Error(`信箱別名只能是小寫英數與 -:${alias}`);
  }
  const trimmed = base.trim();
  const at = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (
    at <= 0 ||
    domain === "" ||
    local.includes("+") ||
    /[\s@]/.test(local) ||
    /\s/.test(domain) ||
    !domain.includes(".")
  ) {
    throw new Error(
      "基底信箱格式不對:要是一個不含 + 別名的信箱(例:name@example.com)",
    );
  }
  return `${local}+${alias}@${domain}`;
}
