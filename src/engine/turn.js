// A player's turn (docs/01 §5) and the card actions (§6). Each card played is either one of its actions or
// hunkered down; a suppressed unit's card only rallies it ([D-7]).

import { choose, beat, log, note } from './ask.js';
import { TYPES, coverOf, defenceOf, typeId, typeOf, unitOfCard } from './data.js';
import { randomInt } from './rng.js';
import {
    board, bring, casualty, casualtyFrom, checkWin, controls, dist, drawCards, enemiesOn, gainFog, handPool, hasMarker,
    isExternal, moveUnit, onBoard, positionOf, sc, sideOf, spawn,
} from './state.js';

/** Distinct cards of a list by type, keeping the first of each (identical cards are offered once). */
const byType = (cards) => [...new Map(cards.map((c) => [typeId(c), c])).values()];

/** A Fog of War in hand besides the card being played (Recon). */
const fogInHand = (g, seat) => g.players[seat].hand.length >= 2 && handPool(g, seat).some((c) => typeOf(c).fog);

/** Tiles a counter at `from` may step onto next. move/guide: only tiles with this side's marker ([D-1]). */
function steps(g, seat, from, mode) {
    return board(g).adj[from].filter((t) => mode !== 'move' || hasMarker(g, seat, t));
}

/** Cards of the supply a Bolster may take ([D-19]: never Fog of War). */
const bolsterable = (p, squad) => p.supply.filter((c) => !typeOf(c).fog && (!squad || typeOf(c).squad === squad));
/** Cards of the play area an Inspire may return ([D-18]: not itself). */
const inspirable = (p, squad, self) => p.play.filter((c) => c !== self && !typeOf(c).fog && (!squad || typeOf(c).squad === squad));

/** Enemy counters an Attack or Suppress may target, with the numbers the UI and bots need. */
export function attackTargets(g, seat, uid, action) {
    const from = positionOf(g, uid);
    return onBoard(g, 1 - seat)
        .filter((e) => action.a !== 'suppress' || !e.suppressed)
        .map((e) => {
            const cover = coverOf(e.tile, { fromTile: from });
            const range = dist(g, from, e.tile);
            return { unit: e.id, tile: e.tile, defence: defenceOf(e.id), cover, range, total: defenceOf(e.id) + cover + range, dice: action.v };
        });
}

/** Tiles the Mortar may aim at: three or more tiles away, other than the current target ([D-21]). */
export function targetTiles(g, seat, uid) {
    const from = positionOf(g, uid);
    return board(g).ids.filter((t) => dist(g, from, t) >= 3 && t !== g.targets[seat]);
}

/**
 * May `seat` take the Control action on `tile`? ([D-23]; [D-31]: enemies on the radio tile do not stop it). With the
 * North Africa control rule (docs/01 §13) enemies only stop it when the enemy controls the tile.
 */
export function canControl(g, seat, tile) {
    if (controls(g, seat, tile)) return sideOf(seat) === 'us' && sc(g).radio === tile;
    if (!enemiesOn(g, seat, tile).length) return true;
    return g.setup.controlRule === 'northAfrica' && !controls(g, 1 - seat, tile);
}

/** Whether a card action would do anything ([D-35]). */
export function available(g, seat, cid, action) {
    const p = g.players[seat];
    const uid = unitOfCard(cid);
    const pos = uid && positionOf(g, uid);
    const fresh = uid && !g.units[uid].tile; // would be placed first: moving 0 tiles still brings it in
    switch (action.a) {
        case 'move':
            return fresh || steps(g, seat, pos, 'move').length > 0;
        case 'scout':
        case 'stalk':
            return fresh || steps(g, seat, pos, action.a).length > 0;
        case 'attack':
        case 'suppress':
            return attackTargets(g, seat, uid, action).length > 0;
        case 'blast':
            return Boolean(g.targets[seat]); // a Mortar off the board comes in first ([D-22])
        case 'target':
            return targetTiles(g, seat, uid).length > 0;
        case 'control':
            return canControl(g, seat, pos);
        case 'recon':
            return fogInHand(g, seat);
        case 'conceal':
            return g.players[1 - seat].supply.some((c) => typeOf(c).fog);
        case 'bolster':
            return bolsterable(p, action.squad).length > 0;
        case 'command':
            return p.deck.length + p.discard.length > 0;
        case 'inspire':
            return inspirable(p, action.squad, cid).length > 0;
        case 'guide':
            return guidable(g, seat).length > 0;
        default:
            throw new Error(`unknown action ${action.a}`);
    }
}

