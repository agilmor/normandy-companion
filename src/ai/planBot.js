// Planning bot (docs/02 §5.3): plans its whole turn instead of one card at a time. At each "play a card" decision
// it rebuilds a full game state from its view (its own deck from what it can count, the enemy's hidden cards from
// the public log), tries the orders of its hand on copies of that state with the engine itself (playerTurn), and
// keeps the line whose end-of-turn position is best. So it sees what only works together: Move + Guide + Control in
// one turn, scouting before advancing, a Rally that frees a card for later.
//
// Dice and draws are not simulated: an Attack, Suppress, Blast, Command or Recon is played "on paper" (the card goes
// to the play area, the unit comes in if it was off the board) and counts what the heuristic bot thinks it is worth.
// Everything else (moves, scouting, Control, Bolster, Inspire, Guide, aiming the mortar) runs through the real rules.
//
// The position is judged by the heuristic bot's own measures (points, where each unit stands, the cards it owns),
// less the risk to Riflemen standing under fire, but not when the enemy wins by pinning: that side's one way to win
// is to get there fast (docs/02 §5.2). Sub-decisions follow the plan; anything it did not plan (an Attack's target,
// the bid) is left to the heuristic bot.

import { GameEnd } from '../engine/ask.js';
import { SIDES, TYPES, scenarioById, typeId, typeOf, unitOfCard, unitType } from '../engine/data.js';
import { seedFrom } from '../engine/rng.js';
import { points, spawn, spawnTile } from '../engine/state.js';
import { playerTurn } from '../engine/turn.js';
import { view as viewOf } from '../engine/view.js';
import { bolsterOf, context, exposure, heuristicBot, kindOf, placeWeight, scorePlay, tileValue } from './heuristicBot.js';

/** Actions whose result depends on dice or draws: played on paper, valued by the heuristic. */
const CHANCE = new Set(['attack', 'suppress', 'blast', 'command', 'recon']);
/** How many lines one plan may follow to the end of the turn. */
const BUDGET = 150;

/** Every card id of a side in this scenario (as createState numbers them). */
function allCards(sc, side) {
    const out = [];
    const n = {};
    for (const where of ['deck', 'supply']) {
        for (const [type, count] of Object.entries(sc.cards[side][where])) {
            for (let i = 0; i < count; i++) out.push(`${side}:${type}:${(n[type] = (n[type] ?? 0) + 1)}`);
        }
    }
    return out;
}

/** Card types `seat` has lost for good, from the public log: casualties and the Fog of War removed by Recon. */
function removedTypes(log, seat) {
    const out = [];
    for (const e of log) {
        if (e.k === 'casualty' && e.seat === seat) out.push(unitType(e.unit));
        else if (e.k === 'recon' && e.seat === seat) out.push('FOW');
    }
    return out;
}

/**
 * A full game state built from what `seat` can see. Its own deck is exact (all its cards but the ones it sees); the
 * enemy's hand and deck are its remaining cards in some order, which a turn of planning never looks at.
 */
export function determinize(view, seat) {
    const sc = scenarioById(view.scenario);
    const g = {
        setup: { scenario: sc.id, seed: 'plan', maxRounds: 999, controlRule: view.controlRule },
        scenario: sc.id,
        rng: seedFrom('plan'),
        round: view.round,
        turn: seat,
        phase: 'turns',
        initiative: view.initiative,
        players: [],
        units: structuredClone(view.units),
        control: structuredClone(view.control),
        objectives: { ...view.objectives },
        targets: [...view.targets],
        log: [],
        notes: [[], []],
        result: null,
        pending: null,
    };
    for (const s of [0, 1]) {
        const vp = view.players[s];
        const seen = new Set([...vp.discard, ...vp.play, ...vp.supply, ...(vp.hand ?? []), ...(vp.removed ?? [])]);
        const hidden = allCards(sc, SIDES[s]).filter((c) => !seen.has(c));
        const removed = vp.removed ? [...vp.removed] : [];
        if (!vp.removed) {
            for (const type of removedTypes(view.log, s)) {
                const i = hidden.findIndex((c) => typeId(c) === type);
                if (i >= 0) removed.push(...hidden.splice(i, 1));
            }
        }
        const hand = vp.hand ? [...vp.hand] : hidden.splice(0, vp.handCount);
        g.players.push({ side: SIDES[s], deck: hidden, hand, discard: [...vp.discard], play: [...vp.play], supply: [...vp.supply], removed, bid: null });
    }
    return g;
}

