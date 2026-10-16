# 前端資料存取(DATA)

## DATA-01 只用 `@repo/graphql` 的 codegen hooks

query / mutation 一律透過 codegen 產生的 `useXxxQuery` / `useXxxMutation`;禁止在 app 內手寫 gql 字串或自組 fetch。需要新查詢時:改 `packages/graphql` 的 `.graphql` 文件 → 跑 codegen → 用新 hook。

```ts
✅ const { data } = useModuleTreeQuery(client);
❌ const data = await client.request(`query { moduleTree { id } }`);
```

admin 傳給 hook 的 client 有兩個(`apps/admin/src/lib/base/auth/`):**`session.client`** 給登入後的查詢(自動帶 access token、`TOKEN_EXPIRED` 時靜默換票重送一次、`UNAUTHENTICATED` 清狀態導登入頁)、**`session.publicClient`** 只給 `login` / `refresh` / 密碼流程這幾個公開端點。拿錯 client 會在登入頁無限轉圈或已登入頁被當成沒登入。

登入者資料一律經 `hooks/base/useMe.ts` 的 `useMe()`(`me` query 的唯一包裝,`staleTime: Infinity`、**`retryOnMount: false`**)。`retryOnMount` 必須關:`me` 失敗(如 token 失效)後 `RequireAuth` 會導向登入頁並重新掛載,預設 `retryOnMount: true` 會在掛載時再打一次 → 再失敗 → 再導向,形成無限迴圈。其他「失敗就導向」的查詢比照。正本:`apps/admin/src/hooks/base/useMe.ts`、`apps/admin/src/lib/base/auth/`

## DATA-02 query key 交給 codegen,不自創字串

invalidate、prefetch 一律用 codegen 提供的 `useXxxQuery.getKey()`,保證與 hook 內部一致。

```ts
✅ queryClient.invalidateQueries({ queryKey: useModuleTreeQuery.getKey() });
❌ queryClient.invalidateQueries({ queryKey: ["ModuleTree"] });
```

## DATA-03 Server Component 用 fetcher 模式

front 的 RSC 不能用 hooks,用該 operation 的 codegen fetcher。底座中性首頁不讀業務 API;專案新增公開查詢後,將下例的 `useXxxQuery` 換成該查詢的生成出口(受保護端點須另帶合適憑證):

```ts
const data = await useXxxQuery.fetcher(graphqlClient)();
```

## DATA-04 mutation 成功後:先寫回傳的 payload,再精準 invalidate

**兩步,順序固定**(只做第 (b) 步的結果是「儲存完畫面閃一下舊值」,見下方「為什麼 (a) 不能省」):

- **(a) 寫**:用 mutation 回傳的 payload `setQueryData` **同 key 的單筆 / 矩陣查詢**(key 一律取
  DATA-02 的 getKey)。payload 與該查詢同形就整份覆寫;只回部分欄位就**併進**快取裡既有那一筆
  (`setQueryData(key, (current) => current === undefined ? undefined : { ...merge })` ——
  回 `undefined` 代表快取裡還沒有那一筆,不要憑空造一筆半成品出來)。
- **(b) 失效**:再用 getKey 逐一標明受影響的**清單**與**單筆**。清單的 key 帶分頁 / 篩選時,
  取 getKey 的第一段當前綴 + `exact: false`,一次掃掉各頁各篩選。

**沒有 payload 可寫**(如 `delete`、回 `{ success }` 的端點)時只做 (b),但**單筆也要失效**,
不能只失效清單。

禁止整站 refetch 或重新整理頁面來「同步資料」。

### 為什麼 (a) 不能省

只做 (b) 時,從 invalidate 到重取回來之間畫面還是**舊快取**,使用者看得到:

- 權限矩陣儲存後「閃一下」:本地草稿一丟掉,勾選立刻退回儲存前那一份,等重取回來才變新的。
- 編輯送出回列表、馬上再進編輯頁看到舊值(單筆查詢的元件已經掛好、初始值只取一次,
  之後重取回來也不會再帶進表單)。

所以**寫入端要負責把新值交給快取**,invalidate 只是「順便跟伺服器對一次帳」。

### 順序上的兩個坑

1. **先 `setQueryData` 再丟掉本地草稿**(反過來就是上面那個「閃一下」)。
2. **改到的是登入者自己時,連 `me` 一起失效**:`me` 的 `staleTime` 是 Infinity(DATA-01),
   不主動失效永遠不會更新 —— 所屬組織、角色、姓名、模組與權限都在它裡面,
   側欄 / AppBar 的「當前組織」直接讀它。先例:`useUserManagerData` 的 `invalidate`、
   `useOrgManagerData`、`useModuleManagerData`。

## DATA-05 端點走環境變數

GraphQL endpoint 一律讀環境變數(front:`NEXT_PUBLIC_GRAPHQL_ENDPOINT`;admin:`VITE_GRAPHQL_ENDPOINT`),fallback 才是 localhost;禁止在元件或 lib 內硬編正式環境網址。

## DATA-06 mutation 一律經 `useMutationFeedback`:成功或失敗都跳一則 Snackbar

(理由:沒有這條時,成功沒有任何回饋、失敗只顯示在表單上,使用者無從確認操作結果。)

