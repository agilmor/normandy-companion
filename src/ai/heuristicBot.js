// Heuristic bot (docs/02 §6): greedy, one card at a time, seeing only its view. Riflemen walk the scouted tiles
// towards the objectives it does not hold and take them; Scouts open the way; fire goes where the chance of a hit
// times the value of the target is highest; Bolster brings in Riflemen first. It bids its least useful card.

import { boardOf } from '../engine/board.js';
import { SIDES, TYPES, coverOf, tileCover, defenceOf, hitChance, scenarioById, typeId, typeOf, unitKind, unitType } from '../engine/data.js';
import { nextRandom, seedFrom } from '../engine/rng.js';
import { paradropOdds, paradropSide } from '../engine/state.js';

/** Usefulness of a card in hand, for bidding the least useful one. */
const KEEP = { PS: 9, R: 8, S: 6, M: 6, SN: 6, SL: 5, PG: 5, MO: 4, FOW: 0 };
/** Value of hitting an enemy unit. */
const WORTH = { R: 60, S: 30, M: 38, SN: 40, MO: 35 };
const BOLSTER = { R: 10, S: 7, M: 6, SN: 5, MO: 3, SL: 4, PG: 2, PS: 8 };
/** The same when this side wins by pinning: it needs firepower (Suppress 4, Attack 3), not Riflemen to Control. */
const BOLSTER_PIN = { R: 7, S: 5, M: 10, SN: 11, MO: 6, SL: 4, PG: 2, PS: 8 };
// a siege (see STAGING): the Mortar, the one fire that finds only cover 1 on a hill, comes first (STAGING.mortar)
export const bolsterOf = (cx, kind) => (kind === 'MO' && cx.siege ? STAGING.mortar : (cx.pinGame ? BOLSTER_PIN : BOLSTER)[kind]);
// and it is not the card to bid or leave in the discard (STAGING.keep)
const keepOf = (cx, kind) => (kind === 'MO' && cx.siege ? STAGING.keep : KEEP[kind]);

export const kindOf = (uid) => unitKind(unitType(uid));
/** How much a better tile counts for a unit: a Rifleman's place matters more than anyone else's. */
export const placeWeight = (uid) => (kindOf(uid) === 'R' ? 2.2 : 1.2);

/**
 * Factors on an objective's value (see `worth` in context). An objective that wins the game, that we have a marker on
 * and no enemy counter stops us from taking, adds `winOpen` and costs `winPull` (not 14) per step: a Rifleman goes
 * for it rather than stay on a blocked one, and each step there beats a shot (the user's game of scenario 12: on 9 of
 * 10 points, Germany sat 8 rounds on 7B under fire while 17B, scouted and empty, gave the game; docs/02 §5.2).
 * `claim` and `freeTile`: what a Scout gives for a marker on a free objective, and how much sooner it goes there (`claims`).
 * `unblock`: per point of the objective, what a hit on the last enemy counter between us and a winning Control adds
 * to that target (`unblockValue`).
 */
export const GOAL = { blocked: 0.7, winning: 2.5, radioScore: 200, winOpen: 150, winPull: 42, claim: 30, freeTile: 1.5, unblock: 25 };

/**
 * A siege: every objective a side goes for has an enemy counter on it that stops its Control (Normandy rule), as
 * Germany's three hills in scenario 11 (the user's German game, docs/02 §5.2), or the enemy stops it on a hill
 * that alone wins the game, as the castle of scenario 13 (the user's third German game there). Its Riflemen, who cannot Control
 * yet, weigh how exposed a tile is (`expose` per expected hit: 8A or 3A, not the cover 1 tiles), and get nothing
 * for standing on a blocked objective; the Mortar comes first in a Bolster (`mortar`), is kept like a Rifleman
 * rather than bid (`keep`; the user's coalition game of 13: it bid it 6 rounds of 17), stays where it can Blast
 * one, and aims at the enemies on it (`target` times their worth). Waiting further off (up to 2 tiles from the
 * objective) or doing it for any blocked objective, not only in a siege, lost games elsewhere (scenarios 1, 9, 12).
 */
