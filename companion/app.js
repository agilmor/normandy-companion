// The companion's start screen (docs/02 §7): the notice that it needs the physical game, the scenario with our own
// map and objectives, the player's side, who rolls the computer's dice and the control rule; then the game
// (play.js). Credits to the designers and the publisher; nothing of the game's art, rules or scenario texts.

import { h } from '../src/ui/dom.js';
import { t, tr, setLang, getLang } from '../src/i18n/index.js';
import { SCENARIOS } from '../src/engine/data.js';
import { createState, normalizeSetup } from '../src/engine/state.js';
import { view } from '../src/engine/view.js';
import { decodeRecord, replayRecord } from '../src/engine/session.js';
import { cardName, sideName } from '../src/ui/text.js';
import { drawMap } from './map.js';
import { CompanionView, loadSaved } from './play.js';
import { warmDice } from '../src/ui/combat.js';

const root = document.getElementById('app');
const PREFS = 'unc-prefs';
const SIDES = ['us', 'de'];

function prefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS)) ?? {};
    } catch {
        return {};
    }
}

function savePrefs(p) {
    try {
        localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...p }));
    } catch {}
}

setLang(new URLSearchParams(location.search).get('lang') ?? prefs().lang ?? (navigator.language?.startsWith('es') ? 'es' : 'en'));
document.documentElement.lang = getLang();

/** "Riflemen A ×4, Scout A" from { RA: 4, SA: 1 }. */
const cardList = (counts) => Object.entries(counts).map(([type, n]) => `${cardName(type)}${n > 1 ? ` ×${n}` : ''}`).join(', ');

/** The objectives, in our own words, from the win conditions. */
export function goals(sc, seat) {
    const win = sc.win[SIDES[seat]];
    return win.points ? t('cmp.goal.points', { n: win.points }) : t('cmp.goal.pin', { other: sideName(1 - seat) });
}

