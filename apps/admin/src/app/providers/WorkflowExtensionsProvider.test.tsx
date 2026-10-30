import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { WorkflowDecision } from "@repo/graphql";

import {
  type ApplyCenterSectionProps,
  type ApprovalReviewProps,
  type WorkflowEffectEvent,
  type WorkflowEffectProps,
  type WorkflowExtensionRegistration,
  useWorkflowExtensions,
} from "@/hooks/base/useWorkflowExtensions";

import { WorkflowExtensionsProvider } from "./WorkflowExtensionsProvider";

const MODULE = "demo.orders";
const OTHER_MODULE = "demo.other";

const decided: WorkflowEffectEvent = {
  kind: "decided",
  moduleKey: MODULE,
  submissionId: "sub-1",
  instanceId: "ins-1",
  stepKey: "first",
  decision: WorkflowDecision.Approve,
};

/** 測試用的事後動作:畫出拿到的事件,[完成] 呼叫 `onDone`。 */
const effectNamed = (name: string) => {
  const Effect = ({ event, onDone }: WorkflowEffectProps) => (
    <div role="status" aria-label={name}>
      {`${name}:${event.kind}:${event.submissionId}`}
      <button type="button" onClick={onDone}>
        {`${name} 完成`}
      </button>
    </div>
  );
  return Effect;
};

const Review = (props: ApprovalReviewProps) => <p hidden>{props.task.id}</p>;
const Section = (props: ApplyCenterSectionProps) => (
  <p hidden>{props.instance.id}</p>
);

/** 觸發端:按鈕送出事件,另外列出查到的 `Review` / `Section` 筆數。 */
const Trigger = ({ event }: { event: WorkflowEffectEvent }) => {
  const { notify, reviewsOf, sectionsOf } = useWorkflowExtensions();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          notify(event);
        }}
      >
        送出事件
      </button>
      <p>{`review:${String(reviewsOf(MODULE).length)}`}</p>
      <p>{`section:${String(sectionsOf(MODULE).length)}`}</p>
    </>
  );
};

const renderProvider = (
  extensions: readonly WorkflowExtensionRegistration[],
  event: WorkflowEffectEvent = decided,
) =>
  render(
    <WorkflowExtensionsProvider extensions={extensions}>
      <Trigger event={event} />
    </WorkflowExtensionsProvider>,
  );

/**
 * 依模組登記的審核後 / 送出後動作(`Effect`;`docs/modules/workflows.md`「依模組登記的審核擴充」):
 * 殼層收到事件就替那個模組登記的每個 `Effect` 各掛一份,做完 `onDone` 卸載;別的模組的不掛。
 */
describe("WorkflowExtensionsProvider", () => {
  it("事件 → 該模組登記的每個 Effect 各掛一份(拿到事件);別的模組的不掛", () => {
    renderProvider([
      { moduleKey: MODULE, Effect: effectNamed("列印") },
      { moduleKey: MODULE, Effect: effectNamed("重新整理") },
      { moduleKey: OTHER_MODULE, Effect: effectNamed("別的模組") },
    ]);
    expect(screen.queryAllByRole("status")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "送出事件" }));

    expect(screen.getByRole("status", { name: "列印" })).toHaveTextContent(
      "列印:decided:sub-1",
    );
    expect(screen.getByRole("status", { name: "重新整理" })).toHaveTextContent(
      "重新整理:decided:sub-1",
    );
    expect(screen.queryByRole("status", { name: "別的模組" })).toBeNull();
  });

  it("onDone → 只卸載那一份;同一個事件再來一次 → 再掛一份", () => {
    renderProvider([{ moduleKey: MODULE, Effect: effectNamed("列印") }]);
    const trigger = screen.getByRole("button", { name: "送出事件" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.getAllByRole("status", { name: "列印" })).toHaveLength(2);

    act(() => {
      screen.getAllByRole("button", { name: "列印 完成" })[0]?.click();
    });
    expect(screen.getAllByRole("status", { name: "列印" })).toHaveLength(1);
  });

  it("送出事件同樣分派;沒有登記 Effect 的模組什麼都不掛", () => {
    const { unmount } = renderProvider(
      [{ moduleKey: MODULE, Effect: effectNamed("列印") }],
      {
        kind: "submitted",
        moduleKey: MODULE,
        submissionId: "sub-2",
        instanceId: null,
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "送出事件" }));
    expect(screen.getByRole("status", { name: "列印" })).toHaveTextContent(
      "列印:submitted:sub-2",
    );
    unmount();

    renderProvider([{ moduleKey: MODULE, Review }]);
    fireEvent.click(screen.getByRole("button", { name: "送出事件" }));
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("reviewsOf / sectionsOf 只回這個模組登記的元件", () => {
    renderProvider([
      { moduleKey: MODULE, Review, Section },
      { moduleKey: MODULE, Effect: effectNamed("列印") },
      { moduleKey: OTHER_MODULE, Review, Section },
    ]);
    expect(screen.getByText("review:1")).toBeInTheDocument();
    expect(screen.getByText("section:1")).toBeInTheDocument();
  });
});
