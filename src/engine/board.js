// Board geometry (docs/01 §3, [D-1], [D-2]). Each tile is a square whose top-left corner sits at (x, y) in
// half-tile units, so it covers [x, x+2) × [y, y+2). Two tiles are adjacent when they share a stretch of edge; the
// distance between two tiles is the shortest number of steps between adjacent tiles.

const cache = new Map();

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b */
export function touches(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return (dx === 2 && dy < 2) || (dy === 2 && dx < 2);
}

/**
 * Adjacency lists and all-pairs distances of a scenario's tiles, computed once per scenario.
 * @param {{ id: number, tiles: { id: string, x: number, y: number }[] }} sc
 * @returns {{ ids: string[], adj: Record<string, string[]>, dist: Record<string, Record<string, number>> }}
 */
export function boardOf(sc) {
    if (cache.has(sc.id)) return cache.get(sc.id);
    const ids = sc.tiles.map((t) => t.id);
    const adj = {};
    for (const a of sc.tiles) adj[a.id] = sc.tiles.filter((b) => b !== a && touches(a, b)).map((b) => b.id);
    const dist = {};
    for (const from of ids) {
        const d = { [from]: 0 };
        const queue = [from];
        while (queue.length) {
            const cur = queue.shift();
            for (const n of adj[cur]) if (!(n in d)) (d[n] = d[cur] + 1), queue.push(n);
        }
        dist[from] = d;
    }
    const board = { ids, adj, dist };
    cache.set(sc.id, board);
    return board;
}
