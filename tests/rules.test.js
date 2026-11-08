// Rules with forced positions. Scenario 1's board (columns shifted half a tile):
//   x=1: 2B 16B 6A   x=3: 17B 13B 3B   x=5: 7A 12B 8A   x=7: 4B 5B 11B
// US start on 17B, Germans on 5B (two tiles apart, through 12B). Each test builds a state, moves pieces where it
// needs them and drives the turn generator with scripted answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEnd } from '../src/engine/ask.js';
import { coverOf } from '../src/engine/data.js';
import { casualty, checkWin, createState, normalizeSetup, points, pinned, hopeless } from '../src/engine/state.js';
import { Session, makeRecord, replayRecord } from '../src/engine/session.js';
import { attackTargets, playOptions, playerTurn } from '../src/engine/turn.js';
import { drive, fresh, setHand } from './helpers.js';

const US = 0, DE = 1;
const fog = (p) => [...p.supply, ...p.discard].filter((c) => c.includes(':FOW:'));
const turn = (g, seat, answers) => drive(playerTurn(g, seat), answers);
const winner = (g) => {
    try {
        checkWin(g, US);
    } catch (e) {
        if (e instanceof GameEnd) return g.result;
        throw e;
    }
    return null;
};

test('attack: base defence + cover + range (rulebook p17 example: 4 + 3 + 1)', () => {
    const g = fresh();
    g.units['de:RA'].tile = '17B'; // cover 3
    g.units['us:RA'].tile = '13B';
    const t = attackTargets(g, US, 'us:RA', { a: 'attack', v: 1 }).find((x) => x.unit === 'de:RA');
    assert.deepEqual([t.defence, t.cover, t.range, t.total], [4, 3, 1, 8]);
    const t2 = attackTargets(g, DE, 'de:SA', { a: 'attack', v: 1 }).find((x) => x.unit === 'us:SA');
    assert.equal(t2.total, 5 + 3 + 2); // Scouts on 17B from 5B
});

test('hills: 3 against most attacks, 1 from another hill or against a Blast', () => {
    assert.equal(coverOf('16A'), 3);
    assert.equal(coverOf('16A', { fromTile: '1B' }), 3);
    assert.equal(coverOf('16A', { fromTile: '2A' }), 1);
    assert.equal(coverOf('16A', { fromTile: '16A' }), 1);
    assert.equal(coverOf('16A', { blast: true }), 1);
    assert.equal(coverOf('17B', { blast: true }), 3);
});

test('casualties: hand, then discard, then deck, then the counter', () => {
    const g = fresh();
    const p = g.players[DE];
    p.deck = p.deck.filter((c) => !c.includes(':RA:'));
    p.discard = ['de:RA:7'];
    p.hand = ['de:RA:8', 'de:PS:1'];
    casualty(g, 'de:RA');
    assert.deepEqual(p.hand, ['de:PS:1']);
    casualty(g, 'de:RA');
    assert.deepEqual(p.discard, []);
    p.deck.push('de:RA:9');
    casualty(g, 'de:RA');
    assert.ok(!p.deck.includes('de:RA:9'));
    assert.equal(g.units['de:RA'].tile, '5B');
    casualty(g, 'de:RA');
    assert.equal(g.units['de:RA'].tile, null);
    assert.equal(p.removed.length, 3);
});

test('Move only onto tiles with your marker; Scout scouts and takes Fog of War', () => {
    const g = fresh();
    setHand(g, US, ['RA', 'SA']);
    // 2B is the only scouted neighbour of 17B, so the step answers itself
    const asked = turn(g, US, ['act:RA:0', 'end']);
    assert.ok(!asked.some((r) => r.kind === 'move'));
    assert.equal(g.units['us:RA'].tile, '2B');
    const before = fog(g.players[US]).filter((c) => g.players[US].supply.includes(c)).length;
    setHand(g, US, ['SA']);
    turn(g, US, ['act:SA:0', 'tile:12B', 'tile:5B', 'end']);
    assert.equal(g.units['us:SA'].tile, '5B');
    assert.equal(g.control['12B'].us, 'scouted');
    assert.equal(g.control['5B'].us, 'scouted');
    assert.equal(g.control['5B'].de, 'controlled');
    assert.equal(g.players[US].supply.filter((c) => c.includes(':FOW:')).length, before - 2);
});

