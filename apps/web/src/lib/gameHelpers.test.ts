import { describe, expect, it } from 'vitest';
import { clampBet, parseBetInput, pickFreeCell, tallyGames } from './gameHelpers';

describe('pickFreeCell', () => {
    it('never returns an occupied cell', () => {
        const snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
        for (let i = 0; i < 50; i++) {
            const c = pickFreeCell(2, snake, () => i / 50);
            expect(c).toEqual({ x: 1, y: 1 });
        }
    });
    it('returns null when the grid is full', () => {
        expect(pickFreeCell(1, [{ x: 0, y: 0 }])).toBeNull();
    });
    it('covers the whole free area for rng extremes', () => {
        expect(pickFreeCell(3, [], () => 0)).toEqual({ x: 0, y: 0 });
        expect(pickFreeCell(3, [], () => 0.999999)).toEqual({ x: 2, y: 2 });
    });
});

describe('bet parsing', () => {
    it('parses whole numbers and rejects the rest', () => {
        expect(parseBetInput(' 25 ')).toBe(25);
        expect(parseBetInput('')).toBeNull();
        expect(parseBetInput('1.5')).toBeNull();
        expect(parseBetInput('-5')).toBeNull();
        expect(parseBetInput('abc')).toBeNull();
    });
    it('clamps into range and falls back on garbage', () => {
        expect(clampBet('1', 5, 100, 5)).toBe(5);
        expect(clampBet('5000', 5, 100, 5)).toBe(100);
        expect(clampBet('50', 5, 100, 5)).toBe(50);
        expect(clampBet('', 5, 100, 30)).toBe(30);
        expect(clampBet('', 5, 100, 500)).toBe(100);
    });
});

describe('tallyGames', () => {
    it('counts wins (a blackjack is one), losses and net XP per game, in first-seen order', () => {
        const rounds = [
            { game_type: 'blackjack', state: 'blackjack', net: 15 },
            { game_type: 'rps', state: 'won', net: 10 },
            { game_type: 'blackjack', state: 'lost', net: -20 },
            { game_type: 'blackjack', state: 'push', net: 0 },
            { game_type: 'rps', state: 'cancelled', net: 0 },
        ];
        expect(tallyGames(rounds)).toEqual([
            { game: 'blackjack', played: 3, won: 1, lost: 1, net: -5 },
            { game: 'rps', played: 2, won: 1, lost: 0, net: 10 },
        ]);
    });
    it('is empty for no rounds', () => {
        expect(tallyGames([])).toEqual([]);
    });
});
