import { useState } from "react";
import type { Item } from "@/lib/api";

/**
 * Drag-and-drop reordering of a quest's tasks. On drop it computes the new order
 * and hands the full list of ids to `onReorder`, which saves it atomically.
 */
export function useItemDragReorder(items: Item[], onReorder: (itemIds: number[]) => Promise<unknown>) {
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(itemId));
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDragOver = (e: React.DragEvent, itemId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedItemId && draggedItemId !== itemId) setDragOverItemId(itemId);
  };

  const handleDrop = async (e: React.DragEvent, targetItemId: number) => {
    e.preventDefault();
    setDragOverItemId(null);
    const dragged = draggedItemId;
    setDraggedItemId(null);
    if (!dragged || dragged === targetItemId) return;

    const from = items.findIndex((i) => i.id === dragged);
    const to = items.findIndex((i) => i.id === targetItemId);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    try {
      await onReorder(next.map((i) => i.id));
    } catch {
      /* error toast shown by the mutation hook */
    }
  };

  return {
    draggedItemId,
    dragOverItemId,
    handlers: { onDragStart: handleDragStart, onDragEnd: handleDragEnd, onDragOver: handleDragOver, onDragLeave: () => setDragOverItemId(null), onDrop: handleDrop },
  };
}
