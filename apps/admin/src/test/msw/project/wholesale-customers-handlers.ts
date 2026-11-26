import { HttpResponse } from "msw";

import type {
  CreateLotteryWholesaleCustomerMutationVariables,
  DeleteLotteryWholesaleCustomerMutationVariables,
  LotteryWholesaleCustomerFieldsFragment,
  LotteryWholesaleCustomerSameNamesQueryVariables,
  LotteryWholesaleCustomersQueryVariables,
  UpdateLotteryWholesaleCustomerMutationVariables,
} from "@repo/graphql";

import { api } from "../server";
import { type DealersWorld, businessError } from "./dealers-handlers";
import { wholesaleCustomerFixtures } from "./wholesale-customers-fixtures";

export interface WholesaleCustomersWorld {
  handlers: DealersWorld["handlers"];
  /** 各 mutation 收到的 input(依序) */
  inputs: {
    create: CreateLotteryWholesaleCustomerMutationVariables["input"][];
    update: UpdateLotteryWholesaleCustomerMutationVariables["input"][];
    delete: DeleteLotteryWholesaleCustomerMutationVariables["input"][];
  };
  /** 清單查詢收到的 input(驗篩選有送到 api) */
  listInputs: LotteryWholesaleCustomersQueryVariables["input"][];
}

/**
 * 批售客戶的假 api(規則照 `docs/modules/project/dealers.md`):有狀態;證號重複、沒填店名、
 * 被引用(夾具裡有批售日的)刪除會被擋。
 */
export const wholesaleCustomersWorld = (
  customers: LotteryWholesaleCustomerFieldsFragment[] = wholesaleCustomerFixtures,
): WholesaleCustomersWorld => {
  let state = customers.map((customer) => ({ ...customer }));
  const inputs: WholesaleCustomersWorld["inputs"] = {
    create: [],
    update: [],
    delete: [],
  };
  const listInputs: WholesaleCustomersWorld["listInputs"] = [];
  let sequence = 0;

  const handlers: WholesaleCustomersWorld["handlers"] = [
    api.query("LotteryWholesaleCustomers", ({ variables }) => {
      const { input } = variables as LotteryWholesaleCustomersQueryVariables;
      listInputs.push(input);
      const keyword = input.keyword?.trim() ?? "";
      const items = state.filter(
        (customer) =>
          (input.status == null || customer.status === input.status) &&
          (keyword === "" || customer.storeName.includes(keyword)),
      );
      return HttpResponse.json({
        data: {
          lotteryWholesaleCustomers: {
            items,
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryWholesaleCustomer", ({ variables }) => {
      const customer = state.find(
        (item) => item.id === (variables as { id: string }).id,
      );
      return customer === undefined
        ? businessError({ code: "NOT_FOUND" })
        : HttpResponse.json({
            data: { lotteryWholesaleCustomer: { item: customer } },
          });
    }),
    api.query("LotteryWholesaleCustomerSameNames", ({ variables }) => {
      const { input } =
        variables as LotteryWholesaleCustomerSameNamesQueryVariables;
      const items = state
        .filter(
          (customer) =>
            customer.storeName === input.storeName &&
            customer.id !== input.excludeId,
        )
        .map(({ id, storeName, phone }) => ({ id, storeName, phone }));
      return HttpResponse.json({
        data: {
          lotteryWholesaleCustomerSameNames: {
            items,
            totalCount: items.length,
          },
        },
      });
    }),
    api.mutation("CreateLotteryWholesaleCustomer", ({ variables }) => {
      const { input } =
        variables as CreateLotteryWholesaleCustomerMutationVariables;
      inputs.create.push(input);
      if (
        input.licenseNo != null &&
        state.some((item) => item.licenseNo === input.licenseNo)
      ) {
        return businessError({
          code: "VALIDATION_FAILED",
          reason: "WHOLESALE_LICENSE_NO_DUPLICATE",
          fields: ["licenseNo"],
        });
      }
      sequence += 1;
      const template = wholesaleCustomerFixtures[0];
      if ((input.storeName ?? "") === "") {
        return businessError({
          code: "VALIDATION_FAILED",
          fields: ["storeName"],
        });
      }
      const created: LotteryWholesaleCustomerFieldsFragment = {
        ...template,
        id: `wholesale-new-${String(sequence)}`,
        storeName: input.storeName ?? "",
        licenseNo: input.licenseNo ?? null,
        contactName: input.contactName ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        note: input.note ?? null,
        lastWholesaleAt: null,
      };
      state.push(created);
      return HttpResponse.json({
        data: { createLotteryWholesaleCustomer: { item: created } },
      });
    }),
    api.mutation("UpdateLotteryWholesaleCustomer", ({ variables }) => {
      const { input } =
        variables as UpdateLotteryWholesaleCustomerMutationVariables;
      inputs.update.push(input);
      const current = state.find((item) => item.id === input.id);
      if (current === undefined) {
        return businessError({ code: "NOT_FOUND" });
      }
      const updated: LotteryWholesaleCustomerFieldsFragment = {
        ...current,
        ...(input.status == null ? {} : { status: input.status }),
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      state[state.indexOf(current)] = updated;
      return HttpResponse.json({
        data: { updateLotteryWholesaleCustomer: { item: updated } },
      });
    }),
    api.mutation("DeleteLotteryWholesaleCustomer", ({ variables }) => {
      const { input } =
        variables as DeleteLotteryWholesaleCustomerMutationVariables;
      inputs.delete.push(input);
      const current = state.find((item) => item.id === input.id);
      // 有批售日 = 被批售單引用
      if (current?.lastWholesaleAt != null) {
        return businessError({
          code: "VALIDATION_FAILED",
          reason: "WHOLESALE_CUSTOMER_IN_USE",
          fields: ["id"],
        });
      }
      state = state.filter((item) => item !== current);
      return HttpResponse.json({
        data: {
          deleteLotteryWholesaleCustomer: {
            success: true,
            deletedId: input.id,
          },
        },
      });
    }),
  ];

  return { handlers, inputs, listInputs };
};
