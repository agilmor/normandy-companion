// A game in progress: setup + the answers given so far. The engine is a deterministic generator, so replaying the
// answers rebuilds the state exactly (undo, saved games, bug reports). Same scheme as 60 (UBB1.), 59 and 51.

import { validate, GameEnd, IllegalAction } from './ask.js';
import { normalizeSetup, createState, run } from './game.js';
import { view } from './view.js';

export class Session {
    /**
     * @param {object} setup @param {string[]} [answers]
     * @param {{ capture?: boolean }} [o] capture: snapshots of what happens before the first decision
     */
    constructor(setup, answers = [], { capture = false } = {}) {
        this.setup = normalizeSetup(setup);
        this.#start(capture && !answers.length);
        for (const a of answers) this.act(a);
    }

    #start(capture = false) {
        this.frames = [];
        this.capture = capture;
        this.answers = [];
        /** Readable history: { seat, kind, answer, round } per answer (debug panel, replay tool). */
        this.trail = [];
        this.state = createState(this.setup);
        this.iter = run(this.state);
        this.#resume(undefined);
    }

    #resume(answer) {
        const g = this.state;
        g.pending = null;
        try {
            let step = this.iter.next(answer);
            // beats are not decisions: snapshot them (if asked) and go on
            while (!step.done && step.value.type === 'beat') {
                if (this.capture) this.frames.push({ beat: step.value, logLen: g.log.length, state: structuredClone({ ...g, log: [], notes: [[], []], pending: null }) });
                step = this.iter.next();
            }
            if (step.done) throw new Error('the game generator ended without a result');
            g.pending = step.value;
        } catch (err) {
            if (!(err instanceof GameEnd)) {
                g.error = { message: err.message, stack: err.stack };
                throw err;
            }
        }
    }

    get pending() {
        return this.state.pending;
    }

    get over() {
        return Boolean(this.state.result || this.state.error);
    }

    /** What `seat` may see (docs/02 §2.1). */
    view(seat) {
        return view(this.state, seat);
    }

    /**
     * Answers the pending decision. Throws IllegalAction if it does not fit.
     * capture: keep a snapshot at each beat until the next decision (this.frames).
     */
    act(answer, { capture = false } = {}) {
        this.frames = [];
        this.capture = capture;
        if (this.over) throw new IllegalAction('the game is over');
        const p = this.state.pending;
        validate(p, answer);
        this.trail.push({ seat: p.seat, kind: p.kind, answer, round: this.state.round });
        this.answers.push(answer);
        this.#resume(answer);
    }

    /** Rebuilds the game without the last `n` answers. Shuffles and dice do not change: they come from the seed. */
    undo(n = 1) {
        const keep = this.answers.slice(0, Math.max(0, this.answers.length - n));
        this.#start();
        for (const a of keep) this.act(a);
    }

    /** Rebuilds the game up to answer number `n` (time travel). */
    rewindTo(n) {
        this.undo(this.answers.length - n);
    }
}

// ------------------------------------------------------------------ records

const PREFIX = 'UNN1.';

/** Short summary of a state: if it differs after a replay, the engine changed since the recording. */
export function fingerprint(g) {
    const units = Object.values(g.units).map((u) => `${u.tile ?? '-'}${u.suppressed ? '*' : ''}`).join('/');
    const cards = g.players.map((p) => [p.deck.length, p.hand.length, p.discard.length, p.supply.length, p.removed.length].join(',')).join('/');
    const control = Object.values(g.control).map((c) => `${c.us?.[0] ?? '-'}${c.de?.[0] ?? '-'}`).join('');
    const r = g.result ? `${g.result.winner}${g.result.how}` : '';
    return [g.round, g.turn, g.initiative, g.rng, units, cards, control, g.targets.join(','), r].join('|');
}

export function makeRecord(session, build) {
    return { v: 1, ...(build ? { build } : {}), setup: session.setup, answers: [...session.answers], check: fingerprint(session.state) };
}

async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const toB64url = (bytes) => {
    let bin = '';
    for (const x of bytes) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encodeRecord(record) {
    const json = new TextEncoder().encode(JSON.stringify(record));
    return PREFIX + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Accepts the code with spaces or line breaks in between. Errors carry an i18n key in `.key`. */
export async function decodeRecord(code) {
    const fail = (key) => Object.assign(new Error(key), { key });
    const t = code.replace(/\s+/g, '');
    const i = t.indexOf(PREFIX);
    if (i < 0) throw fail('record.notACode');
    let record;
    try {
        const bytes = await pipe(fromB64url(t.slice(i + PREFIX.length)), new DecompressionStream('deflate-raw'));
        record = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw fail('record.damaged');
    }
    if (record.v !== 1 || !record.setup || !Array.isArray(record.answers)) throw fail('record.unknown');
    return record;
}

/**
 * Replays a record. Stops at the first answer that no longer fits (the engine changed) and reports it.
 * @returns {{ session: Session, failedAt: number | null, error?: string, matches: boolean }}
 */
export function replayRecord(record, upTo = record.answers.length) {
    const session = new Session(record.setup);
    for (let i = 0; i < upTo; i++) {
        try {
            session.act(record.answers[i]);
        } catch (err) {
            return { session, failedAt: i, error: err.message, matches: false };
        }
    }
    const matches = upTo < record.answers.length || !record.check || fingerprint(session.state) === record.check;
    return { session, failedAt: null, matches };
}