export const STAGING = { expose: 15, mortar: 11, keep: 8, target: 1.5 };

/** Dice of the strongest fire of each kind of unit, for guessing what the enemy could do next turn. */
const FIRE = { R: 1, S: 1, M: 2, SN: 3, MO: 0 };

/** Expected hits on a unit standing on `tile` if every ready enemy fires at it once. */
export function exposure(cx, uid, tile) {
    let e = 0;
    for (const f of cx.foes) {
        const n = FIRE[kindOf(f.id)];
        if (!n || f.suppressed) continue;
        e += hitChance(defenceOf(uid) + coverOf(tile, { fromTile: f.tile, hills: cx.sc.hills }) + cx.d(f.tile, tile), n);
    }
    return e;
}

export function context(view, seat) {
    const sc = scenarioById(view.scenario);
    const b = boardOf(sc);
    const me = SIDES[seat];
    const them = SIDES[1 - seat];
    const units = Object.values(view.units);
    const mine = units.filter((u) => u.seat === seat && u.tile);
    const foes = units.filter((u) => u.seat !== seat && u.tile);
    const pinGame = Boolean(sc.win[me].pin);
    const marked = (t) => Boolean(view.control[t][me]);
    const d = (a, c) => b.dist[a][c] ?? 99;
    // what an objective is worth going for: less while an enemy counter on it stops our Control (Normandy rule), more
    // when taking it wins: it reaches our points, or the enemy is hopeless (no Rifleman cards left, [D-14]) and it puts
    // us ahead of them
    const need = sc.win[me].points;
    const held = (side) => Object.entries(view.objectives).reduce((n, [t, v]) => n + (view.control[t][side] === 'controlled' ? v : 0), 0);
    const have = held(me);
    const theirs = held(them);
    // the radio of scenario 10 [D-31], once US holds it: each Control there adds a point (scorePlay). It is not a goal
    // to stay on: keeping the Riflemen there lost more games than it won (docs/02 §5.2)
    const pump = (t) => me === 'us' && t === sc.radio && view.control[t][me] === 'controlled';
    const goals = b.ids.filter((t) => view.objectives[t] && view.control[t][me] !== 'controlled');
    const wins = (t, v) => Boolean(need) && (have + v >= need
        || (view.hopeless?.[1 - seat] && have + v > theirs - (view.control[t][them] === 'controlled' ? v : 0)));
    const blocked = (t) => foes.some((f) => f.tile === t) && (view.controlRule !== 'northAfrica' || view.control[t][them] === 'controlled');
    const worth = (t) => {
        const v = view.objectives[t];
        return v * (blocked(t) ? GOAL.blocked : 1) * (wins(t, v) ? GOAL.winning : 1);
    };
    // how soon one of our Riflemen could use a marker on a tile: 1.5 standing on it, 1 next to it, less further off
    const rifles = mine.filter((u) => kindOf(u.id) === 'R');
    const reach = (t) => (rifles.length ? 3 / (2 + Math.min(...rifles.map((u) => d(u.tile, t)))) : 1);
    const siege = goals.length > 0 && (goals.every(blocked)
        || goals.some((t) => blocked(t) && wins(t, view.objectives[t]) && tileCover(t, sc.hills) === 'hill'));
    const winsAt = (t) => wins(t, view.objectives[t]);
    // a free objective: nobody controls it or has a marker on it, and no enemy counter stops our Control
    const free = (t) => Boolean(need) && Boolean(view.objectives[t]) && !marked(t) && !blocked(t) && !view.control[t][them];
    return { sc, b, me, them, seat, units, mine, foes, goals, pinGame, marked, d, view, worth, blocked, winsAt, siege, reach, pump, free, have, theirs };
}

