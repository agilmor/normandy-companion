// The "Computer" player: the planning bot (planBot.js), or the heuristic one where it still plays that side of that
// scenario better. The choice lives in the scenario file, `"bot": { "us": "heuristic" }`, measured with
// `node tools/arena.mjs --bots plan,heuristic` (docs/02 §5.3). A scenario without it uses the planner on both sides.
// A variant of the scenario can name its own (docs/02 §5.5).

import { SIDES, scenarioById } from '../engine/data.js';
import { heuristicBot } from './heuristicBot.js';
import { planBot } from './planBot.js';
import { assaultBot } from './assaultBot.js';

export const BOTS = { plan: planBot, heuristic: heuristicBot, assault: assaultBot };

/** Which bot plays `seat` in `scenario`, or in that variant of it (a key of BOTS). */
export function botFor(scenario, seat, variant) {
    const sc = scenarioById(scenario);
    return sc.variants?.[variant]?.bot?.[SIDES[seat]] ?? sc.bot?.[SIDES[seat]] ?? 'plan';
}

export function computerBot(scenario, seat, seed, variant) {
    return BOTS[botFor(scenario, seat, variant)](seed);
}
