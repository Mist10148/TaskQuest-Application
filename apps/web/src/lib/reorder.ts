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
