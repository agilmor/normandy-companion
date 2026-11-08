// Seeded PRNG (mulberry32), same as 48_1997_EscapeFromNY, 49, 51, 58 and 60. The generator state
// lives in the game state (`g.rng`), so a game replays identically.

/** @param {string | number} value */
export function seedFrom(value) {
    const s = String(value);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** @param {{ rng: number }} g  @returns {number} float in [0, 1) */
export function nextRandom(g) {
    let t = (g.rng = (g.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** @param {{ rng: number }} g  @param {number} n  @returns {number} integer in [0, n) */
export const randomInt = (g, n) => Math.floor(nextRandom(g) * n);

/** In-place Fisher-Yates. @template T @param {{ rng: number }} g @param {T[]} arr */
export function shuffle(g, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(g, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