/** A chance action played on paper: the card to the play area, its unit onto the board if it was off it. */
function onPaper(g, seat, o) {
    const p = g.players[seat];
    const cid = p.hand.find((c) => typeId(c) === o.card);
    p.hand.splice(p.hand.indexOf(cid), 1);
    p.play.push(cid);
    const uid = unitOfCard(cid);
    if (uid && !g.units[uid].tile) spawn(g, uid);
    if (o.action === 'recon') {
        const i = p.hand.findIndex((c) => typeOf(c).fog);
        if (i >= 0) p.removed.push(...p.hand.splice(i, 1));
    }
}

const skipBeats = (gen, r) => {
    while (!r.done && r.value.type === 'beat') r = gen.next();
    return r;
};

/**
 * Plays `line` from the start of the plan on a copy of `g0`: strings answer the engine's requests, { option, value }
 * entries are chance actions played on paper. Returns the state, the next request (null once the turn is over),
 * the value of the chance actions, or `over` if the game ended.
 */
function replay(g0, seat, line) {
    const g = structuredClone(g0);
    let bonus = 0;
    try {
        let gen = playerTurn(g, seat);
        let r = skipBeats(gen, gen.next());
        for (const a of line) {
            if (typeof a === 'string') r = skipBeats(gen, gen.next(a));
            else {
                onPaper(g, seat, a.option);
                bonus += a.value;
                gen = playerTurn(g, seat);
                r = skipBeats(gen, gen.next());
            }
        }
        return { g, req: r.done ? null : r.value, bonus };
    } catch (e) {
        if (e instanceof GameEnd) return { g, over: true, bonus };
        throw e;
    }
}

/**
 * Weights of `evaluate`. `holdWin`/`holdFar`: an objective that would win the game for the enemy is worth holding
 * that many times more, against enemy Riflemen up to that far (a Rifleman with Inspire and Guide covers 4 or 5 tiles
 * in two turns; only for a side that wins by pinning, which has nothing else to do with an objective). `enemyFog`:
 * each Fog of War in the enemy's deck, hand and discard pile (what Conceal gives them; without it Conceal looked like a wasted card).
 * `exposure` does not apply when the enemy wins by pinning: heavier there (30), as losing Riflemen loses the game, it
 * kept US back in scenario 6, where it needs one Control 5 tiles away (docs/02 §5.2).
 */
export const WEIGHTS = { points: 130, exposure: 12, enemyFog: 8, goalMarker: 20, hold: 70, holdWin: 5, holdFar: 5 };

/** Every card a player still owns, wherever it is. */
const owned = (p) => [...p.deck, ...p.hand, ...p.discard, ...p.play];

/**
 * Holding: with the Normandy rule a counter of ours on an objective we control stops the enemy taking it, so it is
 * worth its value times how close the enemy Riflemen are (one counter is enough; North Africa: no blocking).
 */
function holdValue(g, seat, cx) {
    if (g.setup.controlRule === 'northAfrica') return 0;
    const w = WEIGHTS;
    const rifles = cx.foes.filter((f) => kindOf(f.id) === 'R');
    const need = cx.sc.win[cx.them].points;
    const theirs = points(g, 1 - seat);
    let v = 0;
    for (const [t, val] of Object.entries(g.objectives)) {
        if (!val || g.control[t][cx.me] !== 'controlled' || !cx.mine.some((u) => u.tile === t)) continue;
        const near = Math.min(9, ...rifles.map((f) => cx.d(f.tile, t)));
        const wins = !cx.sc.win[cx.me].points && Boolean(need) && theirs + val >= need; // only when holding off is all we do
        if (wins && near <= w.holdFar) v += w.hold * val * w.holdWin / (1 + near / 2);
        else if (near <= 2) v += w.hold * val / (1 + near);
    }
    return v;
}

/**
 * How good the position is for `seat` at the end of its turn, in the heuristic bot's units (so a planned line and a
 * chance action on paper compare): points held, where each unit stands, Riflemen in the open, the cards it owns.
 */
