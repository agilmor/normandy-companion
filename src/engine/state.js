// Game state, setup and the rules that several actions share: drawing, control, casualties, spawning, victory.
// Seat 0 is always the US, seat 1 the Germans (docs/02 §2.2).

import { GameEnd, log, note } from './ask.js';
import { seedFrom, shuffle } from './rng.js';
import { SIDES, TYPES, scenarioById, typeOf, unitOfCard, unitType } from './data.js';
import { boardOf } from './board.js';

const MAX_ROUNDS = 60; // [D-33] safety net for games between bots, not a rule

/** The setup of a game someone is playing: it has no round limit ([D-33]). Also for saved games and codes from before. */
export const withoutRoundLimit = (setup) => ({ ...setup, maxRounds: 9999 });

export function normalizeSetup(setup) {
    const scenario = Number(setup.scenario ?? 1);
    scenarioById(scenario);
    const controlRule = setup.controlRule === 'northAfrica' ? 'northAfrica' : 'normandy'; // docs/01 §13
    const out = { scenario, seed: String(setup.seed ?? 'normandy'), maxRounds: setup.maxRounds ?? MAX_ROUNDS, controlRule };
    if (scenarioById(scenario).variants?.[setup.variant]) out.variant = setup.variant; // docs/02 §5.5
    // the companion (docs/02 §7.4): one seat plays with a physical deck and dice; botDice 'physical' = the player
    // also rolls the bot's dice
    if (setup.external === 0 || setup.external === 1) {
        out.external = setup.external;
        out.botDice = setup.botDice === 'physical' ? 'physical' : 'virtual';
    }
    return out;
}

/** What a scenario starts with, once its variant (if any) is applied: a house rule, not the book's (docs/02 §5.5). */
function startOf(sc, name) {
    const v = sc.variants?.[name];
    if (!v) return sc;
    const out = structuredClone({ control: sc.control, units: sc.units, cards: sc.cards });
    for (const [tile, marks] of Object.entries(v.control ?? {})) out.control[tile] = { ...out.control[tile], ...marks };
    for (const side of SIDES) {
        Object.assign(out.units[side], v.units?.[side]);
        const { deck, supply } = out.cards[side];
        for (const [type, n] of Object.entries(v.toDeck?.[side] ?? {})) {
            supply[type] -= n;
            deck[type] = (deck[type] ?? 0) + n;
        }
    }
    return out;
}

export function createState(setup) {
    const sc = scenarioById(setup.scenario);
    const start = startOf(sc, setup.variant);
    const g = {
        setup,
        scenario: sc.id,
        rng: seedFrom(setup.seed),
        round: 0,
        turn: null,
        phase: 'setup',
        initiative: SIDES.indexOf(sc.initiative),
        players: [],
        units: {},
        control: {},
        objectives: { ...sc.objectives },
        targets: [null, null],
        log: [],
        notes: [[], []],
        result: null,
        pending: null,
    };
    for (const t of sc.tiles) g.control[t.id] = { us: null, de: null, ...start.control[t.id] };
    SIDES.forEach((side, seat) => {
        const p = { side, deck: [], hand: [], discard: [], play: [], supply: [], removed: [], bid: null };
        const n = {};
        for (const [where, list] of [['deck', p.deck], ['supply', p.supply]]) {
            for (const [type, count] of Object.entries(start.cards[side][where])) {
                for (let i = 0; i < count; i++) list.push(`${side}:${type}:${(n[type] = (n[type] ?? 0) + 1)}`);
            }
        }
        shuffle(g, p.deck);
        g.players.push(p);
        // a counter for every unit with cards in the game, on the board if the scenario places it
        const types = new Set([...p.deck, ...p.supply].map((c) => TYPES[c.split(':')[1]].unit).filter(Boolean));
        for (const type of Object.keys(start.units[side])) types.add(type);
        for (const type of [...types].sort()) {
            const id = `${side}:${type}`;
            g.units[id] = { id, seat, type, tile: start.units[side][type] ?? null, suppressed: false };
        }
    });
    return g;
}

export const sc = (g) => scenarioById(g.scenario);
export const board = (g) => boardOf(sc(g));
export const sideOf = (seat) => SIDES[seat];
export const dist = (g, a, b) => board(g).dist[a][b] ?? Infinity;

// ------------------------------------------------------------------ cards