admin 的每一支 mutation 都要有操作結果提示,做法固定:`apps/admin/src/hooks/base/useMutationFeedback.ts`
回傳的 `{ onSuccess, onError }` 直接塞進 codegen mutation hook 的 options,**它包住呼叫端原本的
callback、不取代**(DATA-04 的寫回與失效、關彈窗照舊在裡面)。

```ts
const setOrgEnabled = useSetOrgEnabledMutation(
  session.client,
  useMutationFeedback<SetOrgEnabledMutation>({
    success: (payload) =>
      payload.setOrgEnabled.org.enabled
        ? t("feedback.enableSuccess")
        : t("feedback.disableSuccess"),
    error: (error) => tErrors(orgManagerErrorOf(error).code),
    onSuccess: (payload) => {
      closeDialog();
      void data.invalidate(payload.setOrgEnabled.org.id);
    },
    onError: onActionError,
  }),
);
```

規則:

- **成功文案的 key 一律 `<ns>.feedback.<action>Success`**(`createSuccess`、`updateSuccess`、
  `deleteSuccess`、`enableSuccess` / `disableSuccess`…),兩語系同時補齊(I18N-02);
  同一支端點兩種說法(啟用 / 停用)就給一個吃 payload 的函式,不要各寫一個 mutation。
- **失敗文案用該頁既有的錯誤解讀**(`<ns>ErrorOf(error)` + `errors.<code>`),不要在提示裡另起一套;
  **表單 / 彈窗內原本的錯誤顯示保留** —— 欄位級標示講「哪裡要改」,Snackbar 講「這次沒成功」。
  **錯誤解讀的回傳形狀只有一種**:`<ns>ErrorOf` 一律回 `apps/admin/src/lib/base/errors.ts`
  的 `AdminError`(`{ code, reason?, reasons?, fields?, path?, message? }`,選填欄位沒有就缺席),
  各頁的 `*-error.ts` 只宣告碼表 / 原因白名單交給 `parseAdminError`,不再各自解析 `extensions`;
  `message` 是 api 的原文,只供除錯,不拿來顯示。
- **一次操作只跳一則**。`mutateAsync` 串多步的流程(`EditOrgDialog` 的儲存最多串五支 mutation、
  `useDemoForm` 的上傳 + 儲存)不要把 feedback 交給每一支,改成整段 try / catch 完成後自己呼叫
  `feedback.onSuccess()` / `feedback.onError(error)`;共版型那種只收 `{ onSuccess(): void }` 的
  設定物件介面也走這一招,不要為了回饋去改介面的形狀。
- **只有 dry-run / 預覽這種「還沒完成操作」的步驟**可以 `success: null`(成功不跳 —— 跳「已更新」是騙人的),
  失敗是否照跳看下一條。先例:使用者管理的所屬組織試算(`useUserOrgsFlow`)、複製組織與角色的預覽
  (`CopyOrgRolesDialog/useCopyOrgRoles.ts`)。
- **`error` 回 `null` = 失敗不跳提示**(DATA-06 唯一的例外),只給「錯誤已就地顯示在使用者正盯著的彈窗裡、
  且彈窗不會關」的流程用,避免同一句話出現兩次。先例是複製組織與角色的彈窗:預覽與送出的失敗都寫在彈窗裡,
  兩支的 `error` 都回 `null`;送出成功仍照跳。
- **立即生效的切換、背景寫回**:畫面在送出前就已經換好、寫入只是把它存起來的操作,`success: null`(畫面就是成功的回饋);
  使用者親手做的切換,失敗照跳(畫面與存下來的不一致,要讓他知道);沒有使用者操作、系統自己補寫的背景寫回,
  `error` 也回 `null`(使用者不知道有這件事,下次會再補)。先例:頭像選單切語言(`useChangeLocale`)與
  登入後把本機語言寫回帳號(`useAccountLocaleSync`),都在 `apps/admin/src/hooks/base/useAccountLocale.ts`。

位置與堆疊:電腦 / 平板右下角距邊 24,手機底部左右 16 滿寬(有底部導覽時放在它上面);
**所有提示(操作結果、可撤銷、新通知)一律往上疊,新的在下面;最多 3 則,第 4 則出現時最舊的那則消失**。
一般 4 秒、有動作(例 [撤銷])8 秒自動消失,滑鼠移上去或鍵盤焦點在卡片內時暫停,移開(焦點離開)後重新計時。正本寫在
`apps/admin/src/stores/base/useSnackbarStore.ts` 與 `@repo/ui/snackbar`(`Snackbar`、`SnackbarStack`、
`enqueueSnackbar`)的 JSDoc。全站唯一的出口是 `AppProviders` 裡的 `SnackbarProvider`;
mutation 以外的提示(可撤銷、新通知、自己控制時機的流程)經 `useSnackbar()` 送出,各模組不另寫提示元件。

測試:`apps/admin/src/test/snackbar.ts` 的 `findSnackbarAlert()`(取最新、最下面那一則)。**不要只用 `findByText` 斷言** ——
失敗提示與頁面上那一條錯誤是同一份文案,只比文字同時抓到兩個節點,也證明不了提示真的跳了。
