import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type WorkflowEffectEvent,
  type WorkflowEffectProps,
  type WorkflowExtensionRegistration,
  WorkflowExtensionsContext,
} from "@/hooks/base/useWorkflowExtensions";

export interface WorkflowExtensionsProviderProps {
  /** 組裝好的登記(`app/module-pages.tsx` 的 `workflowExtensions`) */
  extensions: readonly WorkflowExtensionRegistration[];
  children: ReactNode;
}

interface Running {
  seq: number;
  event: WorkflowEffectEvent;
  Effect: ComponentType<WorkflowEffectProps>;
}

/**
 * 依模組登記的審核擴充(掛在殼層,`AdminShell`):
 *
 * - `notify`:替那個模組登記的每個 `Effect` 各掛一份元件,做完呼叫 `onDone` 就卸載。掛在殼層而不是頁面裡:
 *   送出後換頁、審核後關掉彈窗都不會打斷動作
 * - `reviewsOf`:審核區塊查這個模組登記的 `Review` 元件
 */
export const WorkflowExtensionsProvider = ({
  extensions,
  children,
}: WorkflowExtensionsProviderProps) => {
  const [running, setRunning] = useState<readonly Running[]>([]);
  const nextSeq = useRef(0);

  const notify = useCallback(
    (event: WorkflowEffectEvent) => {
      const effects = extensions.flatMap((extension) =>
        extension.moduleKey === event.moduleKey &&
        extension.Effect !== undefined
          ? [extension.Effect]
          : [],
      );
      if (effects.length === 0) {
        return;
      }
      setRunning((current) => [
        ...current,
        ...effects.map((Effect) => {
          nextSeq.current += 1;
          return { seq: nextSeq.current, event, Effect };
        }),
      ]);
    },
    [extensions],
  );
  const reviewsOf = useCallback(
    (moduleKey: string) =>
      extensions.flatMap((extension) =>
        extension.moduleKey === moduleKey && extension.Review !== undefined
          ? [extension.Review]
          : [],
      ),
    [extensions],
  );
  const value = useMemo(() => ({ notify, reviewsOf }), [notify, reviewsOf]);
  const done = useCallback((seq: number) => {
    setRunning((current) => current.filter((item) => item.seq !== seq));
  }, []);

  return (
    <WorkflowExtensionsContext.Provider value={value}>
      {children}
      {running.map(({ seq, event, Effect }) => (
        <Effect
          key={seq}
          event={event}
          onDone={() => {
            done(seq);
          }}
        />
      ))}
    </WorkflowExtensionsContext.Provider>
  );
};
