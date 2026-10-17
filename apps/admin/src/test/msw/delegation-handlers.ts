import { HttpResponse } from "msw";

import {
  type CreateMyDelegationMutationVariables,
  type DeleteMyDelegationMutationVariables,
  type MyDelegateCandidatesQueryVariables,
  type MyDelegationsQueryVariables,
  type UserDelegationFieldsFragment,
  UserDelegationStatus,
} from "@repo/graphql";

import { api } from "./server";

/** 可選的代理人(同一最上層組織、啟用中、不含自己)。 */
export interface DelegateCandidateFixture {
  id: string;
  name: string;
  account: string;
}

export const delegateCandidates: DelegateCandidateFixture[] = [
  { id: "user-li", name: "李小華", account: "li" },
  { id: "user-chen", name: "陳大文", account: "chen" },
  { id: "user-wang", name: "王小明", account: "wang" },
];

/** 代理清單的夾具(Figma BS-06a:一筆未開始、一筆已結束;時區 Asia/Taipei)。 */
export const delegationFixtures = (): UserDelegationFieldsFragment[] => [
  {
    id: "delegation-1",
    delegate: { id: "user-li", name: "李小華" },
    startAt: "2026-10-19T16:00:00.000Z",
    endAt: "2026-10-24T16:00:00.000Z",
    note: "出國",
    status: UserDelegationStatus.Upcoming,
    createdAt: "2026-10-16T02:00:00.000Z",
  },
  {
    id: "delegation-2",
    delegate: { id: "user-chen", name: "陳大文" },
    startAt: "2026-08-31T16:00:00.000Z",
    endAt: "2026-09-03T16:00:00.000Z",
    note: null,
    status: UserDelegationStatus.Ended,
    createdAt: "2026-08-30T02:00:00.000Z",
  },
];

export interface DelegationWorldOptions {
  delegations?: UserDelegationFieldsFragment[];
  candidates?: DelegateCandidateFixture[];
  /** 新增時回這個錯誤 reason(`VALIDATION_FAILED`);沒給 = 成功 */
  createRejectReason?: string;
}

/**
 * 個人設定「代理人」分頁的假 api(有狀態;形狀對照 api `user-delegations.test.ts`):
 * - MyDelegations:依陣列順序 offset 分頁
 * - MyDelegateCandidates:關鍵字比對姓名與帳號
 * - CreateMyDelegation:插到最前面,狀態固定「未開始」(假 api 不算時間);`createRejectReason` 時回錯
 * - DeleteMyDelegation:從陣列移除
 */
export const delegationWorld = (options: DelegationWorldOptions = {}) => {
  const delegations = [...(options.delegations ?? delegationFixtures())];
  const candidates = options.candidates ?? delegateCandidates;
  const calls = {
    create: [] as CreateMyDelegationMutationVariables["input"][],
    delete: [] as string[],
  };
  let sequence = 0;

  const handlers = [
    api.query("MyDelegations", ({ variables }) => {
      const { input } = variables as MyDelegationsQueryVariables;
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      return HttpResponse.json({
        data: {
          myDelegations: {
            items: delegations.slice((page - 1) * pageSize, page * pageSize),
            page,
            pageSize,
            totalCount: delegations.length,
          },
        },
      });
    }),
    api.query("MyDelegateCandidates", ({ variables }) => {
      const { input } = variables as MyDelegateCandidatesQueryVariables;
      const keyword = input.keyword?.trim() ?? "";
      const matched = candidates.filter(
        (user) =>
          keyword === "" ||
          user.name.includes(keyword) ||
          user.account.includes(keyword),
      );
      return HttpResponse.json({
        data: {
          myDelegateCandidates: {
            items: matched,
            totalCount: matched.length,
          },
        },
      });
    }),
    api.mutation("CreateMyDelegation", ({ variables }) => {
      const { input } = variables as CreateMyDelegationMutationVariables;
      calls.create.push(input);
      if (options.createRejectReason !== undefined) {
        return HttpResponse.json({
          errors: [
            {
              message: "rejected",
              extensions: {
                code: "VALIDATION_FAILED",
                reason: options.createRejectReason,
              },
            },
          ],
        });
      }
      sequence += 1;
      const delegate = candidates.find(
        (user) => user.id === input.delegateUserId,
      );
      const created: UserDelegationFieldsFragment = {
        id: `delegation-new-${String(sequence)}`,
        delegate: { id: input.delegateUserId, name: delegate?.name ?? null },
        startAt: input.startAt,
        endAt: input.endAt,
        note: input.note ?? null,
        status: UserDelegationStatus.Upcoming,
        createdAt: "2026-10-17T02:00:00.000Z",
      };
      delegations.unshift(created);
      return HttpResponse.json({
        data: { createMyDelegation: { delegation: created } },
      });
    }),
    api.mutation("DeleteMyDelegation", ({ variables }) => {
      const { input } = variables as DeleteMyDelegationMutationVariables;
      calls.delete.push(input.id);
      const index = delegations.findIndex((item) => item.id === input.id);
      if (index !== -1) {
        delegations.splice(index, 1);
      }
      return HttpResponse.json({
        data: { deleteMyDelegation: { id: input.id } },
      });
    }),
  ];

  return { handlers, calls, delegations };
};
