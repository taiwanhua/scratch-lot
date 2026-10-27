import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type NodeChange,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import type { WorkflowDefinition } from "@repo/domain/workflow";
import { Box } from "@repo/ui/box";

import { dropTargetOf } from "@/lib/base/workflow/flow-drop";
import { layoutDefinition } from "@/lib/base/workflow/flow-layout";
import type { DropTarget } from "@/lib/base/workflow/flow-ops";

import { JoinNode } from "./JoinNode";
import { ReviewStepNode } from "./ReviewStepNode";
import type {
  JoinNodeData,
  ReviewNodeData,
  WorkflowFlowNode,
} from "./flow-nodes";

/** 節點種類 → 元件;模組層常數(每次 render 換新物件會讓 React Flow 重掛所有節點,REACT-09)。 */
const NODE_TYPES = { review: ReviewStepNode, join: JoinNode } as const;

export interface FlowCanvasProps {
  definition: WorkflowDefinition;
  /** 每個節點要顯示的文字(設計器組好;節點元件不拿 `t`) */
  dataOf: (stepKey: string) => ReviewNodeData | JoinNodeData;
  selectedKey: string | null;
  onSelect: (stepKey: string | null) => void;
  /** 可編輯時才能拖審核關卡改順序 / 換分支 */
  isEditable: boolean;
  onMove?: (stepKey: string, target: DropTarget) => void;
  /** 平板寬(屬性在抽屜裡):流程圖變窄或換選後,選中的節點跑出可視範圍就平移回來 */
  shouldKeepSelectedInView?: boolean;
  "aria-label": string;
}

/** 把選中節點捲回來時的動畫長度(ms) */
const PAN_DURATION = 200;

/**
 * 流程圖變窄(平板寬打開屬性抽屜)或換選節點後,選中的節點若跑出可視範圍,平移把它放回中間(縮放不變)。
 * 必須放在 `<ReactFlow>` 裡面才拿得到它的實例;jsdom 量不到寬度(0)時不動。
 */
const KeepSelectedInView = ({
  selectedKey,
}: {
  selectedKey: string | null;
}) => {
  const { getInternalNode, getViewport, setCenter } = useReactFlow();
  const width = useStore((store) => store.width);
  const height = useStore((store) => store.height);

  useEffect(() => {
    if (selectedKey === null || width === 0 || height === 0) {
      return;
    }
    const node = getInternalNode(selectedKey);
    if (node === undefined) {
      return;
    }
    const { x, y, zoom } = getViewport();
    const position = node.internals.positionAbsolute;
    const nodeWidth = node.measured.width ?? node.width ?? 0;
    const nodeHeight = node.measured.height ?? node.height ?? 0;
    const left = position.x * zoom + x;
    const top = position.y * zoom + y;
    const isInView =
      left >= 0 &&
      top >= 0 &&
      left + nodeWidth * zoom <= width &&
      top + nodeHeight * zoom <= height;
    if (!isInView) {
      void setCenter(position.x + nodeWidth / 2, position.y + nodeHeight / 2, {
        zoom,
        duration: PAN_DURATION,
      });
    }
  }, [selectedKey, width, height, getInternalNode, getViewport, setCenter]);

  return null;
};

interface Dragging {
  key: string;
  position: { x: number; y: number };
}

/**
 * 流程圖(React Flow `@xyflow/react` + `@dagrejs/dagre` 自動直式排版):
 * 節點位置由排版決定,使用者不手擺;**不開放自由拉線**(連線由段落串產生)。
 * 拖一個審核關卡放開 = 依放開位置找最近的節點,插在它前 / 後(或匯合之後),再重新排版;
 * 不合法的放法(留下空分支、移走分流來源)由呼叫端拒絕,節點彈回原位。
 */
export const FlowCanvas = ({
  definition,
  dataOf,
  selectedKey,
  onSelect,
  isEditable,
  onMove,
  shouldKeepSelectedInView = false,
  "aria-label": ariaLabel,
}: FlowCanvasProps) => {
  const layout = useMemo(() => layoutDefinition(definition), [definition]);
  const [dragging, setDragging] = useState<Dragging | null>(null);

  const nodes = layout.nodes.map((node): WorkflowFlowNode => {
    const common = {
      id: node.key,
      position:
        dragging?.key === node.key
          ? dragging.position
          : { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      selected: node.key === selectedKey,
      connectable: false,
      deletable: false,
    };
    return node.kind === "join"
      ? {
          ...common,
          type: "join",
          draggable: false,
          data: dataOf(node.key),
        }
      : {
          ...common,
          type: "review",
          draggable: isEditable,
          data: dataOf(node.key) as ReviewNodeData,
        };
  });
  const edges: Edge[] = layout.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    selectable: false,
    focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  const onNodesChange = (changes: NodeChange<WorkflowFlowNode>[]) => {
    for (const change of changes) {
      // 鍵盤聚焦節點按 Enter / 空白鍵也是選取:React Flow 以 `select` 變更回報(受控模式不會自己改)
      if (change.type === "select" && change.selected) {
        onSelect(change.id);
      }
      if (
        change.type === "position" &&
        change.dragging === true &&
        change.position !== undefined
      ) {
        setDragging({ key: change.id, position: change.position });
      }
    }
  };

  return (
    <Box
      aria-label={ariaLabel}
      role="region"
      sx={{
        height: 520,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      <ReactFlow<WorkflowFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => {
          onSelect(node.id);
        }}
        onPaneClick={() => {
          onSelect(null);
        }}
        onNodeDragStop={(_event, node) => {
          setDragging(null);
          const placed = layout.nodes.find((item) => item.key === node.id);
          if (placed === undefined || onMove === undefined) {
            return;
          }
          const target = dropTargetOf(layout, node.id, {
            x: node.position.x + placed.width / 2,
            y: node.position.y + placed.height / 2,
          });
          if (target !== null) {
            onMove(node.id, target);
          }
        }}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        fitView
        // 關卡少的流程不要被放大到滿版:最多原尺寸,四周留白
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={0.3}
      >
        <Background />
        <Controls showInteractive={false} />
        {shouldKeepSelectedInView && (
          <KeepSelectedInView selectedKey={selectedKey} />
        )}
      </ReactFlow>
    </Box>
  );
};
