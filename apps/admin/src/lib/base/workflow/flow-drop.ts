import type { FlowLayout } from "./flow-layout";
import type { DropTarget } from "./flow-ops";

export interface Point {
  x: number;
  y: number;
}

/**
 * 拖節點放開時要放哪(畫面上不開放自由拉線,拖拉只改順序 / 分支):
 * 找離放開位置最近的**另一個**節點 —— 是審核關卡就插在它之前 / 之後(看放在它中心的上方或下方),
 * 是匯合節點就接在匯合之後。沒有別的節點回 null(原地不動)。
 */
export const dropTargetOf = (
  layout: FlowLayout,
  draggedKey: string,
  center: Point,
): DropTarget | null => {
  let best: { key: string; kind: string; y: number; distance: number } | null =
    null;
  for (const node of layout.nodes) {
    if (node.key === draggedKey) {
      continue;
    }
    const nodeCenter = {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    };
    const distance = Math.hypot(
      nodeCenter.x - center.x,
      nodeCenter.y - center.y,
    );
    if (best === null || distance < best.distance) {
      best = { key: node.key, kind: node.kind, y: nodeCenter.y, distance };
    }
  }
  if (best === null) {
    return null;
  }
  if (best.kind === "join") {
    return { kind: "afterJoin", joinKey: best.key };
  }
  return {
    kind: center.y < best.y ? "before" : "after",
    stepKey: best.key,
  };
};
