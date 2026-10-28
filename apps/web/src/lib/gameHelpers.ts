/** Pure helpers for the web games, kept out of the components so they can be unit tested. */

export interface Cell {
    x: number;
    y: number;
}

/** Picks a random grid cell that is not occupied; null when the grid is full. `rng` returns [0, 1). */
export function pickFreeCell(gridSize: number, occupied: Cell[], rng: () => number = Math.random): Cell | null {
    const taken = new Set(occupied.map((c) => c.y * gridSize + c.x));
    const free: Cell[] = [];
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            if (!taken.has(y * gridSize + x)) free.push({ x, y });
        }
    }
    if (free.length === 0) return null;
    return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}

/** Parses the text of a bet box: whole numbers only. Returns null for empty or invalid text. */
export function parseBetInput(raw: string): number | null {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : null;
}

/** Clamps typed bet text into [min, max]; unparseable text falls back to `fallback` (also clamped). */
export function clampBet(raw: string, min: number, max: number, fallback: number): number {
    const n = parseBetInput(raw) ?? fallback;
    return Math.min(max, Math.max(min, n));
}

export interface GameTally {
    game: string;
    played: number;
    won: number;
    lost: number;
    /** XP won minus XP bet and lost, over these rounds. */
    net: number;
}

/**
 * Wins, losses and net XP per game over a list of finished rounds (the recent history), in the order the games first appear.
 * A blackjack counts as a win; a push, an expired or a quit round counts as played only.
 */
export function tallyGames(rounds: ReadonlyArray<{ game_type: string; state: string; net: number }>): GameTally[] {
    const byGame = new Map<string, GameTally>();
    for (const r of rounds) {
        const t = byGame.get(r.game_type) ?? { game: r.game_type, played: 0, won: 0, lost: 0, net: 0 };
        t.played += 1;
        if (r.state === 'won' || r.state === 'blackjack') t.won += 1;
        else if (r.state === 'lost') t.lost += 1;
        t.net += Number(r.net) || 0;
        byGame.set(r.game_type, t);
    }
    return [...byGame.values()];
}