// ------------------------------------------------------------------ external seat (docs/02 §7.4)
// A seat whose deck and hand are physical: the engine knows which cards are in them together (everything else is
// public) and how many are in each, but not which are in the hand. Its p.hand and p.deck hold those cards split in
// some order; when the player says which card they hold, `bring` swaps one of that type into the hand. So the engine
// checks what can be checked: a card played, bid or lost from the hand must be among the cards the player may hold.

export const isExternal = (g, seat) => g.setup.external === seat;

/** Cards that may be in `seat`'s hand: the hand, or for an external seat the hand and the deck (none if the hand is empty). */
export function handPool(g, seat) {
    const p = g.players[seat];
    if (!p.hand.length) return [];
    return isExternal(g, seat) ? [...p.hand, ...p.deck] : p.hand;
}

/**
 * The first card of `seat`'s `where` ('hand' or 'deck') that fits `pred`; for an external seat one from the other
 * pile is swapped in if needed (the engine's split of the two is a guess). Null if there is none.
 */
export function bring(g, seat, pred, where = 'hand') {
    const p = g.players[seat];
    const here = p[where];
    const i = here.findIndex(pred);
    if (i >= 0) return here[i];
    if (!isExternal(g, seat) || !here.length) return null;
    const there = p[where === 'hand' ? 'deck' : 'hand'];
    const j = there.findIndex(pred);
    if (j < 0) return null;
    const k = here.length - 1;
    [here[k], there[j]] = [there[j], here[k]];
    return here[k];
}

/** Draws up to n cards, shuffling the discard pile (never the play area) into the deck when it runs out ([D-17]). */
export function drawCards(g, seat, n) {
    const p = g.players[seat];
    const drawn = [];
    let first = null; // cards drawn before the deck ran out and the discard pile was shuffled
    for (let i = 0; i < n; i++) {
        if (!p.deck.length) {
            if (!p.discard.length) break;
            first ??= drawn.length;
            p.deck.push(...shuffle(g, p.discard.splice(0)));
            log(g, 'reshuffle', { seat });
        }
        const c = p.deck.pop();
        p.hand.push(c);
        drawn.push(c);
    }
    if (drawn.length && !isExternal(g, seat)) note(g, seat, 'drew', { cards: drawn });
    // the physical ones are unknown: the companion tells the player how many to draw, and when to shuffle
    if (isExternal(g, seat)) log(g, 'draw', { seat, n: drawn.length, want: n, first });
    return drawn;
}

/** Moves one Fog of War from `seat`'s supply to their discard pile, if there is one. */
export function gainFog(g, seat) {
    const p = g.players[seat];
    const i = p.supply.findIndex((c) => typeOf(c).fog);
    if (i < 0) return false;
    p.discard.push(...p.supply.splice(i, 1));
    return true;
}

/** Every card of `seat` that can still reach the deck (all but the removed ones). */
export const liveCards = (g, seat) => {
    const p = g.players[seat];
    return [...p.deck, ...p.hand, ...p.discard, ...p.play, ...p.supply];
};

// ------------------------------------------------------------------ board

export const unitsOf = (g, seat) => Object.values(g.units).filter((u) => u.seat === seat);
export const onBoard = (g, seat) => unitsOf(g, seat).filter((u) => u.tile);
export const enemiesOn = (g, seat, tile) => onBoard(g, 1 - seat).filter((u) => u.tile === tile);

/** The tile of the spawn marker that brings in a unit type: its own type, its squad, or "all" ([D-29]). */
export function spawnTile(g, seat, type) {
    const spawns = sc(g).spawns[sideOf(seat)];
    const name = type === 'SN' ? 'sniper' : type === 'MO' ? 'mortar' : null;
    const hit = spawns.find((s) => (name ? s.who.includes(name) : s.who.includes(type.at(-1)))) ?? spawns.find((s) => s.who.includes('all'));
    if (!hit) throw new Error(`no spawn for ${sideOf(seat)} ${type}`);
    return hit.tile;
}

/** Where a unit's counter is, or where it would enter the board. */
export const positionOf = (g, uid) => g.units[uid].tile ?? spawnTile(g, g.units[uid].seat, g.units[uid].type);

/** Places a unit that is off the board on its spawn tile, ready side up ([D-8]). */
export function spawn(g, uid) {
    const u = g.units[uid];
    if (u.tile) return false;
    u.tile = spawnTile(g, u.seat, u.type);
    u.suppressed = false;
    log(g, 'spawn', { seat: u.seat, unit: uid, tile: u.tile });
    return true;
}