/** How good a tile is for a unit (higher is better), less what it risks under the enemy mortar's target. */
export function tileValue(cx, uid, tile) {
    return placeValue(cx, uid, tile) - (cx.view.targets[1 - cx.seat] === tile ? blastRisk(cx, uid, tile) : 0);
}

/**
 * What standing on the enemy's mortar target costs: the chance of one Blast die hitting there, times the unit's
 * worth. A Rifleman still goes there to Control an objective, but leaves once it is taken (control stays).
 */
const blastRisk = (cx, uid, tile) => hitChance(defenceOf(uid) + coverOf(tile, { blast: true, hills: cx.sc.hills }), 1) * WORTH[kindOf(uid)] * 0.7;

function placeValue(cx, uid, tile) {
    const k = kindOf(uid);
    const { goals, foes, d, view } = cx;
    if (k === 'R') {
        if (!goals.length) return -Math.min(...foes.map((f) => d(tile, f.tile)), 9);
        let best = -99;
        for (const gt of goals) {
            const open = cx.marked(gt) && !cx.blocked(gt) && cx.winsAt(gt);
            best = Math.max(best, cx.worth(gt) * 6 + (open ? GOAL.winOpen : 0) - (open ? GOAL.winPull : 14) * d(tile, gt)
                + (gt === tile && !cx.siege ? 25 : 0));
        }
        return cx.siege ? best - STAGING.expose * exposure(cx, uid, tile) : best;
    }
    if (k === 'S') {
        const open = goals.filter((t) => !cx.marked(t));
        const list = open.length ? open : goals;
        if (!list.length) return 0;
        return Math.max(...list.map((gt) => cx.worth(gt) * cx.reach(gt) * 4 * (cx.free(gt) ? GOAL.freeTile : 1) - 10 * d(tile, gt)));
    }
    const rif = foes.filter((f) => kindOf(f.id) === 'R');
    const near = rif.length ? Math.min(...rif.map((f) => d(tile, f.tile))) : 3;
    const cover = coverOf(tile, { hills: cx.sc.hills });
    // in a siege the Mortar stays where it can Blast a blocked objective (3 tiles or more away)
    if (k === 'MO' && cx.siege) return cover * 4 + (goals.some((gt) => d(tile, gt) >= 3) ? 12 : 0);
    return cover * 4 - 6 * Math.abs(near - 2);
}

/** Best tile reachable in up to n steps ('move' needs this side's markers) and its value. */
function bestReach(cx, uid, from, n, mode) {
    let best = { tile: from, v: tileValue(cx, uid, from) };
    const seen = new Set([from]);
    let frontier = [from];
    for (let i = 0; i < n; i++) {
        const next = [];
        for (const t of frontier) {
            for (const a of cx.b.adj[t]) {
                if (seen.has(a) || (mode === 'move' && !cx.marked(a))) continue;
                seen.add(a);
                next.push(a);
                const v = tileValue(cx, uid, a);
                if (v > best.v) best = { tile: a, v };
            }
        }
        frontier = next;
    }
    return best;
}

const unitOf = (seat, type) => (TYPES[type].unit ? `${SIDES[seat]}:${TYPES[type].unit}` : null);
const posOf = (cx, uid) => cx.view.units[uid]?.tile;

/**
 * What an enemy Rifleman could Control next turn: an objective its side does not hold that it stands on, or one
 * step from on a tile its side has a marker on (it can move there). Weighs the most valuable one, four times over
 * if it would reach the enemy's points to win. Standing on a tile its side already controls threatens nothing: the
 * control stays whether the unit does or not. Except the radio of scenario 10 [D-31]: on it, or one step from it,
 * a US Rifleman whose side holds it adds a point with every Control.
 */
