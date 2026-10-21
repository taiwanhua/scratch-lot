import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  type CreateLotteryDealerContactMutationVariables,
  type CreateLotteryDealerMutationVariables,
  type LotteryDealerContactFieldsFragment,
  type LotteryDealerContactsQueryVariables,
  type LotteryDealerFieldsFragment,
  type LotteryDealerSigninsQueryVariables,
  LotteryDealerStatus,
  LotteryDealerType,
  type LotteryDealersQueryVariables,
  LotteryLicenseState,
  LotterySigninState,
  type RegisterLotteryDealerSigninMutationVariables,
  type UpdateLotteryDealerContactMutationVariables,
  type UpdateLotteryDealerMutationVariables,
} from "@repo/graphql";

import { api } from "../server";
import {
  contactFixtures,
  dealerFixtures,
  occupiedStoreFixtures,
} from "./dealers-fixtures";

/** GQL-04 形式的業務錯誤(HTTP 200 + `errors[].extensions`)。 */
const businessError = (extensions: Record<string, unknown>) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: String(extensions.code), extensions }],
  });

export interface DealersWorldOptions {
  dealers?: LotteryDealerFieldsFragment[];
  contacts?: LotteryDealerContactFieldsFragment[];
}

export interface DealersWorld {
  handlers: Parameters<typeof import("../server").server.use>;
  /** 各 mutation 收到的 input(依序) */
  inputs: {
    createLotteryDealer: CreateLotteryDealerMutationVariables["input"][];
    updateLotteryDealer: UpdateLotteryDealerMutationVariables["input"][];
    createLotteryDealerContact: CreateLotteryDealerContactMutationVariables["input"][];
    updateLotteryDealerContact: UpdateLotteryDealerContactMutationVariables["input"][];
    registerLotteryDealerSignin: RegisterLotteryDealerSigninMutationVariables["input"][];
  };
  /** 清單查詢收到的 input(驗篩選有送到 api) */
  listInputs: LotteryDealersQueryVariables["input"][];
}

/**
 * 經銷商管理的假 api(規則照 `docs/modules/project/dealers.md`):有狀態 —— 新增 / 編輯後重查看得到新值;
 * 移除共同銷售處所但還有代理人 → `CONFLICT`(列出代理人),帶 `releaseAgents` 重送才清掉;
 * 取消的身分還有關聯 → `CONFLICT`。篩選只做畫面會用到的幾種(類型、關鍵字、可選、身分、狀態)。
 */
