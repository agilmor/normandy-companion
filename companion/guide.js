// What the player must do on the table after each answer (docs/02 §7.3), from the public log: the computer's cards
// and their effects (its counters moved, its markers, its attacks with their dice and the consequences for the
// player's counters) and the markers of the player's own actions. One step per line, shown one by one with "Done".
// A step: { head?, text, focus?, arrow?, dice?, side, kind, at }; `dice` = the computer's virtual dice to roll on screen,
// `at` = the entry after which the map shows the table (boardAt).

import { t } from '../src/i18n/index.js';
import { TYPES } from '../src/engine/data.js';
import { actionName, cardName, logLine, sideName, unitName } from '../src/ui/text.js';
import { cardSteps } from './cards.js';

const SIDES = ['us', 'de'];

/**
 * @param {any[]} entries log entries since the last answer
 * @param {number} me the player's seat
 * @param {any} before the player's view before the answer (markers that were there)
 * @param {any} after the view now
 */
export function guideSteps(entries, me, before, after) {
    const bot = 1 - me;
    const out = [];
    const un = (uid) => unitName(uid, me);
    let head = null; // the computer's card being played
    let lastAttack = null;
    let at = 0;
    const push = (step) => out.push({ head: step.mine ? null : head, side: SIDES[step.mine ? me : bot], at, ...step });
    for (let i = 0; i < entries.length; i++) {
        at = i;
        const e = entries[i];
        const mine = e.seat === me;
        switch (e.k) {
            case 'bids': {
                const ini = (c) => (c ? TYPES[c].initiative : 0);
                const name = (c) => (c ? cardName(c) : '—');
                const text = [t('cmp.g.bids', { mine: name(e.cards[me]), a: ini(e.cards[me]), theirs: name(e.cards[bot]), b: ini(e.cards[bot]) }),
                    t(e.kept ? 'cmp.g.kept' : 'cmp.g.initiative', { side: e.initiative === me ? t('cmp.you') : t('cmp.bot') })].join(' ');
                push({ text, kind: 'info', mine: true });
                break;
            }
            case 'turn':
                head = null;
                break;
            case 'play':
                if (mine) break;
                head = t('cmp.g.botPlays', { card: cardName(e.card), action: actionName(e.action, e.value) });
                // a card whose effects do not touch the table (Bolster, Command, Inspire…): the card itself is the step
                if (!entries.slice(i + 1).some((x, j, rest) => x.seat === bot && ['move', 'spawn', 'scouted', 'control', 'target', 'blast', 'attack', 'radio'].includes(x.k)
                    && !rest.slice(0, j).some((y) => y.k === 'play' || y.k === 'endTurn'))) {
                    const effects = entries.slice(i + 1).filter((x, j, rest) => x.seat === bot && ['bolster', 'command', 'inspire', 'recon', 'conceal'].includes(x.k)
                        && !rest.slice(0, j).some((y) => y.k === 'play' || y.k === 'endTurn'));
                    push({ text: head, lines: effects.map((x) => logLine(x, me)), kind: 'info', head: t('cmp.g.botTurn') });
                }
                break;
            case 'hunker':
                if (!mine) push({ text: logLine(e, me), kind: 'info', head: t('cmp.g.botTurn') });
                break;
            case 'rally':
                push({ text: t(mine ? 'cmp.g.rallyYou' : 'cmp.g.rallyBot', { unit: un(e.unit) }), focus: { unit: e.unit }, kind: 'table', mine, head: mine ? null : t('cmp.g.botTurn') });
                break;
            case 'spawn':
                push({ text: t(mine ? 'cmp.g.spawnYou' : 'cmp.g.spawnBot', { unit: un(e.unit), tile: e.tile }), focus: { unit: e.unit, tile: e.tile }, kind: 'table', mine });
                break;
            case 'move': {
                if (mine) break; // the player has moved it
                // the steps of one counter make one move; the tiles it scouts on the way come after it
                const path = [e.from, e.tile];
                const scouted = [];
                let j = i + 1;
                for (; j < entries.length; j++) {
                    const x = entries[j];
                    if (x.k === 'move' && x.unit === e.unit) path.push(x.tile), (at = j);
                    else if (x.k === 'scouted' && x.seat === bot) scouted.push(x);
                    else break;
                }
                i = j - 1;
                push({ text: t('cmp.g.move', { unit: un(e.unit), path: path.join(' → ') }), focus: { unit: e.unit, tiles: path }, arrow: { from: path[0], to: e.unit, kind: 'move', side: SIDES[bot] }, kind: 'table' });
                at = i;
                for (const x of scouted) push({ text: t('cmp.g.scoutedBot', { side: sideName(bot), tile: x.tile }), focus: { tile: x.tile }, kind: 'table' });
                break;
            }
            case 'scouted':
                push({ text: t(mine ? 'cmp.g.scoutedYou' : 'cmp.g.scoutedBot', { side: sideName(e.seat), tile: e.tile }), focus: { tile: e.tile }, kind: 'table', mine });
                break;
            case 'control': {
                push({ text: t(mine ? 'cmp.g.controlYou' : 'cmp.g.controlBot', { side: sideName(e.seat), tile: e.tile }), focus: { tile: e.tile }, kind: 'table', mine });
                const them = SIDES[1 - e.seat];
                if (before?.control[e.tile]?.[them] === 'controlled') push({ text: t('cmp.g.flip', { side: sideName(1 - e.seat), tile: e.tile }), focus: { tile: e.tile }, kind: 'table', mine });
                break;
            }
            case 'radio':
                push({ text: t('cmp.g.radio', { tile: e.tile, value: e.value }), focus: { tile: e.tile }, kind: 'table', mine });
                break;
            case 'target':
                push({ text: t(mine ? 'cmp.g.targetYou' : 'cmp.g.targetBot', { side: sideName(e.seat), tile: e.tile }), focus: { tile: e.tile }, kind: 'table', mine });
                break;
            case 'targetLost':
                push({ text: t(mine ? 'cmp.g.targetLostYou' : 'cmp.g.targetLostBot', { side: sideName(e.seat) }), kind: 'table', mine });
                break;
            case 'blast':
                if (!mine) push({ text: t('cmp.g.blastTile', { side: sideName(e.seat), tile: e.tile }), focus: { tile: e.tile }, kind: 'info' });
                break;
            case 'attack': {
                lastAttack = e;
                if (mine && !e.dice) break; // the player rolled: they know
                const tile = tileOf(e.target, entries.slice(0, i), before, after);
                const key = e.kind === 'blast' ? 'cmp.g.blast' : e.kind === 'suppress' ? 'cmp.g.suppress' : 'cmp.g.attack';
                const text = t(key, { unit: un(e.unit), target: un(e.target), tile, n: e.dice?.length ?? '', total: e.total });
                const result = t(e.hit ? 'cmp.g.hit' : 'cmp.g.miss');
                push({
                    text,
                    after: e.dice ? t('cmp.g.dice', { dice: e.dice.join(' '), result }) : t('cmp.g.result', { result }),
                    dice: e.dice, hit: e.hit,
                    focus: { unit: e.target },
                    arrow: e.kind === 'blast' ? null : { from: e.unit, to: e.target, kind: 'attack', side: SIDES[e.seat] },
                    kind: 'attack',
                    mine,
                });
                break;
            }
            case 'suppressed':
                push({ text: t(e.seat === me ? 'cmp.g.suppressedYou' : 'cmp.g.suppressedBot', { unit: un(e.unit) }), focus: { unit: e.unit }, kind: 'table', mine: lastAttack?.seat === me });
                break;
            case 'casualty':
                if (e.seat === me) push({ ...casualtyText(e, un), focus: { unit: e.unit }, kind: 'cards', mine: lastAttack?.seat === me, op: { move: [e.from, 'removed'] } });
                else push({ text: t('cmp.g.casualtyBot', { unit: un(e.unit) }), focus: { unit: e.unit }, kind: 'info', mine: lastAttack?.seat === me });
                break;
            case 'eliminated':
                push({ text: t(e.seat === me ? 'cmp.g.eliminatedYou' : 'cmp.g.eliminatedBot', { unit: un(e.unit) }), focus: { unit: e.unit }, kind: 'table', mine: lastAttack?.seat === me });
                break;
            case 'gameOver':
                break;
            default:
                break;
        }
        for (const step of cardSteps(e, me, entries, i)) push(step);
    }
    return out;
}

