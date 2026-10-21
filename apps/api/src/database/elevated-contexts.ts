/**
 * **允許出現提升上下文(可見範圍或管理範圍寫成 `"all"`)的檔案**(相對 `apps/api/src/`;ADR-0005「例外出口」)。
 *
 * 提升上下文 = 不經登入線、把可見範圍寫成「全部」的操作者上下文:資料層不再以可見範圍過濾,
 * 範圍改由呼叫端自己的條件(明列 id、租戶子樹、非租戶資料)決定。寫錯一個條件就是跨租戶讀寫,
 * 所以只准出現在這份清單上的檔案,`elevated-contexts.test.ts` 掃整個 src 斷言(測試檔與 `test-support/` 除外)。
 *
 * 新增一處前先想:是否能改用登記過的出口 —— 租戶內唯一 / 占用檢查用 `BaseRepository.existsInTenant`、
 * 引用名稱用 `findRefsInTenant`、整個租戶的反查 / 以人為準的資料 / 排程用 `tenantBoundaryContext`、跨組織看資料用
 * 資料共用宣告(ADR-0014)。真的需要才加進來,值寫一句「為什麼不能照可見範圍」。
 * 專案的檔案登記在專案入口 `project/database/elevated-contexts.ts`,不改這份。
 */
export const ELEVATED_CONTEXT_FILES: Readonly<Record<string, string>> = {
  "audience/audience.service.ts":
    "讀治理資料組收件對象;本租戶的邊界由 listAudience 以租戶子樹收斂",
  "auth/auth.service.ts":
    "登入線寫 refresh_tokens(帳號資料、非租戶資料),只填 createdBy / updatedBy",
  "auth/operator-context.service.ts":
    "計算可見範圍 / 管理範圍本身;當下還沒有範圍可用",
  "auth/password/account-operator.ts":
    "密碼流程只碰帳號資料(非租戶資料),只填 createdBy / updatedBy",
  "data-scope/data-scope.service.ts":
    "讀資料範圍目標 / 規則(種子表與根組織設定);規則不能被規則自己過濾",
  "database/org-business-data.reader.ts":
    "刪組織 / 撤銷開通的存在性檢查;條件固定釘在歸屬欄 = 已驗過的組織",
  "database/system-tenant-reader.ts":
    "列出單一租戶的組織樹以組出 systemTenantReader;條件釘在該租戶頂層與其下層",
  "database/tenant-timezone.ts":
    "讀租戶頂層的時區設定;時區是租戶設定,不是管不管得到的問題",
  "fields/field-visibility.ts":
    "欄位選項的上層繼承;查詢一律釘在明列的組織 id 上",
  "forms/form-access.service.ts":
    "讀組織只取判斷用欄位,不受管理範圍影響(同擁有者保護的 fail-closed 讀法)",
  "forms/form-design/forms.service.ts":
    "讀組織只取名稱等判斷用欄位,不受管理範圍影響",
  "notifications/notification.service.ts":
    "通知、偏好、使用者、通知設定都不掛 tenantScope;只為讓 BaseRepository 收得到上下文",
  "notifications/notification-channels.ts":
    "讀收件人帳號(users 不掛 tenantScope);只為讓 BaseRepository 收得到上下文",
  "orgs/org-managers.service.ts":
    "主管解析在背景推進時沒有操作者;條件釘在已驗過的租戶子樹",
  "orgs/orgs.service.ts":
    "停用連動、搬移重算 ancestors、刪除前置以整棵子樹為準;條件釘在 ancestors = 已驗過的組織",
  "orgs/org-slug.ts": "租戶 slug 全域唯一檢查要看到每一個租戶頂層",
  "orgs/owner-protection.service.ts":
    "擁有者保護要 fail-closed:租戶頂層可能不在操作者範圍內;只取判斷用欄位",
  "permission/permission-resolver.ts":
    "讀全域 / 關聯歸屬資料(modules、permissions、roles 不受租戶過濾),範圍在此無作用",
  "printing/me-org-tenant-name.resolver.ts":
    "讀當前組織所屬租戶頂層的名稱(分店人員也要印得出);條件釘在明列 id",
  "printing/print-agent-credentials.ts":
    "以金鑰 / 配對碼雜湊找列印代理程式(還不知道是誰);找到後改用代理程式自己的上下文",
  "realtime/realtime-ticket.service.ts":
    "讀組織本身的祖先推導租戶,不受操作者範圍限制;條件釘在明列 id",
  "roles/role-matrix.service.ts":
    "讀全域資料(modules / permissions 不掛租戶過濾),範圍在此無作用",
  "scheduled-jobs/scheduled-job-runner.service.ts":
    "背景排程列租戶頂層的時區與啟用狀態;沒有操作者",
  "users/org-qualification.service.ts":
    "角色資格以組織樹形狀判斷;只讀 _id / ancestors,不外流內容",
  "workflows/tenant-directory.service.ts":
    "流程設計列本租戶的使用者 / 角色;以整棵租戶子樹為準",
  "workflows/workflow-design/workflows.service.ts":
    "讀組織只取名稱,不受管理範圍影響",
};
