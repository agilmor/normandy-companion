// Whole games between random bots in every scenario: no card is created or lost, counters stay on the board's
// tiles, the hidden information stays hidden, and a record replays to the same state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/engine/data.js';
import { boardOf } from '../src/engine/board.js';
import { Session, makeRecord, encodeRecord, decodeRecord, replayRecord, fingerprint } from '../src/engine/session.js';
import { randomBot } from '../src/ai/randomBot.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { planBot, determinize } from '../src/ai/planBot.js';
import { cardCount, playOut } from './helpers.js';

const GAMES = Number(process.env.SIM_GAMES ?? 4);

for (const sc of SCENARIOS) {
    test(`scenario ${sc.id}: ${GAMES} games keep every card and counter in place`, () => {
        const tiles = new Set(boardOf(sc).ids);
        for (let i = 0; i < GAMES; i++) {
            const s = new Session({ scenario: sc.id, seed: `sim${i}` });
            const start = cardCount(s.state);
            const kinds = i % 2 ? [randomBot, heuristicBot] : [heuristicBot, randomBot];
            playOut(s, kinds.map((b, k) => b(`b${i}${k}`)), {
                check: (g) => {
                    assert.deepEqual(cardCount(g), start);
                    for (const u of Object.values(g.units)) assert.ok(u.tile === null || tiles.has(u.tile));
                    for (const t of Object.values(g.control)) assert.ok(!(t.us === 'controlled' && t.de === 'controlled'));
                },
            });
            assert.ok(s.state.result, 'the game ends');
        }
    });
}

test('view: the opponent hand, deck order and bid stay hidden', () => {
    const s = new Session({ scenario: 7, seed: 'v' });
    const v = s.view(0);
    assert.equal(v.players[1].hand, null);
    assert.equal(v.players[1].removed, null);
    assert.ok(Array.isArray(v.players[0].hand));
    assert.ok(!('deck' in v.players[0]));
    assert.ok(v.notes.every((n) => s.state.notes[0].includes(n)));
});

test('records replay to the same state', async () => {
    const s = new Session({ scenario: 3, seed: 'rec' });
    playOut(s, [heuristicBot('a'), randomBot('b')], { max: 300 });
    const code = await encodeRecord(makeRecord(s));
    assert.ok(code.startsWith('UNN1.'));
    const { session, matches, failedAt } = replayRecord(await decodeRecord(code));
    assert.equal(failedAt, null);
    assert.ok(matches);
    assert.equal(fingerprint(session.state), fingerprint(s.state));
});

test('planning bot: whole games against the heuristic one, keeping every card', () => {
    for (const id of [2, 6, 10]) {
        const s = new Session({ scenario: id, seed: `plan${id}` });
        const start = cardCount(s.state);
        playOut(s, [planBot('p0'), heuristicBot('h1')], { check: (g) => assert.deepEqual(cardCount(g), start) });
        assert.ok(s.state.result, 'the game ends');
    }
});

test('planning bot: the state it rebuilds from its view has the same cards in each pile', () => {
    const s = new Session({ scenario: 7, seed: 'det' });
    playOut(s, [heuristicBot('a'), heuristicBot('b')], { max: 120 });
    for (const seat of [0, 1]) {
        const d = determinize(s.view(seat), seat);
        for (const [i, p] of s.state.players.entries()) {
            const q = d.players[i];
            const same = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());
            for (const k of ['discard', 'play', 'supply']) same(q[k], p[k]);
            if (i === seat) for (const k of ['hand', 'deck', 'removed']) same(q[k], p[k]);
            else {
                assert.equal(q.hand.length, p.hand.length);
                const types = (cards) => cards.map((c) => c.split(':')[1]).sort();
                assert.deepEqual(types([...q.hand, ...q.deck]), types([...p.hand, ...p.deck]), 'the enemy hidden cards, by type');
            }
        }
    }
});
