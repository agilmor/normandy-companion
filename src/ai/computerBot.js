// The "Computer" player: the planning bot (planBot.js), or the heuristic one where it still plays that side of that
// scenario better. The choice lives in the scenario file, `"bot": { "us": "heuristic" }`, measured with
// `node tools/arena.mjs --bots plan,heuristic` (docs/02 §5.3). A scenario without it uses the planner on both sides.

import { SIDES, scenarioById } from '../engine/data.js';
import { heuristicBot } from './heuristicBot.js';
import { planBot } from './planBot.js';

export const BOTS = { plan: planBot, heuristic: heuristicBot };

/** Which bot plays `seat` in `scenario` ('plan' or 'heuristic'). */
export const botFor = (scenario, seat) => scenarioById(scenario).bot?.[SIDES[seat]] ?? 'plan';

export function computerBot(scenario, seat, seed) {
    return BOTS[botFor(scenario, seat)](seed);
}
