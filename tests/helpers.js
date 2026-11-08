// Shared test helpers.
import { Session } from '../src/engine/session.js';
import { createState, normalizeSetup } from '../src/engine/state.js';

/** Plays a session to the end with one bot per seat; check(g) runs after every answer. */
export function playOut(session, bots, { check, max = 50000 } = {}) {
    for (let i = 0; !session.over && i < max; i++) {
        const req = session.pending;
        session.act(bots[req.seat](req, session.view(req.seat)));
        if (check) check(session.state);
    }
    return session;
}

/** Cards per player across all zones: never changes during a game. */
export const cardCount = (g) =>
    g.players.map((p) => p.deck.length + p.hand.length + p.discard.length + p.play.length + p.supply.length + p.removed.length);

export const fresh = (scenario = 1, seed = 'rules') => createState(normalizeSetup({ scenario, seed }));
export const newGame = (scenario = 1, seed = 't') => new Session({ scenario, seed });

/** Runs a generator, answering requests in order (ids, id prefixes or functions of the request); returns the requests. */
export function drive(gen, answers) {
    const asked = [];
    let r = gen.next();
    while (!r.done) {
        if (r.value.type === 'beat') {
            r = gen.next();
            continue;
        }
        asked.push(r.value);
        if (!answers.length) throw new Error(`unanswered ${r.value.kind}: ${r.value.options.map((o) => o.id).join(' ')}`);
        let a = answers.shift();
        if (typeof a === 'function') a = a(r.value);
        const o = r.value.options.find((x) => x.id === a) ?? r.value.options.find((x) => x.id.startsWith(a));
        if (!o) throw new Error(`no option "${a}" in ${r.value.kind}: ${r.value.options.map((x) => x.id).join(' ')}`);
        r = gen.next(o.id);
    }
    return asked;
}

/** Gives `seat` exactly these cards in hand (taken from anywhere they are, or made up). */
export function setHand(g, seat, types) {
    const p = g.players[seat];
    p.discard.push(...p.hand.splice(0));
    for (const type of types) {
        let found = null;
        for (const zone of ['discard', 'deck', 'supply']) {
            const i = p[zone].findIndex((c) => c.split(':')[1] === type);
            if (i >= 0) {
                [found] = p[zone].splice(i, 1);
                break;
            }
        }
        p.hand.push(found ?? `${p.side}:${type}:x${p.hand.length}`);
    }
}
