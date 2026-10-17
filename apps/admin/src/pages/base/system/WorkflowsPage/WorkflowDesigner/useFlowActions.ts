import { useTranslations } from "use-intl";

import type { JoinStepDef, ReviewStepDef } from "@repo/domain/workflow";

import {
  type Flow,
  isForkSource,
  parallelOf,
  positionOf,
} from "@/lib/base/workflow/flow-model";
import {
  type DropTarget,
  addBranch,
  forkFrom,
  insertAfter,
  insertAfterJoin,
  moveStep,
  newReviewStep,
  nextKey,
  removeParallel,
  removeStep,
  renameJoin,
  shiftStep,
  updateStep,
} from "@/lib/base/workflow/flow-ops";

import type { MoveOption } from "./StepEditor";
import type { FlowDesignerState } from "./useFlowDesignerState";

/**
 * 設計器的操作(按鈕與拖拉共用):產生新節點(key 版本內唯一、名稱給預設)後交給 `flow-ops.ts` 的純函式,
 * 結果經 `state.apply` 套用 —— 被拒時畫面顯示原因、段落串不變。
 */
export const useFlowActions = (state: FlowDesignerState) => {
  const t = useTranslations("admin.workflows.designer");
  const flow: Flow = state.flow ?? [];

  const newStep = (base: Flow): ReviewStepDef => {
    const key = nextKey(base, "step");
    return newReviewStep(
      key,
      t("newStep", { n: Number(key.slice("step_".length)) }),
    );
  };

  /** 「移到分支」的選項:每組分流的每條分支(自己是唯一一關的那條除外,移走會留下空分支)。 */
  const moveOptionsOf = (stepKey: string): MoveOption[] => {
    const options: MoveOption[] = [];
    for (const segment of flow) {
      if (segment.type !== "parallel") {
        continue;
      }
      for (const [index, branch] of segment.branches.entries()) {
        const isOnlyStep = branch.length === 1 && branch[0].key === stepKey;
        if (isOnlyStep) {
          continue;
        }
        options.push({
          value: `${segment.join.key}:${String(index)}`,
          label: t("moveToBranch", { join: segment.join.name, n: index + 1 }),
          target: {
            kind: "branchEnd",
            joinKey: segment.join.key,
            branch: index,
          },
        });
      }
    }
    return options;
  };

  const positionInfo = (stepKey: string) => {
    const position = positionOf(flow, stepKey);
    return {
      canFork:
        position !== null &&
        position.container === "main" &&
        !isForkSource(flow, position),
      /** 在分支裡的關卡:它所屬那組分流的匯合 key */
      joinKey:
        position?.container === "branch"
          ? (flow.at(position.segment) as { join?: JoinStepDef }).join?.key
          : undefined,
    };
  };

  return {
    moveOptionsOf,
    positionInfo,
    appendAtEnd: () => {
      state.apply(insertAfter(flow, null, newStep(flow)));
    },
    insertAfter: (stepKey: string) => {
      state.apply(insertAfter(flow, stepKey, newStep(flow)));
    },
    insertAfterJoin: (joinKey: string) => {
      state.apply(insertAfterJoin(flow, joinKey, newStep(flow)));
    },
    fork: (stepKey: string, count: number) => {
      // 一次要 N 個 key:每產生一個就先放進暫存的段落串,下一個才不會撞號
      const branches: ReviewStepDef[] = [];
      let taken: Flow = flow;
      for (let index = 0; index < count; index += 1) {
        const step = newStep(taken);
        branches.push(step);
        taken = [...taken, { type: "step", step }];
      }
      const joinKey = nextKey(taken, "join");
      state.apply(
        forkFrom(flow, stepKey, branches, {
          key: joinKey,
          name: t("newJoin"),
          kind: "join",
        }),
      );
    },
    addBranch: (joinKey: string) => {
      state.apply(addBranch(flow, joinKey, newStep(flow)));
    },
    shift: (stepKey: string, delta: -1 | 1) => {
      state.apply(shiftStep(flow, stepKey, delta));
    },
    move: (stepKey: string, target: DropTarget) => {
      state.apply(moveStep(flow, stepKey, target));
    },
    remove: (stepKey: string) => {
      state.apply(removeStep(flow, stepKey));
    },
    removeParallel: (joinKey: string) => {
      state.apply(removeParallel(flow, joinKey));
    },
    update: (stepKey: string, next: ReviewStepDef) => {
      state.update(updateStep(flow, stepKey, next));
      if (next.key !== stepKey) {
        state.select(next.key);
      }
    },
    renameJoin: (joinKey: string, name: string) => {
      state.update(renameJoin(flow, joinKey, name));
    },
    branchCountOf: (joinKey: string): number =>
      parallelOf(flow, joinKey)?.branches.length ?? 0,
  };
};