export const dealersWorld = ({
  dealers = dealerFixtures,
  contacts = contactFixtures,
}: DealersWorldOptions = {}): DealersWorld => {
  const dealerState = dealers.map((dealer) => ({ ...dealer }));
  const contactState = contacts.map((contact) => ({ ...contact }));
  const signedQuarters = new Map<string, Set<number>>();
  const inputs: DealersWorld["inputs"] = {
    createLotteryDealer: [],
    updateLotteryDealer: [],
    createLotteryDealerContact: [],
    updateLotteryDealerContact: [],
    registerLotteryDealerSignin: [],
  };
  const listInputs: DealersWorld["listInputs"] = [];
  let sequence = 0;

  const handlers: DealersWorld["handlers"] = [
    api.query("LotteryDealers", ({ variables }) => {
      const { input } = variables as LotteryDealersQueryVariables;
      listInputs.push(input);
      const keyword = input.keyword?.trim() ?? "";
      const items = dealerState.filter(
        (dealer) =>
          dealer.type === input.type &&
          (keyword === "" ||
            dealer.name.includes(keyword) ||
            dealer.licenseNo.includes(keyword) ||
            (dealer.storeName ?? "").includes(keyword)) &&
          (input.selectable !== true ||
            dealer.status !== LotteryDealerStatus.Terminated),
      );
      return HttpResponse.json({
        data: {
          lotteryDealers: {
            items,
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryDealer", ({ variables }) => {
      const dealer = dealerState.find(
        (item) => item.id === (variables as { id: string }).id,
      );
      return dealer === undefined
        ? businessError({ code: "NOT_FOUND" })
        : HttpResponse.json({ data: { lotteryDealer: { item: dealer } } });
    }),
    api.query("LotteryDealerSignins", ({ variables }) => {
      const { dealerId, year } =
        variables as LotteryDealerSigninsQueryVariables;
      const signed = signedQuarters.get(dealerId) ?? new Set([1, 2]);
      const items = [1, 2, 3, 4].map((quarter) => {
        const isSigned = signed.has(quarter);
        let state = LotterySigninState.NotStarted;
        if (isSigned) {
          state = LotterySigninState.Signed;
        } else if (quarter === 3) {
          state = LotterySigninState.Missing;
        } else if (quarter === 4) {
          state = LotterySigninState.Open;
        }
        return {
          id: isSigned ? `signin-${String(quarter)}` : null,
          year,
          quarter,
          signedAt: isSigned
            ? new Date(Date.UTC(year, quarter * 3 - 3, 10)).toISOString()
            : null,
          note: null,
          state,
        };
      });
      return HttpResponse.json({
        data: { lotteryDealerSignins: { items, totalCount: 4 } },
      });
    }),
    api.query("LotteryDealerCoSellers", () => {
      const items = dealerState
        .filter((dealer) => dealer.type === LotteryDealerType.A)
        .map((dealer) => ({
          dealer: {
            id: dealer.id,
            type: dealer.type,
            licenseNo: dealer.licenseNo,
            name: dealer.name,
            storeName: null,
            status: dealer.status,
          },
          registeredAt: dealer.createdAt,
        }));
      return HttpResponse.json({
        data: { lotteryDealerCoSellers: { items, totalCount: items.length } },
      });
    }),
    api.query("LotteryOccupiedStores", () =>
      HttpResponse.json({
        data: {
          lotteryOccupiedStores: {
            items: occupiedStoreFixtures,
            totalCount: occupiedStoreFixtures.length,
          },
        },
      }),
    ),
    api.mutation("CreateLotteryDealer", ({ variables }) => {
      const { input } = variables as CreateLotteryDealerMutationVariables;
      inputs.createLotteryDealer.push(input);
      sequence += 1;
      const template = [...dealerState, ...dealerFixtures].at(0);
      if (template === undefined) {
        return businessError({ code: "VALIDATION_FAILED" });
      }
      const created: LotteryDealerFieldsFragment = {
        ...template,
        id: `dealer-new-${String(sequence)}`,
        type: input.type,
        licenseNo: input.licenseNo ?? "",
        name: input.name ?? "",
        nationalId: input.nationalId ?? "",
        coSalesDealer: null,
        agents: [],
        trustees: [],
        introducers: [],
        licenseState: LotteryLicenseState.Ok,
      };
      dealerState.push(created);
      return HttpResponse.json({
        data: { createLotteryDealer: { item: created } },
      });
    }),
    api.mutation("UpdateLotteryDealer", ({ variables }) => {
      const { input } = variables as UpdateLotteryDealerMutationVariables;
      inputs.updateLotteryDealer.push(input);
      const current = dealerState.find((item) => item.id === input.id);
      if (current === undefined) {
        return businessError({ code: "NOT_FOUND" });
      }
      if (
        input.coSalesDealerId === null &&
        current.agents.length > 0 &&
        input.agentIds === undefined &&
        input.releaseAgents !== true
      ) {
        return businessError({
          code: "CONFLICT",
          reason: "AGENTS_REQUIRE_CO_SALES",
          relationships: current.agents.map((agent) => ({
            role: "agent",
            dealerId: current.id,
            dealerName: current.name,
            licenseNo: current.licenseNo,
            contactId: agent.id,
            contactName: agent.name,
          })),
        });
      }
      const updated: LotteryDealerFieldsFragment = {
        ...current,
        ...(input.name === undefined || input.name === null
          ? {}
          : { name: input.name }),
        ...(input.coSalesDealerId === null
          ? { coSalesDealer: null, agents: [] }
          : {}),
      };
      dealerState[dealerState.indexOf(current)] = updated;
      return HttpResponse.json({
        data: { updateLotteryDealer: { item: updated } },
      });
    }),
    api.mutation("RegisterLotteryDealerSignin", ({ variables }) => {
      const { input } =
        variables as RegisterLotteryDealerSigninMutationVariables;
      inputs.registerLotteryDealerSignin.push(input);
      const signed = signedQuarters.get(input.dealerId) ?? new Set([1, 2]);
      signed.add(input.quarter);
      signedQuarters.set(input.dealerId, signed);
      return HttpResponse.json({
        data: {
          registerLotteryDealerSignin: {
            item: {
              id: `signin-${String(input.quarter)}`,
              year: input.year,
              quarter: input.quarter,
              signedAt: input.signedAt,
              note: input.note ?? null,
              state: LotterySigninState.Signed,
            },
          },
        },
      });
    }),
    api.query("LotteryDealerContacts", ({ variables }) => {
      const { input } = variables as LotteryDealerContactsQueryVariables;
      const keyword = input.keyword?.trim() ?? "";
      const items = contactState.filter(
        (contact) =>
          (input.role == null || contact.roles.includes(input.role)) &&
          (input.status == null || contact.status === input.status) &&
          (keyword === "" || contact.name.includes(keyword)),
      );
      return HttpResponse.json({
        data: {
          lotteryDealerContacts: {
            items,
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryDealerContact", ({ variables }) => {
      const contact = contactState.find(
        (item) => item.id === (variables as { id: string }).id,
      );
      return contact === undefined
        ? businessError({ code: "NOT_FOUND" })
        : HttpResponse.json({
            data: { lotteryDealerContact: { item: contact } },
          });
    }),
    api.mutation("CreateLotteryDealerContact", ({ variables }) => {
      const { input } =
        variables as CreateLotteryDealerContactMutationVariables;
      inputs.createLotteryDealerContact.push(input);
      sequence += 1;
      const template = [...contactState, ...contactFixtures].at(0);
      if (template === undefined) {
        return businessError({ code: "VALIDATION_FAILED" });
      }
      const created: LotteryDealerContactFieldsFragment = {
        ...template,
        id: `contact-new-${String(sequence)}`,
        name: input.name ?? "",
        roles: input.roles ?? [],
        nationalId: input.nationalId ?? "",
        dealerCount: 0,
        links: [],
      };
      contactState.push(created);
      return HttpResponse.json({
        data: { createLotteryDealerContact: { item: created } },
      });
    }),
    api.mutation("UpdateLotteryDealerContact", ({ variables }) => {
      const { input } =
        variables as UpdateLotteryDealerContactMutationVariables;
      inputs.updateLotteryDealerContact.push(input);
      const current = contactState.find((item) => item.id === input.id);
      if (current === undefined) {
        return businessError({ code: "NOT_FOUND" });
      }
      const roles = input.roles ?? current.roles;
      const removed = current.links.filter(
        (link) => !roles.includes(link.role),
      );
      if (removed.length > 0 && input.releaseRelationships !== true) {
        return businessError({
          code: "CONFLICT",
          reason: "ROLE_IN_USE",
          relationships: removed.map((link) => ({
            role: link.role.toLowerCase(),
            dealerId: link.dealer.id,
            dealerName: link.dealer.name,
            licenseNo: link.dealer.licenseNo,
            contactId: current.id,
            contactName: current.name,
          })),
          // 另有一筆操作者看不到的經銷商上的關聯(資料共用:只回筆數)
          hiddenCount: 1,
        });
      }
      const updated: LotteryDealerContactFieldsFragment = {
        ...current,
        roles,
        links: current.links.filter((link) => roles.includes(link.role)),
      };
      contactState[contactState.indexOf(current)] = updated;
      return HttpResponse.json({
        data: { updateLotteryDealerContact: { item: updated } },
      });
    }),
  ];

  return { handlers, inputs, listInputs };
};