/** Moves a counter; a moving Mortar loses its target marker. */
export function moveUnit(g, uid, tile) {
    const u = g.units[uid];
    u.tile = tile;
    if (u.type === 'MO' && g.targets[u.seat]) {
        g.targets[u.seat] = null;
        log(g, 'targetLost', { seat: u.seat });
    }
}

export const hasMarker = (g, seat, tile) => Boolean(g.control[tile][sideOf(seat)]);
export const controls = (g, seat, tile) => g.control[tile][sideOf(seat)] === 'controlled';

/** Objective points on the tiles `seat` controls. */
export function points(g, seat) {
    let n = 0;
    for (const [tile, v] of Object.entries(g.objectives)) if (controls(g, seat, tile)) n += v;
    return n;
}

// ------------------------------------------------------------------ casualties

/**
 * A successful Attack or Blast: the owner removes one card of the unit from their play area (friendly fire, per
 * Undaunted: Reinforcements), else hand, else discard, else deck; looking through the deck always shuffles it.
 * With none of those, the counter leaves the board ([D-9]). The Mortar's target stays where it is ([D-22]).
 * `from`: where an external seat says the card came from (one of casualtyFrom's).
 */
export function casualty(g, uid, from = null) {
    const u = g.units[uid];
    const p = g.players[u.seat];
    const mine = (c) => unitOfCard(c) === uid;
    if (from === 'hand' || from === 'deck') bring(g, u.seat, mine, from);
    for (const where of from ? [from] : ['play', 'hand', 'discard', 'deck']) {
        const i = p[where].findIndex(mine);
        const c = i < 0 ? null : p[where].splice(i, 1)[0];
        if (where === 'deck') shuffle(g, p.deck);
        if (!c) continue;
        p.removed.push(c);
        log(g, 'casualty', { seat: u.seat, unit: uid, from: where });
        return;
    }
    u.tile = null;
    u.suppressed = false;
    log(g, 'eliminated', { seat: u.seat, unit: uid });
}

/**
 * Where an external seat may take a casualty's card from, in the rules' order: the play area if one is there (the
 * engine sees it), else the hand or, when the hand has none, the discard or else the deck. [] = the counter leaves.
 */
export function casualtyFrom(g, uid) {
    const u = g.units[uid];
    const p = g.players[u.seat];
    const mine = (c) => unitOfCard(c) === uid;
    if (p.play.some(mine)) return ['play'];
    const hidden = [...p.hand, ...p.deck].some(mine);
    const out = [];
    if (hidden && p.hand.length) out.push('hand');
    if (p.discard.some(mine)) out.push('discard');
    else if (hidden && p.deck.length) out.push('deck');
    return out;
}

// ------------------------------------------------------------------ victory (docs/01 §7)

const riflemenOnBoard = (g, seat) => onBoard(g, seat).some((u) => unitType(u.id)[0] === 'R');

/** [D-14]: a side that plays for points has no Rifleman cards left (a counter without cards cannot act). */
export function hopeless(g, seat) {
    if (!sc(g).win[sideOf(seat)].points) return false;
    return !liveCards(g, seat).some((c) => typeOf(c).kind === 'R');
}

export const pinned = (g, seat) => !riflemenOnBoard(g, seat) || hopeless(g, seat);

export function endGame(g, winner, how) {
    g.result = { winner, how, points: [points(g, 0), points(g, 1)] };
    g.phase = 'over';
    log(g, 'gameOver', { winner, how });
    throw new GameEnd(how);
}

/** Checked after every action ([D-12]); `active` wins a simultaneous double win. */
export function checkWin(g, active = g.turn ?? g.initiative) {
    const win = sc(g).win;
    const pts = [points(g, 0), points(g, 1)];
    const order = [active, 1 - active];
    for (const s of order) if (win[sideOf(s)].points && pts[s] >= win[sideOf(s)].points) endGame(g, s, 'points');
    for (const s of order) if (win[sideOf(s)].pin && pinned(g, 1 - s)) endGame(g, s, 'pin');
    if (pinned(g, 0) && pinned(g, 1)) {
        const winner = pts[0] === pts[1] ? g.initiative : pts[0] > pts[1] ? 0 : 1;
        endGame(g, winner, 'bothPinned');
    }
    for (const s of order) if (win[sideOf(s)].points && hopeless(g, 1 - s) && pts[s] > pts[1 - s]) endGame(g, s, 'hopeless');
}