/**
 * The board after entries[0..upto] (the counters, markers, targets and objective values those entries change), from
 * the view before them: what the map shows with each step.
 */
export function boardAt(before, entries, upto) {
    const v = { ...before, units: structuredClone(before.units), control: structuredClone(before.control), objectives: { ...before.objectives }, targets: [...before.targets] };
    for (const e of entries.slice(0, upto + 1)) {
        const u = e.unit && v.units[e.unit];
        switch (e.k) {
            case 'spawn':
            case 'move':
                u.tile = e.tile;
                if (e.k === 'spawn') u.suppressed = false;
                break;
            case 'eliminated':
                u.tile = null;
                u.suppressed = false;
                break;
            case 'suppressed':
            case 'rally':
                u.suppressed = e.k === 'suppressed';
                break;
            case 'scouted':
                v.control[e.tile][SIDES[e.seat]] = 'scouted';
                break;
            case 'control': {
                const c = v.control[e.tile];
                c[SIDES[e.seat]] = 'controlled';
                if (c[SIDES[1 - e.seat]] === 'controlled') c[SIDES[1 - e.seat]] = 'scouted';
                break;
            }
            case 'radio':
                v.objectives[e.tile] = e.value;
                break;
            case 'target':
                v.targets[e.seat] = e.tile;
                break;
            case 'targetLost':
                v.targets[e.seat] = null;
                break;
            default:
                break;
        }
    }
    return v;
}

function casualtyText(e, un) {
    if (e.from === 'deck') return { text: t('cmp.g.casualtyDeck', { unit: un(e.unit) }) };
    return { text: t('cmp.g.casualtyYou', { unit: un(e.unit), from: t(`log.from.${e.from}`) }) };
}

/** The tile a counter stood on when attacked: where it is, or where it was if it has just left the board. */
function tileOf(uid, earlier, before, after) {
    return after.units[uid]?.tile ?? before?.units[uid]?.tile ?? earlier.findLast((x) => x.unit === uid && x.tile)?.tile ?? '?';
}