function threat(cx, uid) {
    const { view, them, d } = cx;
    const at = posOf(cx, uid);
    const need = cx.sc.win[them].points;
    const have = cx.theirs;
    let best = 0;
    for (const [t, val] of Object.entries(view.objectives)) {
        const held = view.control[t][them] === 'controlled';
        const radio = held && them === 'us' && cx.sc.radio === t;
        if (!val || (held && !radio)) continue;
        const dist = d(at, t);
        if (dist > 1 || (dist === 1 && !view.control[t][them])) continue;
        const gain = radio ? 1 : val;
        best = Math.max(best, gain * (dist === 0 ? 1.5 : 1) * (need && have + gain >= need ? 4 : 1));
    }
    return best;
}

/**
 * What a hit on an enemy unit is worth. A Rifleman is worth `WORTH.R` where it wins games: its side plays for points
 * (it Controls), or we win by pinning (its loss pins them). Against a side that only pins, it is one die of fire, as a
 * Scout: the US bot of scenario 16 shot a German Rifleman on its way, not the two counters on 18A that stopped its
 * winning Control (the user's game, docs/02 §5.2).
 */
function targetValue(cx, uid) {
    const k = kindOf(uid);
    let v = WORTH[k === 'R' && !cx.sc.win[cx.them].points && !cx.pinGame ? 'S' : k];
    if (k === 'R') {
        if (cx.pinGame) v *= 1.6;
        v += 25 * threat(cx, uid);
    }
    return v + unblockValue(cx, uid);
}

/**
 * The last enemy counter on an objective whose Control wins us the game, with a Rifleman of ours already on it: with
 * the Normandy rule it is all that stops the Control, so a hit on it is worth GOAL.unblock per point of the objective.
 * Only for a side that plays for points. The user's game of scenario 14 (docs/02 §5.2): a US Rifleman on 16A, one
 * Control from winning, shot a Machine Gunner on the next tile, not the Scouts that blocked it. Wider versions (any
 * blocked objective, or a winning one with a Rifleman next to it) lost games in scenario 8, where the enemy is often
 * hopeless and a hit on a counter with no cards left removes it.
 */
function unblockValue(cx, uid) {
    const t = posOf(cx, uid);
    const ready = cx.mine.some((u) => u.tile === t && kindOf(u.id) === 'R');
    const last = cx.foes.filter((f) => f.tile === t).length === 1;
    if (!cx.sc.win[cx.me].points || !ready || !last || !cx.goals.includes(t) || !cx.blocked(t) || !cx.winsAt(t)) return 0;
    return GOAL.unblock * cx.view.objectives[t];
}

function controlScore(cx, tile) {
    const val = cx.view.objectives[tile] ?? 0;
    if (!val) return 2;
    const need = cx.sc.win[cx.me].points;
    // on the radio we already hold [D-31], Control adds one point (the tile's value already counts); worth more
    // than a step towards another objective (GOAL.radioScore, measured)
    if (cx.pump(tile)) return (need && cx.have + 1 >= need ? 1000 : 0) + GOAL.radioScore;
    return (need && cx.have + val >= need ? 1000 : 0) + 100 + 30 * val;
}

function fireScore(cx, o, tile) {
    let best = 0;
    for (const f of cx.foes) {
        if (o.action === 'suppress' && f.suppressed) continue;
        const total = defenceOf(f.id) + coverOf(f.tile, { fromTile: tile, hills: cx.sc.hills }) + cx.d(tile, f.tile);
        const s = hitChance(total, o.value) * targetValue(cx, f.id) * (o.action === 'suppress' ? 0.5 : 1);
        best = Math.max(best, s);
    }
    return best;
}

function moveScore(cx, o, uid, from) {
    if (!from) return 20; // brings the unit onto the board
    const best = bestReach(cx, uid, from, o.value, o.action === 'move' ? 'move' : 'free');
    const s = (best.v - tileValue(cx, uid, from)) * placeWeight(uid);
    return o.action === 'scout' ? s + newMarkers(cx, from, best.tile) * 6 - fogCost(cx.view.players[cx.seat]) + claims(cx, from, best.tile) : s;
}

