// The external seat (docs/02 §7.4): the companion's player keeps a physical deck and rolls physical dice; the engine
// only knows which cards are in their hand and deck together, and how many in each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/engine/data.js';
import { casualty, casualtyFrom, createState, normalizeSetup } from '../src/engine/state.js';
import { playOptions, playerTurn } from '../src/engine/turn.js';
import { Session, makeRecord, replayRecord, fingerprint } from '../src/engine/session.js';
import { randomBot } from '../src/ai/randomBot.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { planBot } from '../src/ai/planBot.js';
import { cardCount, drive, playOut } from './helpers.js';

const US = 0, DE = 1;
const ext = (scenario = 1, o = {}) => createState(normalizeSetup({ scenario, seed: 'ext', external: US, ...o }));
const types = (cards) => cards.map((c) => c.split(':')[1]).sort();
/** Puts these cards (by type) in the hand and the rest of hand + deck in the deck, as the engine might have them. */
function split(g, seat, hand) {
    const p = g.players[seat];
    const all = [...p.hand, ...p.deck];
    p.hand = [];
    for (const type of hand) p.hand.push(...all.splice(all.findIndex((c) => c.split(':')[1] === type), 1));
    p.deck = all;
}

test('setup: external seat and bot dice only when asked for (old records stay the same)', () => {
    assert.deepEqual(Object.keys(normalizeSetup({ scenario: 1 })).sort(), ['controlRule', 'maxRounds', 'scenario', 'seed']);
    assert.deepEqual(normalizeSetup({ scenario: 1, external: 1 }), { scenario: 1, seed: 'normandy', maxRounds: 60, controlRule: 'normandy', external: 1, botDice: 'virtual' });
    assert.equal(normalizeSetup({ scenario: 1, external: 0, botDice: 'physical' }).botDice, 'physical');
    const s = new Session({ scenario: 2, seed: 'r', external: 1, botDice: 'physical' });
    assert.deepEqual(replayRecord(makeRecord(s)).session.setup, s.setup);
});

test('view: the external hand is unknown, even to itself; its hand and deck are public as counts by type', () => {
    const s = new Session({ scenario: 1, seed: 'v', external: US });
    const v = s.view(US);
    assert.equal(v.external, US);
    assert.equal(v.players[US].hand, null);
    assert.equal(v.players[US].external, true);
    const p = s.state.players[US];
    const n = Object.values(v.players[US].hidden).reduce((a, b) => a + b, 0);
    assert.equal(n, p.hand.length + p.deck.length);
    assert.equal(v.players[US].handCount, 4);
    assert.ok(Array.isArray(s.view(DE).players[DE].hand), 'the bot sees its own hand');
    assert.equal(s.view(DE).players[US].hand, null);
});

test('the bid offers any card the player may hold; the one bid is found even if the engine had it in the deck', () => {
    const s = new Session({ scenario: 1, seed: 'b', external: US });
    const req = s.pending;
    assert.equal(req.kind, 'bid');
    assert.equal(req.seat, US);
    const p = s.state.players[US];
    const pool = new Set(types([...p.hand, ...p.deck]));
    assert.deepEqual(new Set(req.options.map((o) => o.card)), pool);
    const inDeck = p.deck.find((c) => !p.hand.some((h) => h.split(':')[1] === c.split(':')[1]));
    s.act(`bid:${inDeck.split(':')[1]}`);
    assert.equal(p.bid.split(':')[1], inDeck.split(':')[1]);
    assert.ok(p.hand.includes(p.bid), 'the bid is in hand until both are revealed');
});

test('play: offers the cards of hand + deck, never the discard or the supply; counts stay right', () => {
    const g = ext();
    const p = g.players[US];
    split(g, US, ['RA', 'SA', 'FOW']);
    p.deck = p.deck.filter((c) => !c.includes(':PS:'));
    p.discard.push('us:PS:1');
    const cards = new Set(playOptions(g, US).filter((o) => o.card).map((o) => o.card));
    assert.ok(cards.has('RB') && cards.has('SB'), 'cards the engine had in the deck');
    assert.ok(!cards.has('PS'), 'a card in the discard pile');
    // the player holds the RB (the engine thought it was in the deck): it is found, the deck keeps its size
    const deck = p.deck.length;
    drive(playerTurn(g, US), ['act:RB:0', 'end', 'card:', 'card:']);
    assert.equal(p.deck.length, deck);
    assert.ok(p.discard.some((c) => c.includes(':RB:')));
});

test('end of turn with cards left: the player says which go to the discard pile', () => {
    const g = ext();
    split(g, US, ['RA', 'FOW', 'FOW']);
    const asked = drive(playerTurn(g, US), ['act:RA:0', 'end', 'card:FOW', 'card:SB']);
    const left = asked.filter((r) => r.kind === 'leftover');
    assert.equal(left.length, 2);
    assert.equal(left[0].left, 2);
    const p = g.players[US];
    assert.deepEqual(types(p.discard.filter((c) => !c.includes(':RA:'))), ['FOW', 'SB']);
    assert.equal(p.hand.length, 0);
    assert.equal(g.log.findLast((e) => e.k === 'leftover').cards.join(), 'FOW,SB');
});