test('Control: not with an enemy on the tile; flips the enemy marker back to scouted', () => {
    const g = fresh();
    g.units['us:RA'].tile = '5B';
    g.control['5B'].us = 'scouted';
    setHand(g, US, ['RA']);
    assert.ok(!playOptions(g, US).some((o) => o.action === 'control'));
    for (const u of ['de:RA', 'de:RB', 'de:SA', 'de:SB']) g.units[u].tile = '11B';
    turn(g, US, ['act:RA:2', 'end']);
    assert.deepEqual(g.control['5B'], { us: 'controlled', de: 'scouted' });
    assert.equal(points(g, US), 3);
    assert.equal(points(g, DE), 0);
});

test('North Africa control rule: enemies stop Control only on a tile the enemy controls', () => {
    const g = createState(normalizeSetup({ scenario: 1, seed: 'rules', controlRule: 'northAfrica' }));
    g.units['us:RA'].tile = '5B'; // the Germans control 5B and stand on it
    g.control['5B'].us = 'scouted';
    setHand(g, US, ['RA']);
    assert.ok(!playOptions(g, US).some((o) => o.action === 'control'));
    g.control['5B'].de = 'scouted';
    turn(g, US, ['act:RA:2', 'end']);
    assert.deepEqual(g.control['5B'], { us: 'controlled', de: 'scouted' });
    assert.ok(g.units['de:RA'].tile === '5B');
});

test('The control rule defaults to Normandy and survives a game code', () => {
    assert.equal(normalizeSetup({ scenario: 1 }).controlRule, 'normandy');
    assert.equal(normalizeSetup({ scenario: 1, controlRule: 'other' }).controlRule, 'normandy');
    const s = new Session({ scenario: 1, seed: 'na', controlRule: 'northAfrica' });
    assert.equal(replayRecord(makeRecord(s)).session.state.setup.controlRule, 'northAfrica');
});

test('Suppress, then the card only rallies the unit', () => {
    const g = fresh(2);
    g.units['de:MA'].tile = '15B';
    setHand(g, DE, ['MA']);
    g.rng = 1;
    let hit = false;
    for (let seed = 1; !hit && seed < 50; seed++) {
        g.rng = seed;
        g.units['us:RA'].suppressed = false;
        setHand(g, DE, ['MA']);
        turn(g, DE, ['act:MA:2', 'unit:us:RA', 'end']);
        hit = g.units['us:RA'].suppressed;
    }
    assert.ok(hit);
    setHand(g, US, ['RA']);
    const opts = playOptions(g, US).map((o) => o.id);
    assert.deepEqual(opts, ['rally:RA', 'hunker:RA', 'end']);
    turn(g, US, ['rally:RA', 'end']);
    assert.equal(g.units['us:RA'].suppressed, false);
    assert.equal(g.units['us:RA'].tile, '15B');
});

test('a card whose counter is off the board places it on its spawn tile first', () => {
    const g = fresh(5); // US Sniper spawns on 1A with squad B
    setHand(g, US, ['SN']);
    turn(g, US, ['act:SN:0', 'stop', 'end']);
    assert.equal(g.units['us:SN'].tile, '1A');
});

