/**
 * The reorder endpoint needs every task id of the list exactly once. `visibleOrder` is the new order of the
 * tasks on screen; ids the screen hides (pending undo-delete) or does not know yet are appended last.
 */
export function completeOrder(visibleOrder: number[], allIds: number[]): number[] {
    const known = new Set(allIds);
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of visibleOrder) {
        if (known.has(id) && !seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    for (const id of allIds) if (!seen.has(id)) out.push(id);
    return out;
}

/** Items sorted to follow `itemIds` (ids not listed keep their relative order at the end), with positions renumbered. */
export function applyItemOrder<T extends { id: number; position?: number }>(items: readonly T[], itemIds: readonly number[]): T[] {
    const rank = new Map<number, number>();
    itemIds.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
    return items
        .map((item, original) => ({ item, original }))
        .sort((a, b) => (rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity) || a.original - b.original)
        .map(({ item }, i) => ({ ...item, position: i }));
}

/** Ids between `anchor` and `target` (inclusive) in `order`, for Shift-click range selection. Empty if either is missing. */
export function rangeBetween(order: readonly number[], anchor: number, target: number): number[] {
    const a = order.indexOf(anchor);
    const b = order.indexOf(target);
    if (a < 0 || b < 0) return [];
    return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
