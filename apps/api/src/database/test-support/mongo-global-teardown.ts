import { stopGlobalReplSet } from "./mongo-global-setup";

/** jest globalTeardown:關掉 globalSetup 起的 replica set。 */
export default async function globalTeardown(): Promise<void> {
  await stopGlobalReplSet();
}
