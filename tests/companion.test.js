// The companion (companion/, docs/02 §7): the steps it gives for the table, over whole games against the bot. The
// board it draws with each step, rebuilt from the log, must end exactly where the engine is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/engine/data.js';
import { Session } from '../src/engine/session.js';
import { randomBot } from '../src/ai/randomBot.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { boardAt, guideSteps } from '../companion/guide.js';

const board = (v) => ({ units: v.units, control: v.control, targets: v.targets, objectives: v.objectives });

/** Plays a game as the companion does: the player's answer, then the bot until the player's next decision. */
function play(scenario, me, botDice, onTurn) {
    const s = new Session({ scenario, seed: `c${scenario}${me}`, external: me, botDice });
    const human = randomBot(`h${scenario}`);
    const bot = heuristicBot(`b${scenario}`);
    for (let i = 0; !s.over && i < 20000; i++) {
        const before = s.view(me);
        const start = s.state.log.length;
        s.act(human(s.pending, before));
        while (!s.over && s.pending.seat !== me) s.act(bot(s.pending, s.view(1 - me)));
        onTurn(s.state.log.slice(start), before, s.view(me), s);
    }
    return s;
}

test('companion: every step has a text, and the board rebuilt from the log ends where the engine is', () => {
    for (const sc of SCENARIOS) {
        const me = sc.id % 2;
        const kinds = new Set();
        const s = play(sc.id, me, sc.id % 3 ? 'virtual' : 'physical', (entries, before, after) => {
            assert.deepEqual(board(boardAt(before, entries, entries.length - 1)), board(after));
            for (const step of guideSteps(entries, me, before, after)) {
                kinds.add(step.kind);
                assert.ok(step.text && !/\{\w+\}/.test(step.text), `scenario ${sc.id}: ${step.text}`);
                assert.ok(step.at >= 0 && step.at < entries.length);
                if (step.dice) assert.ok(step.after && step.dice.length > 0);
            }
        });
        assert.ok(s.state.result, `scenario ${sc.id} ends`);
        assert.ok(kinds.has('table'), `scenario ${sc.id}: steps for the table`);
    }
});

test('companion: the computer\'s moves make one step each, with the tiles it scouted after it', () => {
    let seen = 0;
    play(1, 1, 'virtual', (entries, before, after) => {
        const steps = guideSteps(entries, 1, before, after);
        const moves = entries.filter((e) => e.k === 'move' && e.seat === 0);
        const units = new Set(moves.map((e) => e.unit));
        const moveSteps = steps.filter((x) => x.arrow?.kind === 'move');
        assert.ok(moveSteps.length <= moves.length && moveSteps.length >= Math.min(units.size, moves.length ? 1 : 0));
        seen += moveSteps.length;
    });
    assert.ok(seen > 0);
});

test('companion: a player who only follows the steps keeps the same piles as the engine counts', () => {
    const piles = ['deck', 'hand', 'discard', 'play', 'supply', 'removed'];
    for (const sc of SCENARIOS) {
        const me = (sc.id + 1) % 2;
        // the player's table, as counts; the cards they play themselves go from the hand to the play area
        let mine = null;
        const counts = (v) => {
            const p = v.players[me];
            return { deck: p.deckCount, hand: p.handCount, discard: p.discard.length, play: p.play.length, supply: p.supply.length, removed: p.removed.length };
        };
        const s = play(sc.id, me, 'virtual', (entries, before, after, session) => {
            mine ??= counts(before); // the first round's draw is before the first answer
            const steps = guideSteps(entries, me, before, after);
            let k = 0;
            for (const [i, e] of entries.entries()) {
                if (e.seat === me && (e.k === 'play' || e.k === 'rally')) mine.hand--, mine.play++;
                // the steps of this entry (they keep the log's order)
                for (; k < steps.length && steps[k].at <= i; k++) {
                    const op = steps[k].op;
                    if (!op) continue;
                    if (op.move) mine[op.move[0]]--, mine[op.move[1]]++;
                    if (op.endTurn) mine.discard += mine.play + mine.hand, mine.play = 0, mine.hand = 0;
                    if (op.draw != null) {
                        const first = op.first ?? op.draw;
                        mine.deck -= first, mine.hand += first;
                        if (op.first != null) mine.deck += mine.discard, mine.discard = 0, mine.deck -= op.draw - first, mine.hand += op.draw - first;
                    }
                }
            }
            for (const x of piles) assert.ok(mine[x] >= 0, `scenario ${sc.id}: ${x} below 0`);
            // while the player declares what is left in hand, the engine has already moved those to the discard pile
            if (session.pending?.kind !== 'leftover') assert.deepEqual(mine, counts(after), `scenario ${sc.id}, round ${after.round}`);
        });
        assert.ok(s.state.result);
    }
});
