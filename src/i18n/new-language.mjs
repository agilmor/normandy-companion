#!/usr/bin/env node
// Starts a translation, or checks one (README, "Translating the companion"):
//
//     node src/i18n/new-language.mjs it Italiano     # writes src/i18n/lang/it.js with the English texts, and lists it
//     node src/i18n/new-language.mjs --check it      # what is missing or wrong in lang/it.js
//
// A language file has its code, its name (in that language), the credit line, the names of the cards, the units and
// the scenarios, and every text of the interface. Card, unit and scenario names must be the ones printed in the
// official edition of the game in that language: the player reads them with the cards in hand.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import en from './en.js';
import * as companion from './companion.js';
import { TYPES, UNITS, SCENARIOS } from '../engine/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Texts of the private digital version, not part of the companion (absent from the public repository). */
const PRIVATE = /^(app|help|catalog)\./;
const cardKey = (type) => type.replace(/[ABC]$/, '');
const scKey = (sc) => `s${String(sc.id).padStart(2, '0')}`;

/** The English model: what every language file must have. */
export function model() {
    const texts = Object.fromEntries(Object.entries({ ...en, ...companion.en }).filter(([k]) => !PRIVATE.test(k)));
    const cards = {};
    for (const [type, c] of Object.entries(TYPES)) cards[cardKey(type)] = c.name.en;
    const units = Object.fromEntries(Object.entries(UNITS).map(([k, u]) => [k, u.name.en]));
    const scenarios = Object.fromEntries(SCENARIOS.map((sc) => [scKey(sc), sc.title.en]));
    return { texts, cards, units, scenarios };
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const entry = (k, v) => `        ${/^[A-Za-z_]\w*$/.test(k) ? k : quote(k)}: ${typeof v === 'function' ? v.toString() : quote(v)},`;

/** The source of a new language file, with the English texts in place to be translated. */
export function starter(code, name) {
    const m = model();
    const block = (obj) => Object.entries(obj).map(([k, v]) => entry(k, v)).join('\n');
    return `// ${name} (${code}): texts of Normandy Companion. Translate the strings and keep the keys, the {placeholders}
// and the code of the few functions (plurals). Card, unit and scenario names: exactly as printed in the official
// edition of the game in this language. Check with: node src/i18n/new-language.mjs --check ${code}

export default {
    code: ${quote(code)},
    name: ${quote(name)},
    credit: ${quote(`${name} translation: your name`)},

    // the cards (the squads A, B and C share one name)
    cards: {
${block(m.cards)}
    },

    // the counters, as on the map ("Riflemen A")
    units: {
${block(m.units)}
    },

    // the scenario titles, as in the scenario book
    scenarios: {
${block(m.scenarios)}
    },

    texts: {
${block(m.texts)}
    },
};
`;
}

/**
 * A language file against the English model: `errors` (wrong code, extra keys, broken placeholders or plurals) and
 * `missing` (texts not translated yet, shown in English meanwhile: new texts land in English first).
 */
export function checkLanguage(l) {
    const m = model();
    const out = [];
    const missing = [];
    if (!/^[a-z]{2,3}(-[a-z]{2})?$/.test(l.code ?? '')) out.push(`code "${l.code}": two or three lowercase letters (pt-br for a variant)`);
    if (['es', 'en'].includes(l.code)) out.push(`code "${l.code}" is already built in`);
    for (const f of ['name', 'credit']) if (typeof l[f] !== 'string' || !l[f].trim()) out.push(`${f} is missing`);
    for (const part of ['cards', 'units', 'scenarios', 'texts']) {
        const have = l[part] ?? {};
        for (const k of Object.keys(m[part])) if (!(k in have)) missing.push(`${part}: "${k}"`);
        for (const k of Object.keys(have)) if (!(k in m[part])) out.push(`${part}: "${k}" is not used by the companion`);
        for (const [k, v] of Object.entries(have)) {
            const ref = m[part][k];
            if (ref === undefined) continue;
            if (typeof ref === 'function') {
                if (typeof v !== 'function') { out.push(`${part}: "${k}" must be a function, like the English one`); continue; }
                try {
                    if (typeof v(new Proxy({}, { get: () => 2 })) !== 'string') out.push(`${part}: "${k}" must return a string`);
                } catch (e) {
                    out.push(`${part}: "${k}" fails: ${e.message}`);
                }
                continue;
            }
            if (typeof v !== 'string' || !v.trim()) { out.push(`${part}: "${k}" is empty`); continue; }
            const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
            if (ph(v) !== ph(ref)) {
                out.push(ph(ref) ? `${part}: "${k}" must keep the placeholders {${ph(ref).split(',').join('}, {')}}` : `${part}: "${k}" must not have {placeholders}`);
            }
        }
    }
    return { errors: out, missing };
}

/** Imports the new file in lang/index.js and adds it to the list there. */
function register(code) {
    const file = join(HERE, 'lang/index.js');
    const id = code.replace('-', '_');
    const src = readFileSync(file, 'utf8');
    if (src.includes(`'./${code}.js'`)) return;
    const lines = src.split('\n');
    const at = lines.findIndex((l) => l.startsWith('export default ['));
    const names = lines[at].slice('export default ['.length, lines[at].lastIndexOf(']')).split(',').map((s) => s.trim()).filter(Boolean);
    lines[at] = `export default [${[...names, id].join(', ')}];`;
    const lastImport = lines.findLastIndex((l) => l.startsWith('import '));
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, `import ${id} from './${code}.js';`);
    else lines.splice(at, 0, `import ${id} from './${code}.js';`, '');
    writeFileSync(file, lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args[0] === '--check') {
        const code = args[1];
        const { default: l } = await import(pathToFileURL(join(HERE, `lang/${code}.js`)).href);
        const { errors, missing } = checkLanguage(l);
        if (errors.length) console.log(`To fix:\n  ${errors.join('\n  ')}`);
        if (missing.length) console.log(`To translate (shown in English meanwhile):\n  ${missing.join('\n  ')}`);
        if (!errors.length && !missing.length) console.log(`lang/${code}.js: complete`);
        process.exitCode = errors.length || missing.length ? 1 : 0;
    } else if (args.length === 2) {
        const [code, name] = args;
        const file = join(HERE, `lang/${code}.js`);
        if (existsSync(file)) throw new Error(`lang/${code}.js already exists`);
        writeFileSync(file, starter(code, name));
        register(code);
        console.log(`wrote src/i18n/lang/${code}.js and listed it in src/i18n/lang/index.js`);
    } else {
        console.log('usage: node src/i18n/new-language.mjs <code> <name>  |  --check <code>');
        process.exitCode = 2;
    }
}
