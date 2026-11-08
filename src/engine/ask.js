// Decisions, visible steps and the log. The engine is a generator: when a player must decide it yields a request
// ({ type: 'choose', seat, kind, options… }) and receives the chosen option id back from the session. A game is
// therefore (setup, answers): replaying the answers rebuilds any state exactly (undo, saved games, bug reports).
// Same scheme as 51, 55, 59 and 60: every request carries the seat that answers, because both players bid for the
// initiative in the same phase (docs/02 §2.1).

/**
 * @typedef {{ id: string, [k: string]: any }} Option   options carry data, not text: the UI translates them
 * @typedef {{ type: 'choose', seat: number, kind: string, options: Option[], [k: string]: any }} Request
 */

export class IllegalAction extends Error {}

/** Thrown inside the game generator to end the game (g.result is set first). */
export class GameEnd extends Error {
    /** @param {string} reason */
    constructor(reason) {
        super(`game over: ${reason}`);
        this.reason = reason;
    }
}

/**
 * One option out of several, answered by `seat`. With a single option it answers itself (the decision is forced,
 * so replays stay in step).
 * @param {any} g @param {number} seat @param {string} kind @param {Option[]} options @param {object} [extra] fields for the UI and bots
 * @returns {Generator<any, string, any>}
 */
export function* choose(g, seat, kind, options, extra = {}) {
    if (!options.length) throw new Error(`no options for: ${kind}`);
    if (options.length === 1) return options[0].id;
    return yield { type: 'choose', seat, kind, options, ...extra };
}

/** A visible step that is not a decision (a card played, a move, dice rolled). Never changes the game. */
export function* beat(g, kind, data = {}) {
    yield { ...data, type: 'beat', kind };
}

/** Throws IllegalAction if `answer` does not fit `request`. */
export function validate(request, answer) {
    if (!request) throw new IllegalAction('no decision is pending');
    if (typeof answer !== 'string' || !request.options.some((o) => o.id === answer)) {
        throw new IllegalAction(`"${answer}" is not an option of "${request.kind}"`);
    }
}

/** Public log entry as a key + parameters (translated by the UI). Never hidden cards: those go to note(). */
export function log(g, k, params = {}) {
    g.log.push({ round: g.round, turn: g.turn, k, ...params });
}

/** Private entry for one seat only (what you drew, the card you bid). */
export function note(g, seat, k, params = {}) {
    g.notes[seat].push({ round: g.round, turn: g.turn, k, ...params });
}
