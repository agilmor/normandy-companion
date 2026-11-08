// The round loop (docs/01 §5): draw 4, bid for the initiative, then the initiative player's turn and the other's.

import { choose, log, note, beat } from './ask.js';
import { typeId, typeOf } from './data.js';
import { bring, drawCards, endGame, handPool } from './state.js';
import { playerTurn } from './turn.js';

export { normalizeSetup, createState } from './state.js';

export function* run(g) {
    for (;;) {
        g.round++;
        if (g.round > g.setup.maxRounds) endGame(g, null, 'limit'); // [D-33] safety net for bots, not a rule
        log(g, 'round', { round: g.round });
        g.phase = 'draw';
        for (const seat of [0, 1]) drawCards(g, seat, 4);
        g.phase = 'bid';
        yield* bid(g);
        g.phase = 'turns';
        const first = g.initiative;
        yield* playerTurn(g, first);
        yield* playerTurn(g, 1 - first);
        g.turn = null;
    }
}

/** Both choose a card in secret; the higher initiative takes the marker, a tie keeps it where it is ([D-16]). */
function* bid(g) {
    for (const seat of [0, 1]) {
        const p = g.players[seat];
        if (!p.hand.length) continue;
        const types = [...new Map(handPool(g, seat).map((c) => [typeId(c), c])).values()];
        const answer = yield* choose(g, seat, 'bid', types.map((c) => ({ id: `bid:${typeId(c)}`, card: typeId(c), initiative: typeOf(c).initiative })));
        p.bid = bring(g, seat, (c) => typeId(c) === answer.slice(4));
        note(g, seat, 'bid', { card: typeId(p.bid) });
    }
    const [a, b] = g.players.map((p) => (p.bid ? typeOf(p.bid).initiative : 0));
    const before = g.initiative;
    if (a !== b) g.initiative = a > b ? 0 : 1;
    log(g, 'bids', { cards: g.players.map((p) => p.bid && typeId(p.bid)), initiative: g.initiative, kept: a === b });
    yield* beat(g, 'bids', { initiative: g.initiative, changed: before !== g.initiative });
    for (const p of g.players) {
        if (!p.bid) continue;
        p.hand.splice(p.hand.indexOf(p.bid), 1);
        p.discard.push(p.bid);
        p.bid = null;
    }
}
