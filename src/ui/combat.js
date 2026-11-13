// What happened since the last decision, shown step by step (like 58's playback, from the session's snapshots at
// each beat): every Attack, Suppress and Blast with its arrow, its 3D dice (dice3d.js, loaded the first time) and
// its result on the board and in the side panel; the bot's moves, spawns and rallies; the bids. A tap skips a step,
// "Skip" the rest. Without WebGL (or with the 3D dice off) the dice show flat in the panel.

import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { logLine, sideName, unitName } from './text.js';

const SIDES = ['us', 'de'];
const CONSEQUENCES = new Set(['casualty', 'eliminated', 'suppressed']);

let tray = null;
/** The 3D dice tray, loaded the first time; null without WebGL. */
export function diceTray() {
    return (tray ??= import('./dice3d.js').then((m) => m.createDiceTray()).catch((err) => {
        console.warn('3D dice:', err);
        return null;
    }));
}

/**
 * Downloads the 3D dice code (three.js and cannon-es, 1.1 MB) in the background once the start screen is up, so the
 * first roll does not wait for it when the app is served from the web. Only the module: the tray (and its WebGL
 * context) is still made at the first roll, or when a game starts.
 */
export function warmDice() {
    const go = () => import('./dice3d.js').catch(() => {});
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1000);
}

/** The pauses of a playback: each one ends after its time, or at once after a tap. */
export class Playback {
    constructor() {
        this.all = false; // "skip": the rest goes by at once
        this.wake = null;
        this.started = performance.now(); // a click from before this moment is the one that started it, not a tap
    }

    wait(ms) {
        if (this.all) return Promise.resolve();
        return new Promise((resolve) => {
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                resolve();
            }
            this.wake = done;
        });
    }

    /** Ends the current pause (a tap). */
    next() {
        this.wake?.();
        this.wake = null;
        tray?.then((x) => x?.skip());
    }

    /** Ends this one and all the others. */
    skip() {
        this.all = true;
        this.next();
    }
}

const seatOf = (uid) => SIDES.indexOf(uid.slice(0, 2));
const fullName = (uid) => `${unitName(uid)} (${sideName(seatOf(uid))})`;

/** Is a beat worth stopping for? Attacks and bids always; moves, spawns and rallies only of a bot's counters. */
export function worthShowing(beat, isHuman) {
    if (beat.kind === 'attack' || beat.kind === 'bids' || beat.kind === 'paradrop') return true;
    if (beat.kind === 'stuck') return isHuman(beat.seat);
    return ['move', 'spawn', 'rally'].includes(beat.kind) && !isHuman(seatOf(beat.unit));
}

/**
 * The texts of an attack beat: `entry` is its 'attack' log line, `after` the log lines that follow it (its
 * casualty, elimination or suppression come first).
 */
export function attackInfo(entry, after, viewer) {
    const consequences = [];
    for (const e of after) {
        if (!CONSEQUENCES.has(e.k)) break;
        consequences.push(e);
    }
    const defence = entry.total - entry.cover - entry.range;
    return {
        side: SIDES[entry.seat],
        title: t(`fx.${entry.kind}`, { unit: fullName(entry.unit), target: fullName(entry.target) }),
        defence: entry.kind === 'blast'
            ? t('fx.defenceBlast', { total: entry.total, defence, cover: entry.cover })
            : t('fx.defence', { total: entry.total, defence, cover: entry.cover, range: entry.range }),
        need: t(entry.total > 9 ? 'fx.needZero' : 'fx.need', { total: entry.total, n: entry.dice.length }),
        dice: entry.dice.map((d) => ({ d, hit: d === 0 || d >= entry.total })),
        hit: entry.hit,
        result: entry.hit ? t('fx.hit') : t('fx.miss'),
        badge: { unit: entry.target, hit: entry.hit, text: t(entry.hit ? (entry.kind === 'suppress' ? 'fx.badge.suppressed' : 'fx.badge.hit') : 'fx.badge.miss') },
        then: consequences.map((e) => logLine(e, viewer)),
    };
}

/** The texts of a paradrop beat (scenario 16): every roll but the last had no tile and was rolled again. */
export function paradropInfo(beat) {
    const v = (d) => d || 10; // the 0 counts as 10 ([D-39])
    const [a, b] = beat.rolls.at(-1).map(v);
    return {
        side: SIDES[seatOf(beat.unit)],
        title: t('fx.paradrop', { unit: fullName(beat.unit) }),
        rule: t('fx.paradropRule'),
        again: beat.rolls.slice(0, -1).map(([x, y]) => t('fx.paradropAgain', { a: v(x), b: v(y), sum: v(x) + v(y) })),
        dice: [a, b].map((d) => ({ d, hit: true })),
        result: t('fx.paradropLands', { sum: a + b, tile: beat.tile }),
    };
}

/** The side panel of a step: a title, its lines, the dice once rolled, the result, and the buttons. */
export function stepPanel({ title, lines = [], dice = null, result = null, hit = false, then = [] }, pb) {
    return h('div', { class: 'prompt playback' },
        h('h3', {}, title),
        lines.map((l) => h('p', { class: 'small' }, l)),
        dice ? h('div', { class: 'dice-row' }, dice.map(({ d, hit: good }) => h('span', { class: `die${good ? ' good' : ''}` }, d))) : null,
        result ? h('p', { class: `result ${hit ? 'hit' : 'miss'}` }, result) : null,
        then.map((l) => h('p', { class: 'then' }, l)),
        h('div', { class: 'row' },
            h('button', { onclick: () => pb.next() }, `${t('fx.next')} ▶`),
            h('button', { class: 'minor', onclick: () => pb.skip() }, `${t('fx.skip')} ⏭`)));
}

/** The text of a beat that is not an attack: the log line it comes from. */
export const beatText = (entry, viewer) => (entry ? logLine(entry, viewer) : '');
