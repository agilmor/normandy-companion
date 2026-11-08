// Random bot: any legal option, but it prefers acting to ending the turn or hunkering down. For testing the engine.

import { seedFrom } from '../engine/rng.js';

export function randomBot(seed) {
    const g = { rng: seedFrom(seed) };
    let t = g.rng;
    const rand = () => {
        t = (t + 0x6d2b79f5) >>> 0;
        let x = Math.imul(t ^ (t >>> 15), t | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    return (req) => {
        let opts = req.options;
        if (req.kind === 'play') {
            const acts = opts.filter((o) => o.id.startsWith('act:') || o.id.startsWith('rally:'));
            if (acts.length && rand() < 0.9) opts = acts;
        }
        return opts[Math.floor(rand() * opts.length)].id;
    };
}
