// Interface languages (docs/02 §2.5). Texts live in es.js / en.js as flat keys; data files carry { es, en } pairs.
import es from './es.js';
import en from './en.js';
import * as companion from './companion.js';

const DICTS = { es: { ...es, ...companion.es }, en: { ...en, ...companion.en } };
export const LANGS = ['es', 'en'];
let lang = 'es';

export function setLang(l) {
    if (DICTS[l]) lang = l;
    return lang;
}

export function getLang() {
    return lang;
}

/**
 * t('catalog.faces', { n: 6 }) — {name} placeholders; a function entry gets the params (plurals).
 * Falls back to Spanish, then to the key itself, so a missing text is visible instead of blank.
 */
export function t(key, params = {}) {
    const s = DICTS[lang][key] ?? DICTS.es[key] ?? key;
    if (typeof s === 'function') return s(params);
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
}

/** Pick the active language from a data pair such as region.name = { es, en }. */
export function tr(pair) {
    return pair?.[lang] ?? pair?.es ?? '';
}

export const dictionaries = DICTS;