const guidable = (g, seat) => onBoard(g, seat).filter((u) => !u.suppressed && steps(g, seat, u.tile, 'move').length);

/** The options of the "play a card" decision: actions, rally, hunker down, end. */
export function playOptions(g, seat) {
    const p = g.players[seat];
    const out = [];
    for (const cid of byType(handPool(g, seat))) {
        const t = typeOf(cid);
        if (t.fog) continue;
        const uid = unitOfCard(cid);
        if (uid && g.units[uid].tile && g.units[uid].suppressed) {
            out.push({ id: `rally:${t.id}`, card: t.id, action: 'rally' });
        } else {
            t.actions.forEach((a, i) => {
                if (available(g, seat, cid, a)) out.push({ id: `act:${t.id}:${i}`, card: t.id, action: a.a, value: a.v, squad: a.squad });
            });
        }
        out.push({ id: `hunker:${t.id}`, card: t.id, action: 'hunker' });
    }
    out.push({ id: 'end' });
    return out;
}

export function* playerTurn(g, seat) {
    g.turn = seat;
    log(g, 'turn', { seat });
    const p = g.players[seat];
    for (;;) {
        const options = playOptions(g, seat);
        if (options.length === 1 && p.hand.length) {
            // only Fog of War left in hand (often just drawn with Command): the turn ends by itself. Private, since
            // the opponent cannot tell it from a pass; the UI stops on the beat so it does not go by unseen.
            note(g, seat, 'stuck', { n: p.hand.length });
            yield* beat(g, 'stuck', { seat });
        }
        const answer = yield* choose(g, seat, 'play', options);
        if (answer === 'end') break;
        const [what, type, idx] = answer.split(':');
        const cid = bring(g, seat, (c) => typeId(c) === type);
        p.hand.splice(p.hand.indexOf(cid), 1);
        if (what === 'hunker') {
            p.supply.push(cid);
            log(g, 'hunker', { seat, card: type });
            continue;
        }
        p.play.push(cid);
        if (what === 'rally') {
            const uid = unitOfCard(cid);
            g.units[uid].suppressed = false;
            log(g, 'rally', { seat, card: type, unit: uid });
            yield* beat(g, 'rally', { unit: uid });
            continue;
        }
        const action = TYPES[type].actions[Number(idx)];
        log(g, 'play', { seat, card: type, action: action.a, value: action.v ?? null });
        yield* doAction(g, seat, cid, action);
        checkWin(g, seat);
    }
    if (isExternal(g, seat)) yield* leftovers(g, seat);
    p.discard.push(...p.hand.splice(0), ...p.play.splice(0));
    log(g, 'endTurn', { seat });
}

/** An external seat ends its turn with cards in hand: they go to the discard pile, so it says which they are. */
function* leftovers(g, seat) {
    const p = g.players[seat];
    if (!p.hand.length) return;
    const kept = [];
    while (p.hand.length) {
        const opts = byType(handPool(g, seat)).map((c) => ({ id: `card:${typeId(c)}`, card: typeId(c) }));
        const a = yield* choose(g, seat, 'leftover', opts, { left: p.hand.length });
        const c = bring(g, seat, (x) => typeId(x) === a.slice(5));
        p.discard.push(...p.hand.splice(p.hand.indexOf(c), 1)); // where the end of the turn puts it anyway
        kept.push(typeId(c));
    }
    log(g, 'leftover', { seat, cards: kept });
}

