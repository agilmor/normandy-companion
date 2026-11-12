// Interface languages (docs/02 §2.5). Spanish and English live in es.js / en.js (+ companion.js) as flat keys, and
// the data files carry { es, en } pairs. Any other language is one file in lang/ with its texts and the names of the
// cards, the units and the scenarios, which are added to those pairs here.
import es from './es.js';
import en from './en.js';
import * as companion from './companion.js';
import extra from './lang/index.js';
import { TYPES, UNITS, SCENARIOS } from '../engine/data.js';

const DICTS = { es: { ...es, ...companion.es }, en: { ...en, ...companion.en } };
/** Each language's name, in that language (the language menu). */
export const LANG_NAMES = { es: 'Español', en: 'English' };

/** The key of a card type in a language file: the squads share one name (SLA, SLB, SLC → SL; RA → R). */
export const cardKey = (type) => type.replace(/[ABC]$/, '');

for (const l of extra) {
    DICTS[l.code] = l.texts;
    LANG_NAMES[l.code] = l.name;
    for (const [type, c] of Object.entries(TYPES)) if (l.cards[cardKey(type)]) c.name[l.code] = l.cards[cardKey(type)];
    for (const [kind, u] of Object.entries(UNITS)) if (l.units[kind]) u.name[l.code] = l.units[kind];
    for (const sc of SCENARIOS) if (l.scenarios[`s${String(sc.id).padStart(2, '0')}`]) sc.title[l.code] = l.scenarios[`s${String(sc.id).padStart(2, '0')}`];
}

export const LANGS = Object.keys(DICTS);
/** The other languages' files (credits, tests). */
export const EXTRA_LANGS = extra;
let lang = 'es';

export function setLang(l) {
    if (DICTS[l]) lang = l;
    return lang;
}

export function getLang() {
    return lang;
}

/** The best language for a browser's list of preferred languages (navigator.languages), English if none. */
export function pickLang(preferred = []) {
    for (const p of preferred) {
        const l = String(p).toLowerCase();
        if (DICTS[l]) return l;
        if (DICTS[l.split('-')[0]]) return l.split('-')[0];
    }
    return 'en';
}

/**
 * t('catalog.faces', { n: 6 }) — {name} placeholders; a function entry gets the params (plurals).
 * Falls back to English, then Spanish, then to the key itself, so a missing text is visible instead of blank.
 */
export function t(key, params = {}) {
    const s = DICTS[lang][key] ?? DICTS.en[key] ?? DICTS.es[key] ?? key;
    if (typeof s === 'function') return s(params);
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
}

/** Pick the active language from a data pair such as region.name = { es, en }. */
export function tr(pair) {
    return pair?.[lang] ?? pair?.en ?? pair?.es ?? '';
}

export const dictionaries = DICTS;