export function scorePlay(cx, o) {
    const { view, seat } = cx;
    const p = view.players[seat];
    if (o.id === 'end') return 0;
    if (o.action === 'hunker') {
        const t = TYPES[o.card];
        if (t.kind === 'SL') {
            const squadAlive = [...p.supply, ...p.discard, ...p.hand].some((c) => TYPES[typeId(c)].squad === t.squad && TYPES[typeId(c)].kind !== 'SL');
            return squadAlive ? -5 : 3;
        }
        return -5;
    }
    if (o.action === 'rally') return kindOf(unitOf(seat, o.card)) === 'R' ? 45 : 25;
    const uid = unitOf(seat, o.card);
    const from = uid && (posOf(cx, uid) ?? null);
    switch (o.action) {
        case 'control':
            return controlScore(cx, from ?? spawnGuess(cx, uid));
        case 'attack':
        case 'suppress':
            return fireScore(cx, o, from ?? spawnGuess(cx, uid));
        case 'blast': {
            const t = view.targets[seat];
            let s = 0;
            for (const u of cx.units) {
                if (u.tile !== t) continue;
                const v = hitChance(defenceOf(u.id) + coverOf(t, { blast: true, hills: cx.sc.hills }), o.value) * WORTH[kindOf(u.id)];
                s += u.seat === seat ? -v : v;
            }
            return s;
        }
        case 'target': {
            // only for a better target than the one it has: moving it costs the card a Blast would use
            const gain = bestTarget(cx, uid).v - Math.max(0, targetWorth(cx, view.targets[seat]));
            return gain > 0 ? 12 + gain / 3 : -1;
        }
        case 'move':
        case 'scout':
        case 'stalk':
            return moveScore(cx, o, uid, from);
        case 'recon':
            return CARDS.command * drawValue(cx, 1) + CARDS.reconThin;
        case 'conceal':
            return view.players[1 - seat].supply.some((c) => typeId(c) === 'FOW') ? 12 : -1;
        case 'bolster': {
            const picks = p.supply.filter((c) => !TYPES[typeId(c)].fog && (!o.squad || TYPES[typeId(c)].squad === o.squad))
                .map((c) => bolsterOf(cx, TYPES[typeId(c)].kind)).sort((a, b) => b - a).slice(0, o.value);
            return picks.reduce((a, b) => a + b, 0) * 2.5;
        }
        case 'command':
            return CARDS.command * o.value * drawValue(cx, o.value);
        case 'inspire': {
            const best = Math.max(0, ...p.play.filter((c) => !o.squad || TYPES[typeId(c)].squad === o.squad).map((c) => keepOf(cx, TYPES[typeId(c)].kind) ?? 0));
            return best * 4;
        }
        case 'guide': {
            let best = 0;
            for (const u of cx.mine) {
                if (u.suppressed) continue;
                const r = bestReach(cx, u.id, u.tile, o.value, 'move');
                best = Math.max(best, (r.v - tileValue(cx, u.id, u.tile)) * placeWeight(u.id));
            }
            return best;
        }
        default:
            return 0;
    }
}

/**
 * Weights of the cards a turn brings that the bot cannot see yet (Albert Gil's games on BGG, 2026-11-15: the
 * Platoon Sergeant bolstered 122 times out of 124, at 18 a card Command was worth half a Bolster 3). `command`: a card
 * drawn with Command or Recon is worth that share of what the cards of the deck are worth played now (`drawValue`),
 * and Recon adds `reconThin` for the Fog of War it takes out of the deck for good (it was 38, whatever the deck).
 * `reconKeep`: in the bid, a Fog of War that a Scout in hand could Recon out of the deck is kept like that (KEEP) and
 * not bid (it bid the Fog of War every time and had none left to Recon). Against the bot before: 57.7 % (docs/02 §5.3).
 */
export const CARDS = { command: 1, reconKeep: 5, reconThin: 15 };

