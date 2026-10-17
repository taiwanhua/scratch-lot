import { Graph, layout } from "@dagrejs/dagre";

import type { StepKind, WorkflowDefinition } from "@repo/domain/workflow";

/**
 * 流程圖的自動直式排版(`@dagrejs/dagre`,由上往下):節點位置**全由排版決定**,使用者不手擺;
 * 拖節點只改段落串(順序 / 分支),放開後重新排版。
 */

export interface NodeSize {
  width: number;
  height: number;
}

/** 審核關卡卡片與匯合節點菱形的尺寸(React Flow 以它當節點的固定尺寸,排版也用同一份)。 */
export const NODE_SIZES: Record<StepKind, NodeSize> = {
  review: { width: 240, height: 104 },
  join: { width: 56, height: 56 },
};

export interface LaidOutNode {
  key: string;
  kind: StepKind;
  /** 左上角(React Flow 的 position) */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/** 直線版本沒有 `edges`:以陣列順序兩兩相連。 */
const edgesOf = (definition: WorkflowDefinition): LaidOutEdge[] => {
  const raw =
    definition.edges !== null &&
    definition.edges !== undefined &&
    definition.edges.length > 0
      ? definition.edges
      : definition.steps.slice(1).map((step, index) => ({
          from: definition.steps[index].key,
          to: step.key,
        }));
  return raw.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
  }));
};

export const layoutDefinition = (
  definition: WorkflowDefinition,
): FlowLayout => {
  const graph = new Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 48 });
  graph.setDefaultEdgeLabel(() => ({}));
  const known = new Set(definition.steps.map((step) => step.key));
  for (const step of definition.steps) {
    graph.setNode(step.key, { ...NODE_SIZES[step.kind ?? "review"] });
  }
  const edges = edgesOf(definition).filter(
    (edge) => known.has(edge.source) && known.has(edge.target),
  );
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  layout(graph);

  const nodes = definition.steps.map((step): LaidOutNode => {
    const kind = step.kind ?? "review";
    const size = NODE_SIZES[kind];
    const placed = graph.node(step.key) as { x?: number; y?: number };
    return {
      key: step.key,
      kind,
      x: (placed.x ?? 0) - size.width / 2,
      y: (placed.y ?? 0) - size.height / 2,
      ...size,
    };
  });
  return { nodes, edges };
};
