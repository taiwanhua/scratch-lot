import type { FormLookupProvidersQuery } from "@repo/graphql";

export type LookupProviderFixture =
  FormLookupProvidersQuery["formLookupProviders"]["items"][number];

/** api 登錄表的底座三種來源(`apps/api/src/forms/lookup-providers.ts` 的宣告)。 */
export const BASE_LOOKUP_PROVIDERS: LookupProviderFixture[] = [
  {
    key: "user",
    name: "使用者",
    isBase: true,
    labelField: "name",
    valueField: "id",
    filterFields: ["enabled"],
    fields: [
      { key: "name", type: "text", label: null },
      { key: "account", type: "text", label: null },
      { key: "email", type: "text", label: null },
    ],
  },
  {
    key: "org",
    name: "組織",
    isBase: true,
    labelField: "name",
    valueField: "id",
    filterFields: ["enabled"],
    fields: [
      { key: "name", type: "text", label: null },
      { key: "slug", type: "text", label: null },
    ],
  },
  {
    key: "form_submission",
    name: "其他表單提交",
    isBase: true,
    labelField: "title",
    valueField: "id",
    filterFields: [],
    fields: [],
  },
];