test('Blast hits every counter on the target tile, your own too; moving the Mortar drops the target', () => {
    const g = fresh(5); // German Mortar on 2B
    g.targets[DE] = '7A';
    g.units['us:RA'].tile = '7A';
    g.units['de:RA'].tile = '7A';
    setHand(g, DE, ['MO']);
    const asked = [];
    drive(playerTurn(g, DE), ['act:MO:1', 'end']);
    const attacked = g.log.filter((e) => e.k === 'attack' && e.kind === 'blast').map((e) => e.target);
    assert.deepEqual(attacked.sort(), ['de:RA', 'us:RA']);
    assert.ok(g.log.filter((e) => e.k === 'attack' && e.kind === 'blast').every((e) => e.total === 4 + 2 && e.range === 0));
    setHand(g, DE, ['MO']);
    turn(g, DE, ['act:MO:0', 'tile:', 'end']);
    assert.equal(g.targets[DE], null);
    assert.equal(asked.length, 0);
});

test('Target: three or more tiles from the Mortar', () => {
    const g = fresh(5);
    setHand(g, DE, ['MO']);
    const [, req] = turn(g, DE, ['act:MO:2', (r) => r.options[0].id, 'end']);
    assert.ok(req.options.length > 0);
    assert.ok(!req.options.some((o) => ['2B', '4A', '6A', '7A', '8B', '16B'].includes(o.tile)));
});

test('Inspire returns a played card of its squad, never itself', () => {
    const g = fresh();
    setHand(g, US, ['RA', 'SLA']);
    const asked = turn(g, US, ['act:RA:1', 'unit:de:RA', 'act:SLA:1', 'end']);
    const play = asked.find((r) => r.kind === 'play' && r.options.some((o) => o.id === 'act:SLA:1'));
    assert.ok(play);
    assert.ok(g.players[US].discard.some((c) => c.includes(':SLA:')));
    assert.ok(g.players[US].discard.some((c) => c.includes(':RA:')));
    assert.ok(g.log.some((e) => e.k === 'inspire' && e.card === 'RA'));
});

test('Bolster takes from the supply (of its squad), never Fog of War', () => {
    const g = fresh();
    setHand(g, US, ['SLA']);
    const asked = turn(g, US, ['act:SLA:0', 'take:RA', 'take:SA', 'end']);
    const req = asked.find((r) => r.kind === 'bolster');
    assert.deepEqual(req.options.map((o) => o.id).sort(), ['take:RA', 'take:SA']);
    assert.equal(g.players[US].supply.filter((c) => c.includes(':RA:')).length, 3);
});

test('Recon removes a Fog of War from hand and draws', () => {
    const g = fresh();
    setHand(g, US, ['SA', 'FOW']);
    turn(g, US, ['act:SA:2', 'end']);
    assert.equal(g.players[US].removed.filter((c) => c.includes(':FOW:')).length, 1);
});

test('hunker down returns the card to the supply; Fog of War cannot be played', () => {
    const g = fresh();
    setHand(g, US, ['RA', 'FOW']);
    assert.ok(!playOptions(g, US).some((o) => o.card === 'FOW'));
    turn(g, US, ['hunker:RA', 'end']);
    assert.equal(g.players[US].supply.filter((c) => c.includes(':RA:')).length, 5);
    assert.ok(g.players[US].discard.some((c) => c.includes(':FOW:')));
});

test('victory: points reached', () => {
    const g = fresh();
    for (const t of ['2B', '16B', '6A']) g.control[t].us = 'controlled'; // 1 + 1 + 2
    assert.equal(winner(g), null);
    g.control['7A'].us = 'controlled';
    assert.deepEqual(winner(g), { winner: US, how: 'points', points: [5, 3] });
});

test('victory: pin, both pinned, beyond all hope', () => {
    let g = fresh(2); // Germans must pin the US
    g.units['us:RA'].tile = g.units['us:RB'].tile = null;
    assert.ok(pinned(g, US));
    assert.equal(winner(g).winner, DE);
    assert.equal(winner(g).how, 'pin');

    g = fresh(1); // both play for points: nobody wins until both are pinned
    g.units['us:RA'].tile = g.units['us:RB'].tile = null;
    assert.equal(winner(g), null);
    g.units['de:RA'].tile = g.units['de:RB'].tile = null;
    assert.deepEqual(winner(g), { winner: DE, how: 'bothPinned', points: [0, 3] });

    g = fresh(1);
    g.units['us:RA'].tile = g.units['us:RB'].tile = null;
    for (const p of [g.players[US]]) for (const z of ['deck', 'hand', 'discard', 'supply']) p[z] = p[z].filter((c) => !/:R[ABC]:/.test(c));
    assert.ok(hopeless(g, US));
    assert.deepEqual(winner(g), { winner: DE, how: 'hopeless', points: [0, 3] });
});

