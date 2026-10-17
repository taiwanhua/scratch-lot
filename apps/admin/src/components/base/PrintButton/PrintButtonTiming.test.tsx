import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PRINT_SIGNALS } from "@repo/domain/printing";
import { PrintJobError, PrintJobStatus } from "@repo/graphql";

import {
  PRINT_RESULT_LIVE_CHECK_MS,
  PRINT_RESULT_SLOW_POLL_MS,
} from "@/hooks/base/usePrintJobResult";

import {
  type RenderPrintButtonOptions,
  findPrintButton,
  renderPrintButton,
  waitForSentJob,
} from "./print-button-test-support";

/**
 * 列印按鈕等結果的節奏(共用的 `usePrintJobResult`;docs/modules/printers.md「等列印結果」):
 * 連著即時通道時靠 `print-result`,約 2 分鐘補查一次、之後每 2 分鐘;
 * 沒連上時馬上查、之後每 5 秒;信號比建立回應先到也接得住。
 */

const status = () =>
  within(screen.getByTestId("print-button")).getByRole("status");

const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

/** 用假計時器(跟著真時間走,MSW 照常回應)按下 [列印]。 */
const clickPrint = async (options: RenderPrintButtonOptions = {}) => {
  const view = renderPrintButton(options);
  const user = userEvent.setup({
    advanceTimers: jest.advanceTimersByTime.bind(jest),
  });
  await user.click(await findPrintButton());
  return view;
};

/** 按下 [列印] 並等工作建立好。 */
const sendJob = async (options: RenderPrintButtonOptions = {}) => {
  const view = await clickPrint(options);
  await waitForSentJob(view.world);
  return view;
};

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("連著即時通道", () => {
  it("送出 2 分鐘沒收到 print-result → 主動查一次 printJob;已送出逾時 → 失敗:未收到列印結果 + 先確認是否已出紙", async () => {
    const { world } = await sendJob();
    // api 在讀取時把已送出超過 2 分鐘的工作標失敗(NO_RESULT)
    world.finish("job-1", PrintJobStatus.Failed, PrintJobError.NoResult);

    await advance(PRINT_RESULT_LIVE_CHECK_MS - 1000);
    expect(world.jobReads()).toBe(0);
    await advance(1000);

    expect(
      await within(status()).findByText("失敗:未收到列印結果"),
    ).toBeVisible();
    expect(status()).toHaveTextContent("請先確認是否已出紙,再決定要不要補印");
    expect(world.jobReads()).toBe(1);
  });

  it("第一次查到仍是「已送出」(快到 2 分鐘才被認領)→ 再等 2 分鐘查第二次", async () => {
    const { world } = await sendJob();
    world.finish("job-1", PrintJobStatus.Sent);

    await advance(PRINT_RESULT_LIVE_CHECK_MS);
    expect(world.jobReads()).toBe(1);
    expect(status()).toHaveTextContent("已送到印表機…");

    world.finish("job-1", PrintJobStatus.Failed, PrintJobError.NoResult);
    await advance(PRINT_RESULT_LIVE_CHECK_MS - 1000);
    expect(world.jobReads()).toBe(1);
    await advance(1000);

    expect(
      await within(status()).findByText("失敗:未收到列印結果"),
    ).toBeVisible();
    expect(world.jobReads()).toBe(2);
  });

  it("信號比建立工作的回應先到 → 暫存起來,拿到工作就查,不必等 2 分鐘", async () => {
    const gate = Promise.withResolvers<null>();
    const { world, emit } = await clickPrint({
      createResponseGate: gate.promise,
    });
    await waitFor(() => {
      expect(world.created).toHaveLength(1);
    });
    // 代理程式已經印完、信號到了,建立的回應還沒回來
    world.finish("job-1", PrintJobStatus.Printed);
    emit(PRINT_SIGNALS.result, "job-1");
    expect(world.jobReads()).toBe(0);

    gate.resolve(null);

    expect(await within(status()).findByText("已印出")).toBeVisible();
    expect(world.jobReads()).toBe(1);
  });
});

describe("沒連上即時通道(慢速模式)", () => {
  it("工作建立後馬上查一次,之後每 5 秒查一次;有結果就停", async () => {
    const { world } = await sendJob({ realtimeStatus: "slow" });
    await waitFor(() => {
      expect(world.jobReads()).toBe(1);
    });
    expect(status()).toHaveTextContent("已送到印表機…");

    world.finish("job-1", PrintJobStatus.Printed);
    await advance(PRINT_RESULT_SLOW_POLL_MS);

    expect(await within(status()).findByText("已印出")).toBeVisible();
    expect(world.jobReads()).toBe(2);
    await advance(PRINT_RESULT_SLOW_POLL_MS * 3);
    expect(world.jobReads()).toBe(2);
  });

  it("恢復連線 → 不再每 5 秒查,改回 2 分鐘的節奏", async () => {
    const { world, setRealtimeStatus } = await sendJob({
      realtimeStatus: "slow",
    });
    await waitFor(() => {
      expect(world.jobReads()).toBe(1);
    });

    setRealtimeStatus("live");
    await advance(PRINT_RESULT_SLOW_POLL_MS * 3);
    expect(world.jobReads()).toBe(1);

    world.finish("job-1", PrintJobStatus.Printed);
    await advance(PRINT_RESULT_LIVE_CHECK_MS);

    expect(await within(status()).findByText("已印出")).toBeVisible();
    expect(world.jobReads()).toBe(2);
  });
});
