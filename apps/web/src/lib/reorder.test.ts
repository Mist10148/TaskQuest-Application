import { describe, expect, it } from 'vitest';
import { completeOrder } from './reorder';

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