test('scenario 10 radio: Control on the US-held radio tile adds a point', () => {
    const g = fresh(10);
    g.units['us:RA'].tile = '6B';
    setHand(g, US, ['RA', 'RA']);
    turn(g, US, ['act:RA:2', 'act:RA:2', 'end']);
    assert.equal(g.objectives['6B'], 2);
    assert.equal(points(g, US), 2);
});

// Rulings from the BGG rules forum (docs/01 §13).

test('friendly fire: the card in your own play area goes first (Reinforcements ruling, 2350232/2988441)', () => {
    const g = fresh(5);
    g.targets[DE] = '7A';
    g.units['de:RA'].tile = '7A';
    const p = g.players[DE];
    setHand(g, DE, ['RA', 'MO']);
    for (let seed = 1; seed < 200; seed++) {
        const t = structuredClone(g);
        t.rng = seed;
        turn(t, DE, ['act:RA:1', 'unit:', 'act:MO:1', 'end']);
        const hit = t.log.find((e) => e.k === 'attack' && e.kind === 'blast' && e.target === 'de:RA' && e.hit);
        if (!hit) continue;
        const cas = t.log.find((e) => e.k === 'casualty' && e.unit === 'de:RA');
        assert.equal(cas.from, 'play');
        assert.ok(t.players[DE].removed.some((c) => c.includes(':RA:')));
        return;
    }
    assert.fail('no seed hit the Riflemen');
});

test('beyond all hope: no Rifleman cards left, even with the counter still on the board (2460056, 2377770)', () => {
    const g = fresh(1);
    const p = g.players[US];
    for (const z of ['deck', 'hand', 'discard', 'supply']) p[z] = p[z].filter((c) => !/:R[ABC]:/.test(c));
    assert.ok(g.units['us:RA'].tile);
    assert.ok(hopeless(g, US));
    assert.deepEqual(winner(g), { winner: DE, how: 'hopeless', points: [0, 3] });
});

test('the Mortar target stays when the Mortar is eliminated; Blast brings it back first (3477261)', () => {
    const g = fresh(5);
    g.targets[DE] = '7A';
    const p = g.players[DE];
    for (const z of ['deck', 'hand', 'discard']) p[z] = p[z].filter((c) => !c.includes(':MO:'));
    casualty(g, 'de:MO');
    assert.equal(g.units['de:MO'].tile, null);
    assert.equal(g.targets[DE], '7A');
    setHand(g, DE, ['MO']);
    assert.ok(playOptions(g, DE).some((o) => o.id === 'act:MO:1'));
    turn(g, DE, ['act:MO:1', 'end']);
    assert.equal(g.units['de:MO'].tile, '2B');
});

test('radio: Germans on the tile do not stop the US radio action (2803862)', () => {
    const g = fresh(10);
    g.units['us:RA'].tile = '6B';
    g.control['6B'].us = 'controlled';
    g.units['de:RA'].tile = '6B';
    setHand(g, US, ['RA']);
    turn(g, US, ['act:RA:2', 'end']);
    assert.equal(g.objectives['6B'], 2);
});

test('Command draws the top X cards (2994836)', () => {
    const g = fresh();
    setHand(g, US, ['PS']);
    const before = g.players[US].deck.length;
    const asked = turn(g, US, ['act:PS:1', 'end']);
    assert.ok(!asked.some((r) => r.kind === 'command'));
    assert.equal(g.players[US].deck.length, before - 2);
});