test('Recon: only with a Fog of War among the cards the player may hold, and another card in hand', () => {
    const g = ext(1);
    const p = g.players[US];
    split(g, US, ['SLA']);
    p.hand.push(...p.supply.splice(p.supply.findIndex((c) => c.includes(':SA:')), 1));
    assert.ok(playOptions(g, US).some((o) => o.action === 'recon'), 'a Fog of War in the deck may be in hand');
    for (const c of [...p.hand, ...p.deck].filter((x) => x.includes(':FOW:'))) {
        const from = p.hand.includes(c) ? p.hand : p.deck;
        p.discard.push(...from.splice(from.indexOf(c), 1));
    }
    assert.ok(!playOptions(g, US).some((o) => o.action === 'recon'));
});

test('dice: the external player says hit or miss for their attacks; the bot rolls its own unless told', () => {
    for (const botDice of ['virtual', 'physical']) {
        const g = ext(1, { botDice });
        g.units['us:RA'].tile = '12B';
        split(g, US, ['RA']);
        const asked = drive(playerTurn(g, US), ['act:RA:1', 'unit:de:RA', 'hit', 'from:']);
        const roll = asked.find((r) => r.kind === 'roll');
        assert.equal(roll.seat, US);
        assert.equal(roll.total, 4 + 1 + 1); // Riflemen on 5B (cover 1), one tile away
        assert.deepEqual(roll.options.map((o) => o.id), ['hit', 'miss']);
        assert.equal(g.log.findLast((e) => e.k === 'attack').dice, null);
        assert.ok(g.log.some((e) => e.k === 'casualty' && e.unit === 'de:RA'));
        // the German bot attacks back
        g.players[DE].hand = ['de:RA:1'];
        g.players[DE].deck = g.players[DE].deck.filter((c) => c !== 'de:RA:1');
        const back = drive(playerTurn(g, DE), ['act:RA:1', 'unit:us:RA', ...(botDice === 'physical' ? ['miss'] : []), 'from:hand', 'end']);
        assert.equal(back.some((r) => r.kind === 'roll'), botDice === 'physical');
        if (botDice === 'physical') assert.equal(back.find((r) => r.kind === 'roll').seat, US);
    }
});

test('casualty: the external player says where the card comes from, among the places the rules allow', () => {
    const g = ext();
    const p = g.players[US];
    const where = () => casualtyFrom(g, 'us:RA');
    split(g, US, ['SA', 'SB']); // a RA in the deck: the player may still have it in hand
    assert.deepEqual(where(), ['hand', 'deck']);
    p.discard.push(...p.supply.splice(p.supply.findIndex((c) => c.includes(':RA:')), 1));
    assert.deepEqual(where(), ['hand', 'discard'], 'with one in the discard pile, never the deck');
    p.play.push(...p.supply.splice(p.supply.findIndex((c) => c.includes(':RA:')), 1));
    assert.deepEqual(where(), ['play'], 'the play area first, as the engine sees it');
    p.supply.push(...p.play.splice(0));
    // "from the hand" when the engine had it in the deck: the deck keeps its size, the hand loses one
    const [hand, deck] = [p.hand.length, p.deck.length];
    casualty(g, 'us:RA', 'hand');
    assert.deepEqual([p.hand.length, p.deck.length], [hand - 1, deck]);
    casualty(g, 'us:RA', 'discard');
    assert.ok(!p.discard.some((c) => c.includes(':RA:')));
    assert.deepEqual(where(), [], 'no more: the counter leaves the board');
});

test('whole games: a random external player against the bots, every card kept, records replay', () => {
    for (const sc of SCENARIOS) {
        for (const [seat, botDice] of [[US, 'virtual'], [DE, 'physical']]) {
            const s = new Session({ scenario: sc.id, seed: `x${sc.id}${seat}`, external: seat, botDice });
            const start = cardCount(s.state);
            const bots = [0, 1].map((k) => (k === seat ? randomBot(`r${sc.id}`) : heuristicBot(`h${sc.id}`)));
            playOut(s, bots, {
                check: (g) => {
                    assert.deepEqual(cardCount(g), start);
                    for (const r of [g.pending].filter(Boolean)) if (['roll', 'casualty', 'leftover'].includes(r.kind)) assert.equal(r.seat, seat);
                },
            });
            assert.ok(s.state.result, `scenario ${sc.id}: the game ends`);
            const r = replayRecord(makeRecord(s));
            assert.ok(r.matches);
            assert.equal(fingerprint(r.session.state), fingerprint(s.state));
        }
    }
});

test('the planning bot plays against an external player', () => {
    const s = new Session({ scenario: 6, seed: 'xp', external: DE });
    const start = cardCount(s.state);
    playOut(s, [planBot('p'), randomBot('r')], { check: (g) => assert.deepEqual(cardCount(g), start) });
    assert.ok(s.state.result);
});
