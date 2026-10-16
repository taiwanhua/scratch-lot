import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import { RootProviders } from "../app/providers/RootProviders";
import { AppRoutes } from "../app/routes";
import type { AuthSession } from "../lib/base/auth/session";
import { LocationProbe } from "./location-probe";

export interface TestAppProps {
  path: string;
  session: AuthSession;
  queryClient: QueryClient;
  extra?: ReactNode;
}

/** 與 App.tsx 相同組裝(同一份 `RootProviders` 接線),只把 BrowserRouter 換成 MemoryRouter、多掛探針。 */
export const TestApp = ({
  path,
  session,
  queryClient,
  extra,
}: TestAppProps) => (
  <MemoryRouter initialEntries={[path]}>
    <RootProviders session={session} queryClient={queryClient}>
      <AppRoutes />
      {extra}
      <LocationProbe />
    </RootProviders>
  </MemoryRouter>
);