function evaluate(g, seat, goals = null) {
    const w = WEIGHTS;
    const cx = context(viewOf(g, seat), seat);
    // units are placed against the objectives as they were when the turn began: taking one this turn must not make
    // the Rifleman standing on it worth less than before (the points already count it)
    if (goals) cx.goals = goals;
    let v = w.points * (points(g, seat) - points(g, 1 - seat));
    const pinned = Boolean(cx.sc.win[cx.them].pin); // losing every Rifleman on the board loses the game
    const p = g.players[seat];
    const live = new Set(owned(p).map(unitOfCard));
    for (const u of Object.values(g.units)) {
        if (u.seat !== seat || u.tile || !live.has(u.id)) continue;
        // off the board but with cards to bring it in: as good as standing on its spawn tile, less a card to enter
        // (else a unit far from the objectives would be worth more off the board than on it)
        v += (tileValue(cx, u.id, spawnTile(g, seat, u.type)) - 10) * placeWeight(u.id);
    }
    for (const u of cx.mine) {
        const k = kindOf(u.id);
        v += tileValue(cx, u.id, u.tile) * placeWeight(u.id);
        if (u.suppressed) v -= k === 'R' ? 40 : 20;
        if (k === 'R' && !pinned) v -= exposure(cx, u.id, u.tile) * w.exposure;
    }
    for (const c of owned(p)) {
        const t = typeOf(c);
        v += t.fog ? -5 : 2.5 * (bolsterOf(cx, t.kind) ?? 1);
    }
    v += w.enemyFog * owned(g.players[1 - seat]).filter((c) => typeOf(c).fog).length;
    // markers: each one opens the way; one on an objective not yet held is where a Rifleman can go and Control
    for (const t of Object.keys(g.control)) {
        if (!g.control[t][cx.me]) continue;
        v += 6;
        if (g.objectives[t] && g.control[t][cx.me] !== 'controlled') v += w.goalMarker * cx.worth(t) * cx.reach(t);
    }
    return v + holdValue(g, seat, cx);
}

/** The answers worth trying for a request met while planning, best first by the heuristic's own measure. */
function children(g, seat, req, pick) {
    const cx = context(viewOf(g, seat), seat);
    switch (req.kind) {
        case 'play':
            return req.options
                .map((o) => {
                    if (o.id === 'end') return { a: 'end', s: 0 };
                    const s = scorePlay(cx, o);
                    return { a: CHANCE.has(o.action) ? { option: o, value: s } : o.id, s };
                })
                .sort((x, y) => y.s - x.s)
                .map((x) => x.a);
        case 'move': {
            const unit = req.unit;
            const ranked = req.options.filter((o) => o.id !== 'stop').map((o) => ({ id: o.id, s: tileValue(cx, unit, o.tile) })).sort((x, y) => y.s - x.s);
            const out = ranked.slice(0, 3).map((x) => x.id);
            if (req.options.some((o) => o.id === 'stop')) out.push('stop');
            return out;
        }
        case 'guide':
            return req.options.filter((o) => kindOf(o.unit) === 'R').map((o) => o.id).concat(req.options.filter((o) => kindOf(o.unit) !== 'R').map((o) => o.id)).slice(0, 3);
        case 'bolster':
        case 'inspire': {
            const ranked = req.options.filter((o) => o.id !== 'done').map((o) => ({ id: o.id, s: bolsterOf(cx, TYPES[o.card].kind) ?? 1 })).sort((x, y) => y.s - x.s);
            return ranked.slice(0, 2).map((x) => x.id);
        }
        default:
            return [pick(req)];
    }
}

/** The best line for `seat` from its current "play a card" decision (`onLine` sees every line tried, for tools). */
export function plan(view, seat, pick, onLine = null) {
    const g0 = determinize(view, seat);
    const goals = context(view, seat).goals;
    let best = { score: -Infinity, line: ['end'] };
    // the budget is shared out among the answers at each step, so every first card gets looked at; with one line
    // left, the rest of the turn is played greedily (the heuristic's first choice at each step)
    const visit = (line, budget) => {
        const r = replay(g0, seat, line);
        let score;
        if (r.over) score = r.g.result.winner === seat ? 1e6 : -1e6;
        else if (!r.req) score = evaluate(r.g, seat, goals) + r.bonus;
        if (score !== undefined) {
            onLine?.(score, line);
            if (score > best.score) best = { score, line };
            return;
        }
        if (r.req.seat !== seat) return; // cannot happen within one's own turn
        const kids = children(r.g, seat, r.req, (req) => pick(req, viewOf(r.g, seat)));
        const tried = kids.slice(0, Math.max(1, Math.min(kids.length, budget)));
        const share = Math.max(1, Math.floor(budget / tried.length));
        for (const a of tried) visit([...line, a], share);
    };
    visit([], BUDGET);
    return best.line;
}

export function planBot(seed) {
    const heuristic = heuristicBot(seed);
    let line = [];
    return (req, view) => {
        if (req.kind === 'play') {
            line = plan(view, req.seat, heuristic);
            const a = line.shift() ?? 'end';
            return typeof a === 'string' ? a : a.option.id;
        }
        // the rest of a planned card (its steps, the unit it guides, what it bolsters); else the heuristic
        if (typeof line[0] === 'string' && req.options.some((o) => o.id === line[0])) return line.shift();
        line = [];
        return heuristic(req, view);
    };
}