function setupScreen() {
    const p = prefs();
    let scenario = p.scenario ?? 1;
    let side = p.side ?? 0;
    let botDice = p.botDice ?? 'virtual';
    let controlRule = p.controlRule ?? 'normandy';
    let terrain = p.terrain !== false;
    const info = h('div', { class: 'scen-info' });
    const showInfo = () => {
        const sc = SCENARIOS.find((x) => x.id === scenario);
        const preview = view(createState(normalizeSetup({ scenario })), side);
        const cards = sc.cards[SIDES[side]];
        info.replaceChildren(
            h('div', { class: 'scen-text' },
                h('h3', {}, `${sc.id}. ${tr(sc.title)}`),
                h('p', {}, t('cmp.goal.initiative', { side: sideName(SIDES.indexOf(sc.initiative)) })),
                h('h4', {}, t('cmp.goal.title')),
                h('ul', {}, [0, 1].map((s) => h('li', {}, h('b', {}, `${sideName(s)}${s === side ? ` (${t('cmp.you')})` : ''}: `), goals(sc, s)))),
                sc.bothPinned ? h('p', { class: 'small muted' }, t('cmp.goal.bothPinned')) : null,
                h('p', {}, t('cmp.setup.mount', { n: sc.id })),
                h('h4', {}, t('cmp.setup.yourCards', { side: sideName(side) })),
                h('p', { class: 'small' }, t('cmp.setup.deck', { cards: cardList(cards.deck) })),
                h('p', { class: 'small' }, t('cmp.setup.supply', { cards: cardList(cards.supply) })),
                h('p', { class: 'small muted' }, t('cmp.setup.botCards', { side: sideName(1 - side) }))),
            h('div', { class: 'scen-map' }, drawMap(preview, { viewer: side, terrain })));
    };
    const select = h('select', { onchange: (e) => { scenario = Number(e.target.value); showInfo(); } },
        SCENARIOS.map((sc) => h('option', { value: sc.id, selected: sc.id === scenario }, `${sc.id}. ${tr(sc.title)}`)));
    const sideSel = h('select', { onchange: (e) => { side = Number(e.target.value); showInfo(); } },
        [0, 1].map((s) => h('option', { value: s, selected: s === side }, sideName(s))));
    const dice = h('select', { onchange: (e) => (botDice = e.target.value) },
        ['virtual', 'physical'].map((v) => h('option', { value: v, selected: v === botDice }, t(`cmp.setup.botDice.${v}`))));
    const mapSel = h('select', { onchange: (e) => { terrain = e.target.value === 'terrain'; savePrefs({ terrain }); showInfo(); } },
        ['terrain', 'diagram'].map((v) => h('option', { value: v, selected: (v === 'terrain') === terrain }, t(`cmp.setup.map.${v}`))));
    const ruleHelp = h('span', { class: 'small muted' });
    const showRule = () => (ruleHelp.textContent = t(`setup.controlRule.${controlRule}.help`));
    const rule = h('select', { onchange: (e) => { controlRule = e.target.value; showRule(); } },
        ['normandy', 'northAfrica'].map((v) => h('option', { value: v, selected: controlRule === v }, t(`setup.controlRule.${v}`))));
    showRule();
    const code = h('input', { placeholder: 'UNN1.…', size: 18 });
    const err = h('span', { class: 'error small' });
    const saved = loadSaved();
    showInfo();
    root.replaceChildren(h('div', { class: 'setup' },
        h('header', { class: 'bar' }, h('strong', {}, t('cmp.title')), h('span', { class: 'muted sub' }, t('cmp.subtitle')), h('span', { class: 'grow' }),
            h('button', { onclick: () => { const l = getLang() === 'es' ? 'en' : 'es'; savePrefs({ lang: l }); setLang(l); document.documentElement.lang = l; setupScreen(); } }, t('cmp.lang'))),
        h('p', { class: 'notice' }, t('cmp.notice')),
        h('div', { class: 'setup-body' },
            h('div', { class: 'form' },
                h('label', {}, t('cmp.setup.scenario'), select),
                h('label', {}, t('cmp.setup.side'), sideSel),
                h('label', {}, t('cmp.setup.botDice'), dice),
                h('label', {}, t('setup.controlRule'), rule, ruleHelp),
                h('label', {}, t('cmp.setup.map'), mapSel),
                h('button', { class: 'primary', onclick: () => {
                    savePrefs({ scenario, side, botDice, controlRule });
                    start({ setup: { scenario, seed: Math.random().toString(36).slice(2, 10), controlRule, external: side, botDice } });
                } }, t('cmp.setup.start')),
                saved ? h('button', { onclick: () => start(saved) }, t('cmp.setup.continue')) : null,
                h('details', {}, h('summary', {}, t('cmp.setup.code')),
                    h('div', { class: 'row' }, code, h('button', { onclick: async () => {
                        try {
                            const rec = await decodeRecord(code.value);
                            if (rec.setup.external == null) throw Object.assign(new Error(), { key: 'record.unknown' });
                            const r = replayRecord(rec);
                            if (r.failedAt != null) err.textContent = t('record.changed', { n: r.failedAt + 1 });
                            start({ setup: rec.setup, answers: r.session.answers });
                        } catch (e) {
                            err.textContent = e.key ? t(e.key) : e.message;
                        }
                    } }, t('cmp.setup.load'))), err)),
            info),
        h('footer', { class: 'credits small muted' }, t('cmp.credits'))));
}

// a game is a step of the page's history: Back returns to the start screen, with the game saved
let current = null;

function start(game) {
    if (!history.state?.game) history.pushState({ game: true }, '');
    current = new CompanionView(root, game, { onExit: leave });
}

function leave() {
    current = null;
    if (history.state?.game) history.back();
    setupScreen();
}

window.addEventListener('popstate', () => {
    if (!current || history.state?.game) return;
    current.dispose();
    current = null;
    setupScreen();
});

if (history.state) history.replaceState(null, '');
setupScreen();
if (prefs().dice3d !== false) warmDice();

