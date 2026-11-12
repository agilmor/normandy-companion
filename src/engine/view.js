// What one seat may see (docs/01 §9): its own hand and removed cards, deck order hidden, the opponent's hand and
// deck only as counts, bids hidden until revealed. Bots and the UI only ever get this.

import { typeId } from './data.js';
import { hopeless, isExternal } from './state.js';

/** Cards per type: { RA: 2, FOW: 1 }. */
const countTypes = (cards) => {
    const n = {};
    for (const c of cards) n[typeId(c)] = (n[typeId(c)] ?? 0) + 1;
    return n;
};

export function view(g, seat) {
    const players = g.players.map((p, s) => ({
        side: p.side,
        // an external seat (the companion's player, docs/02 §7.4): the engine does not know its hand, only which
        // cards are in its hand and deck together (public: everything else is on the table)
        external: isExternal(g, s),
        hidden: isExternal(g, s) ? countTypes([...p.hand, ...p.deck]) : null,
        hand: s === seat && !isExternal(g, s) ? [...p.hand] : null,
        handCount: p.hand.length,
        deckCount: p.deck.length,
        discard: [...p.discard],
        play: [...p.play],
        supply: [...p.supply],
        removedCount: p.removed.length,
        removed: s === seat ? [...p.removed] : null,
        bidding: p.bid != null,
        bid: s === seat && !isExternal(g, s) ? p.bid : null,
    }));
    return {
        seat,
        scenario: g.scenario,
        controlRule: g.setup.controlRule,
        variant: g.setup.variant ?? null,
        external: g.setup.external ?? null,
        botDice: g.setup.botDice ?? null,
        round: g.round,
        turn: g.turn,
        phase: g.phase,
        initiative: g.initiative,
        players,
        units: structuredClone(g.units),
        control: structuredClone(g.control),
        objectives: { ...g.objectives },
        targets: [...g.targets],
        hopeless: [hopeless(g, 0), hopeless(g, 1)], // [D-14] no Rifleman cards left (public: casualties are announced)
        log: g.log,
        notes: g.notes[seat],
        result: g.result,
    };
}