/**
 * What one card drawn now is worth, on average: each card of the deck (what the bot knows it holds and does not see)
 * by its best play here, Fog of War nothing. The first `n` come from the deck; past its end, from the discard pile.
 */
export function drawValue(cx, n = 1) {
    const p = cx.view.players[cx.seat];
    const { deck, supply } = cx.sc.cards[cx.me];
    const left = {};
    for (const pile of [deck, supply]) for (const [type, k] of Object.entries(pile)) left[type] = (left[type] ?? 0) + k;
    for (const c of [...(p.hand ?? []), ...p.discard, ...p.play, ...p.supply, ...(p.removed ?? [])]) left[typeId(c)]--;
    // a deck too short: the discard pile is shuffled into it
    if (p.deckCount < n) for (const c of p.discard) left[typeId(c)]++;
    let sum = 0;
    let count = 0;
    for (const [type, k] of Object.entries(left)) {
        if (k <= 0) continue;
        sum += k * cardWorth(cx, type);
        count += k;
    }
    return count ? sum / count : 0;
}

/** A card's best play now, roughly (no Command or Recon, Control only where it could be taken, Blast only with a target), at least 0. */
function cardWorth(cx, type) {
    const t = TYPES[type];
    if (t.fog) return 0;
    const uid = unitOf(cx.seat, type);
    const u = uid && cx.view.units[uid];
    if (u?.tile && u.suppressed) return scorePlay(cx, { id: 'x', card: type, action: 'rally' });
    if (uid && !u?.tile && !spawnGuess(cx, uid)) return 0; // off the board with nowhere to come in
    let best = 0;
    for (const a of t.actions) {
        if (a.a === 'command' || a.a === 'recon' || (a.a === 'blast' && !cx.view.targets[cx.seat])) continue;
        if (a.a === 'control') {
            const at = u?.tile;
            if (!at || !cx.view.objectives[at] || cx.blocked(at) || (cx.view.control[at][cx.me] === 'controlled' && !cx.pump(at))) continue;
        }
        best = Math.max(best, scorePlay(cx, { id: 'x', card: type, action: a.a, value: a.v, squad: a.squad }));
    }
    return best;
}

/** A Fog of War in the bid: kept (CARDS.reconKeep) while the hand has a ready Scout for each Fog of War in it. */
function fogKeep(cx, hand) {
    const fogs = hand.filter((c) => typeOf(c).fog).length;
    const scouts = hand.filter((c) => {
        const t = typeOf(c);
        const u = t.unit && cx.view.units[`${cx.me}:${t.unit}`];
        return t.actions.some((a) => a.a === 'recon') && !(u?.tile && u.suppressed);
    }).length;
    return fogs <= scouts ? CARDS.reconKeep : KEEP.FOW;
}

const fogCost = (p) => 4 + p.discard.filter((c) => typeId(c) === 'FOW').length;

/** Tiles on the way from `from` to `to`, end included, not `from`. */
function pathTo(cx, from, to) {
    if (from === to) return [];
    const path = [to];
    let cur = to;
    while (cx.d(from, cur) > 1) {
        cur = cx.b.adj[cur].find((a) => cx.d(from, a) === cx.d(from, cur) - 1);
        path.push(cur);
    }
    return path;
}

/** How many tiles on the way from `from` to `to` have no marker of this side yet. */
const newMarkers = (cx, from, to) => pathTo(cx, from, to).filter((t) => !cx.marked(t)).length;

/**
 * A marker on a free objective: nobody controls it, no enemy counter stops our Control, and our side has none there
 * yet. Worth more than a shot where a Rifleman of ours could use it soon (the user's game of scenario 12, docs/02
 * §5.2: Germany's Scouts fired for five rounds while 1B and 6A, free, gave US the game).
 */
const claims = (cx, from, to) => pathTo(cx, from, to).filter(cx.free).reduce((n, t) => n + GOAL.claim * cx.view.objectives[t] * cx.reach(t), 0);

