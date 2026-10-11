import { describe, expect, it } from 'vitest';
import { applyItemOrder, completeOrder, rangeBetween } from './reorder';

describe('completeOrder', () => {
    it('keeps the visible order and appends hidden ids last', () => {
        expect(completeOrder([3, 1], [1, 2, 3, 4])).toEqual([3, 1, 2, 4]);
    });
    it('drops unknown and duplicate ids', () => {
        expect(completeOrder([9, 1, 1], [1, 2])).toEqual([1, 2]);
    });
    it('returns every id exactly once', () => {
        const out = completeOrder([2, 1], [1, 2, 3]);
        expect([...out].sort()).toEqual([1, 2, 3]);
    });
});

describe('applyItemOrder', () => {
    const items = [{ id: 1, position: 0 }, { id: 2, position: 1 }, { id: 3, position: 2 }];
    it('follows the given order and renumbers positions', () => {
        expect(applyItemOrder(items, [3, 1, 2])).toEqual([{ id: 3, position: 0 }, { id: 1, position: 1 }, { id: 2, position: 2 }]);
    });
    it('keeps unlisted items last in their old order and does not mutate', () => {
        expect(applyItemOrder(items, [2]).map((i) => i.id)).toEqual([2, 1, 3]);
        expect(items[0].position).toBe(0);
    });
});

describe('rangeBetween', () => {
    it('is inclusive and direction independent', () => {
        expect(rangeBetween([5, 6, 7, 8], 6, 8)).toEqual([6, 7, 8]);
        expect(rangeBetween([5, 6, 7, 8], 8, 6)).toEqual([6, 7, 8]);
    });
    it('is empty when an id is missing', () => {
        expect(rangeBetween([5, 6], 5, 9)).toEqual([]);
    });
});
