// Card and scenario data against the components and the scenario book.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, TYPES, TILES, UNITS } from '../src/engine/data.js';
import { boardOf, touches } from '../src/engine/board.js';
import { createState, normalizeSetup, spawnTile } from '../src/engine/state.js';

test('54 cards per side, with the printed initiatives', () => {
    assert.equal(Object.values(TYPES).reduce((n, t) => n + t.copies, 0), 54);
    const init = Object.fromEntries(Object.values(TYPES).map((t) => [t.id, t.initiative]));
    assert.deepEqual([init.PS, init.PG, init.SLA, init.SA, init.RA, init.SN, init.MA, init.MO, init.FOW], [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.deepEqual(Object.values(UNITS).map((u) => u.defence), [4, 5, 4, 4, 6]);
});

test('36 tile faces; hills are 2A, 9A and 16A', () => {
    assert.equal(Object.keys(TILES).length, 36);
    assert.deepEqual(Object.keys(TILES).filter((t) => TILES[t].cover === 'hill'), ['2A', '9A', '16A']);
});

for (const sc of SCENARIOS) {
    test(`scenario ${sc.id}: board, tokens and cards are consistent`, () => {
        const nums = sc.tiles.map((t) => parseInt(t.id, 10));
        assert.equal(new Set(nums).size, nums.length, 'each tile number used once (one face)');
        for (const a of sc.tiles) for (const b of sc.tiles) if (a !== b) assert.ok(Math.abs(a.x - b.x) >= 2 || Math.abs(a.y - b.y) >= 2, `${a.id} overlaps ${b.id}`);
        const { dist, ids } = boardOf(sc);
        for (const t of ids) assert.equal(Object.keys(dist[t]).length, ids.length, `board connected from ${t}`);
        const on = new Set(ids);
        for (const t of [...Object.keys(sc.objectives), ...Object.keys(sc.control), ...Object.values(sc.units.us), ...Object.values(sc.units.de)]) assert.ok(on.has(t), `${t} on the board`);
        for (const side of ['us', 'de']) {
            for (const s of sc.spawns[side]) assert.ok(on.has(s.tile));
            for (const [where, cards] of Object.entries(sc.cards[side])) for (const type of Object.keys(cards)) assert.ok(TYPES[type], `${side} ${where} ${type}`);
            for (const type of Object.keys(TYPES)) {
                const n = (sc.cards[side].deck[type] ?? 0) + (sc.cards[side].supply[type] ?? 0);
                assert.ok(n <= TYPES[type].copies, `${side} ${type}: ${n} > ${TYPES[type].copies}`);
            }
            if (sc.win[side].points) assert.ok(Object.values(sc.objectives).reduce((a, b) => a + b, 0) >= sc.win[side].points);
        }
        // every unit in play has exactly one spawn marker that brings it in ([D-29])
        const g = createState(normalizeSetup({ scenario: sc.id }));
        for (const u of Object.values(g.units)) {
            const side = u.id.slice(0, 2);
            const name = u.type === 'SN' ? 'sniper' : u.type === 'MO' ? 'mortar' : u.type.at(-1);
            const exact = sc.spawns[side].filter((s) => s.who.includes(name));
            assert.ok(exact.length <= 1, `${u.id}: one spawn`);
            assert.ok(spawnTile(g, u.seat, u.type));
        }
        // both sides start with Riflemen on the board
        for (const side of ['us', 'de']) assert.ok(Object.keys(sc.units[side]).some((t) => t[0] === 'R'));
    });
}

test('adjacency: shared stretch of edge, not a corner', () => {
    assert.ok(touches({ x: 1, y: 4 }, { x: 3, y: 3 })); // offset columns
    assert.ok(touches({ x: 2, y: 2 }, { x: 4, y: 2 })); // aligned
    assert.ok(touches({ x: 2, y: 2 }, { x: 1, y: 4 })); // offset rows
    assert.ok(!touches({ x: 1, y: 1 }, { x: 3, y: 3 })); // corner
    const s1 = boardOf(SCENARIOS[0]);
    assert.deepEqual(s1.adj['17B'].sort(), ['12B', '13B', '2B', '7A']);
    assert.equal(s1.dist['17B']['5B'], 2);
    assert.equal(s1.dist['6A']['4B'], 4);
});