function spawnGuess(cx, uid) {
    // by paradrop (scenario 16): the likeliest tile
    if (paradropSide(cx.sc) === cx.me) return paradropOdds(cx.sc).reduce((a, b) => (b.p > a.p ? b : a)).tile;
    const type = unitType(uid);
    const name = type === 'SN' ? 'sniper' : type === 'MO' ? 'mortar' : type.at(-1);
    const sp = cx.sc.spawns[cx.me];
    return (sp.find((s) => s.who.includes(name)) ?? sp.find((s) => s.who.includes('all')))?.tile ?? null;
}

/** What the counters on `t` are worth as the Mortar's target: the enemies' worth less ours (0 without a target). */
function targetWorth(cx, t) {
    if (!t) return 0;
    let v = 0;
    for (const u of cx.units) if (u.tile === t) v += u.seat === cx.seat ? -WORTH[kindOf(u.id)] : WORTH[kindOf(u.id)];
    // enemies on an objective they block from us: clearing them opens it
    return v > 0 && cx.goals.includes(t) && cx.blocked(t) ? v * STAGING.target : v;
}

function bestTarget(cx, uid) {
    const from = posOf(cx, uid) ?? spawnGuess(cx, uid);
    let best = { tile: null, v: 0 };
    for (const t of cx.b.ids) {
        if (cx.d(from, t) < 3) continue;
        const v = targetWorth(cx, t);
        if (v > best.v) best = { tile: t, v };
    }
    return best;
}

export function heuristicBot(seed) {
    const stream = { rng: seedFrom(seed) };
    const pick = (opts, score) => {
        let best = null;
        let bs = -Infinity;
        for (const o of opts) {
            const s = score(o) + nextRandom(stream) * 0.5;
            if (s > bs) (bs = s), (best = o);
        }
        return best.id;
    };

    return (req, view) => {
        const cx = context(view, req.seat);
        switch (req.kind) {
            case 'bid': {
                const hand = view.players[req.seat].hand;
                const keep = (o) => (TYPES[o.card].fog ? fogKeep(cx, hand) : keepOf(cx, TYPES[o.card].kind) ?? 5);
                return pick(req.options, (o) => -keep(o) * 10 + TYPES[o.card].initiative);
            }
            case 'play':
                return pick(req.options, (o) => scorePlay(cx, o));
            case 'move': {
                const left = req.of - req.step;
                const mode = req.mode === 'move' ? 'move' : 'free';
                return pick(req.options, (o) => {
                    const tile = o.id === 'stop' ? posOf(cx, req.unit) : o.tile;
                    const v = o.id === 'stop' ? tileValue(cx, req.unit, tile) : bestReach(cx, req.unit, tile, left, mode).v;
                    const scouting = req.mode === 'scout' && o.id !== 'stop' && !cx.marked(o.tile) ? 3 : 0;
                    return v + scouting;
                });
            }
            case 'guide':
                return pick(req.options, (o) => {
                    const u = view.units[o.unit];
                    return (bestReach(cx, u.id, u.tile, 1, 'move').v - tileValue(cx, u.id, u.tile)) * (kindOf(u.id) === 'R' ? 2 : 1);
                });
            case 'attack':
            case 'suppress':
                return pick(req.options, (o) => hitChance(o.total, o.dice) * targetValue(cx, o.unit));
            case 'target': {
                const best = bestTarget(cx, req.unit);
                return pick(req.options, (o) => (o.tile === best.tile ? 100 : -cx.d(o.tile, best.tile ?? o.tile)));
            }
            case 'bolster':
                return pick(req.options, (o) => (o.id === 'done' ? 0 : bolsterOf(cx, TYPES[o.card].kind) ?? 1));
            case 'inspire':
                return pick(req.options, (o) => (o.id === 'done' ? 0 : keepOf(cx, TYPES[o.card].kind) ?? 1));
            default:
                return req.options[0].id;
        }
    };
}
