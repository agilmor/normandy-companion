// Both languages have the same keys, and every log() key in the engine has a text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import es from '../src/i18n/es.js';
import en from '../src/i18n/en.js';
import * as companion from '../src/i18n/companion.js';

test('es and en have the same keys', () => {
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
    assert.deepEqual(Object.keys(companion.es).sort(), Object.keys(companion.en).sort());
});

test('every log() key in the engine has a text', () => {
    const src = readdirSync('src/engine').map((f) => readFileSync(`src/engine/${f}`, 'utf8')).join('\n');
    for (const k of new Set([...src.matchAll(/\blog\(g, '(\w+)'/g)].map((m) => m[1]))) assert.ok(`log.${k}` in es, `log.${k}`);
});
