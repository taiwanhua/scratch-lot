/**
 * 呼叫 api 的 GraphQL(`POST <api 網址>/graphql`,`Authorization: Bearer <access token>`)。
 *
 * demo 指令(與專案的 populate)**只透過這支**寫資料:權限照常檢查、操作紀錄(audit_log)照常以登入的那個人寫,
 * 不直接連資料庫寫入。錯誤只帶 api 回的訊息與錯誤碼,不帶送出的變數(裡面可能有密碼)。
 */

/** api 回的錯誤(GraphQL `errors[0]`,或連不上 / 回應不是 GraphQL)。 */
export class GraphqlRequestError extends Error {
  constructor(
    message: string,
    /** `extensions.code`(例:`FORBIDDEN`、`VALIDATION_FAILED`);沒有時為 null。 */
    readonly code: string | null,
    /** `extensions.fields`(哪幾欄不合法);沒有時為空陣列。 */
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = "GraphqlRequestError";
  }
}

export interface GraphqlClient {
  /** 送一個 query / mutation;有 `errors` 就丟 `GraphqlRequestError`。 */
  request<TData>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<TData>;
  /** 同一個 api、換成以這個 access token 呼叫。 */
  withToken(accessToken: string): GraphqlClient;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

interface GraphqlError {
  message?: unknown;
  extensions?: { code?: unknown; fields?: unknown };
}

/** api 網址(origin,例:`https://api-dev.example.com`)→ GraphQL 端點;結尾斜線與已帶的 `/graphql` 都容許。 */
export function graphqlEndpointOf(apiUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error("--api-url 不是合法的網址(例:https://api-dev.example.com)");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("--api-url 必須是 http:// 或 https://");
  }
  let pathname = url.pathname;
  while (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  url.pathname = pathname.endsWith("/graphql")
    ? pathname
    : `${pathname}/graphql`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function errorOf(raw: unknown): GraphqlRequestError {
  const first = (Array.isArray(raw) ? raw[0] : undefined) as
    GraphqlError | undefined;
  const message =
    typeof first?.message === "string" ? first.message : "api 回了錯誤";
  const code =
    typeof first?.extensions?.code === "string" ? first.extensions.code : null;
  const fields = Array.isArray(first?.extensions?.fields)
    ? first.extensions.fields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];
  return new GraphqlRequestError(message, code, fields);
}

export function createGraphqlClient(options: {
  apiUrl: string;
  accessToken?: string;
  fetch?: FetchLike;
}): GraphqlClient {
  const endpoint = graphqlEndpointOf(options.apiUrl);
  const send: FetchLike = options.fetch ?? fetch;

  const request = async <TData>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<TData> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (options.accessToken !== undefined) {
      headers.authorization = `Bearer ${options.accessToken}`;
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await send(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new GraphqlRequestError(
        `連不上 api(${endpoint}):${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }
    const text = await response.text();
    let body: { data?: unknown; errors?: unknown };
    try {
      body = JSON.parse(text) as { data?: unknown; errors?: unknown };
    } catch {
      throw new GraphqlRequestError(
        `api 回應不是 GraphQL(HTTP ${String(response.status)})`,
        null,
      );
    }
    if (body.errors !== undefined) {
      throw errorOf(body.errors);
    }
    if (body.data === undefined || body.data === null) {
      throw new GraphqlRequestError(
        `api 沒有回資料(HTTP ${String(response.status)})`,
        null,
      );
    }
    return body.data as TData;
  };

  return {
    request,
    withToken: (accessToken) =>
      createGraphqlClient({ ...options, accessToken }),
  };
}

const LOGIN = /* GraphQL */ `
  mutation DemoLogin($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

/**
 * 以帳號密碼登入,回傳帶著 access token 的 client。帳號或密碼錯 → 丟錯;
 * 錯誤訊息只用 `who`(例:「示範機構的首任租戶管理員」),不帶帳號(可能是真實信箱)與密碼。
 */
export async function loginAs(
  client: GraphqlClient,
  credentials: { account: string; password: string },
  who: string,
): Promise<GraphqlClient> {
  try {
    const data = await client.request<{ login: { accessToken: string } }>(
      LOGIN,
      { input: credentials },
    );
    return client.withToken(data.login.accessToken);
  } catch (error) {
    if (error instanceof GraphqlRequestError) {
      throw new GraphqlRequestError(
        `${who}登入失敗:${error.message}`,
        error.code,
        error.fields,
      );
    }
    throw error;
  }
}