function* doAction(g, seat, cid, action) {
    const p = g.players[seat];
    const uid = unitOfCard(cid);
    const fresh = uid ? spawn(g, uid) : false;
    if (fresh) {
        yield* beat(g, 'spawn', { unit: uid });
        checkWin(g, seat);
    }
    switch (action.a) {
        case 'move':
        case 'scout':
        case 'stalk':
            yield* walk(g, seat, uid, action.v, action.a, fresh);
            break;
        case 'guide': {
            const units = guidable(g, seat);
            const pick = yield* choose(g, seat, 'guide', units.map((u) => ({ id: `unit:${u.id}`, unit: u.id, tile: u.tile })));
            yield* walk(g, seat, pick.slice(5), action.v, 'move', false);
            break;
        }
        case 'attack':
        case 'suppress':
            yield* attack(g, seat, uid, action);
            break;
        case 'blast':
            yield* blast(g, seat, uid, action);
            break;
        case 'target': {
            const tiles = targetTiles(g, seat, uid);
            const t = yield* choose(g, seat, 'target', tiles.map((tile) => ({ id: `tile:${tile}`, tile })), { unit: uid });
            g.targets[seat] = t.slice(5);
            log(g, 'target', { seat, tile: g.targets[seat] });
            break;
        }
        case 'control':
            control(g, seat, positionOf(g, uid));
            break;
        case 'recon': {
            const fog = bring(g, seat, (c) => typeOf(c).fog);
            p.removed.push(...p.hand.splice(p.hand.indexOf(fog), 1));
            log(g, 'recon', { seat });
            drawCards(g, seat, 1);
            break;
        }
        case 'conceal':
            gainFog(g, 1 - seat);
            log(g, 'conceal', { seat });
            break;
        case 'bolster':
            for (let i = 0; i < action.v; i++) {
                const cards = byType(bolsterable(p, action.squad));
                if (!cards.length) break;
                const opts = cards.map((c) => ({ id: `take:${typeId(c)}`, card: typeId(c) }));
                const a = yield* choose(g, seat, 'bolster', i ? [...opts, { id: 'done' }] : opts, { left: action.v - i });
                if (a === 'done') break;
                const c = p.supply.find((x) => typeId(x) === a.slice(5));
                p.supply.splice(p.supply.indexOf(c), 1);
                p.discard.push(c);
                log(g, 'bolster', { seat, card: typeId(c) });
            }
            break;
        case 'command': {
            const drawn = drawCards(g, seat, action.v); // [D-20] the top X cards
            log(g, 'command', { seat, n: drawn.length });
            break;
        }
        case 'inspire':
            for (let i = 0; i < action.v; i++) {
                const cards = byType(inspirable(p, action.squad, cid));
                if (!cards.length) break;
                const opts = cards.map((c) => ({ id: `card:${typeId(c)}`, card: typeId(c) }));
                const a = yield* choose(g, seat, 'inspire', i ? [...opts, { id: 'done' }] : opts, { left: action.v - i });
                if (a === 'done') break;
                const c = p.play.find((x) => x !== cid && typeId(x) === a.slice(5));
                p.play.splice(p.play.indexOf(c), 1);
                p.hand.push(c);
                log(g, 'inspire', { seat, card: typeId(c) });
            }
            break;
        default:
            throw new Error(`unknown action ${action.a}`);
    }
}

/** Steps a counter up to n tiles. A Scout leaves a scouted marker (and takes a Fog of War) where it had none ([D-4]). */
function* walk(g, seat, uid, n, mode, fresh) {
    for (let i = 0; i < n; i++) {
        const from = g.units[uid].tile;
        const opts = steps(g, seat, from, mode).map((tile) => ({ id: `tile:${tile}`, tile }));
        if (!opts.length) break;
        if (i > 0 || fresh) opts.push({ id: 'stop' });
        const a = yield* choose(g, seat, 'move', opts, { unit: uid, mode, step: i + 1, of: n });
        if (a === 'stop') break;
        const tile = a.slice(5);
        moveUnit(g, uid, tile);
        log(g, 'move', { seat, unit: uid, from, tile, mode });
        if (mode === 'scout' && !hasMarker(g, seat, tile)) {
            g.control[tile][sideOf(seat)] = 'scouted';
            const fog = gainFog(g, seat);
            log(g, 'scouted', { seat, tile, fog });
        }
        yield* beat(g, 'move', { unit: uid, from, tile });
    }
}

/** Rolls `n` d10 (0–9). */
function roll(g, n) {
    return Array.from({ length: n }, () => randomInt(g, 10));
}

const hits = (dice, total) => dice.some((d) => d === 0 || d >= total);

/**
 * The dice of an attack by `seat`: rolled by the engine, or by the companion's player (their own dice, and the bot's
 * when setup.botDice is 'physical'), who says hit or miss (a miss is impossible below 2). { dice: null } then.
 */
function* rollFor(g, seat, n, total, extra) {
    const ext = g.setup.external;
    if (ext == null || (seat !== ext && g.setup.botDice !== 'physical')) {
        const dice = roll(g, n);
        return { dice, hit: hits(dice, total) };
    }
    const opts = total > 1 ? [{ id: 'hit' }, { id: 'miss' }] : [{ id: 'hit' }];
    const a = yield* choose(g, ext, 'roll', opts, { dice: n, total, attacker: seat, ...extra });
    return { dice: null, hit: a === 'hit' };
}

/** A hit that costs a card: an external seat says where it takes it from. */
function* takeCasualty(g, uid) {
    const seat = g.units[uid].seat;
    const from = isExternal(g, seat) ? casualtyFrom(g, uid) : [];
    if (!from.length) return casualty(g, uid);
    const a = yield* choose(g, seat, 'casualty', from.map((w) => ({ id: `from:${w}`, from: w })), { unit: uid });
    casualty(g, uid, a.slice(5));
}

function* attack(g, seat, uid, action) {
    const targets = attackTargets(g, seat, uid, action);
    const a = yield* choose(g, seat, action.a, targets.map((t) => ({ id: `unit:${t.unit}`, ...t })), { unit: uid });
    const t = targets.find((x) => x.unit === a.slice(5));
    const { dice, hit } = yield* rollFor(g, seat, action.v, t.total, { unit: uid, target: t.unit, attack: action.a, defence: t.defence, cover: t.cover, range: t.range });
    log(g, 'attack', { seat, unit: uid, target: t.unit, kind: action.a, dice, total: t.total, cover: t.cover, range: t.range, hit });
    yield* beat(g, 'attack', { unit: uid, target: t.unit, dice, total: t.total, hit });
    if (!hit) return;
    if (action.a === 'suppress') {
        g.units[t.unit].suppressed = true;
        log(g, 'suppressed', { seat: 1 - seat, unit: t.unit });
    } else {
        yield* takeCasualty(g, t.unit);
    }
}

/** Every counter on the target tile, friend or foe, is attacked separately ([D-10]). */
function* blast(g, seat, uid, action) {
    const tile = g.targets[seat];
    const victims = Object.values(g.units).filter((u) => u.tile === tile).map((u) => u.id).sort();
    log(g, 'blast', { seat, unit: uid, tile, count: victims.length });
    for (const v of victims) {
        if (g.units[v].tile !== tile) continue;
        const total = defenceOf(v) + coverOf(tile, { blast: true });
        const { dice, hit } = yield* rollFor(g, seat, action.v, total, { unit: uid, target: v, attack: 'blast', defence: defenceOf(v), cover: total - defenceOf(v), range: 0 });
        log(g, 'attack', { seat, unit: uid, target: v, kind: 'blast', dice, total, cover: total - defenceOf(v), range: 0, hit });
        yield* beat(g, 'attack', { unit: uid, target: v, dice, total, hit });
        if (hit) yield* takeCasualty(g, v);
    }
}

function control(g, seat, tile) {
    const me = sideOf(seat);
    const them = sideOf(1 - seat);
    if (controls(g, seat, tile)) {
        g.objectives[tile] = (g.objectives[tile] ?? 0) + 1; // [D-31] the radio
        log(g, 'radio', { seat, tile, value: g.objectives[tile] });
        return;
    }
    g.control[tile][me] = 'controlled';
    if (g.control[tile][them] === 'controlled') g.control[tile][them] = 'scouted';
    log(g, 'control', { seat, tile });
}

