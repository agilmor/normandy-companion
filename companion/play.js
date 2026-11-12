// The companion's game screen (docs/02 §7.3): the map, and beside it one thing at a time: a step for the table
// ("move the German Riflemen A from 3A to 8B", "put your scouted marker on 5A") with "Done", or the player's
// decision with big buttons (the card they play and what it does, the tile, the target, hit or miss, where a
// casualty's card comes from). The computer plays its side through view(g, seat) only; the player's seat is
// external (src/engine, setup.external), so the app never sees their hand: it offers only what they may hold.
// Undo goes back to before the player's last answer; the game is saved after each one. On a phone the map zooms and
// pans (src/ui/zoom.js), a long press tells what is on a tile, and the menu folds into ☰.

import { h } from '../src/ui/dom.js';
import { t, tr } from '../src/i18n/index.js';
import { Session, makeRecord, encodeRecord } from '../src/engine/session.js';
import { CONTACT, bugMail, appKind } from './contact.js';
import { withoutRoundLimit } from '../src/engine/state.js';
import { TILES, hitChance, scenarioById, unitType } from '../src/engine/data.js';
import { computerBot } from '../src/ai/computerBot.js';
import { actionName, cardName, logLine, resultText, sideName, unitName } from '../src/ui/text.js';
import { diceTray } from '../src/ui/combat.js';
import { sfx, loadSamples } from '../src/ui/sound.js';
import { BoardZoom } from '../src/ui/zoom.js';
import { canFullscreen, isFullscreen, toggleFullscreen } from '../src/ui/touch.js';
import { coverText, drawMap, tileAtPoint } from './map.js';
import { boardAt, guideSteps } from './guide.js';
import { deckPanel } from './cards.js';

export const SAVE = 'unc-save';
const SIDES = ['us', 'de'];

export function loadSaved() {
    try {
        const g = JSON.parse(localStorage.getItem(SAVE));
        return g?.setup && Array.isArray(g.answers) ? g : null;
    } catch {
        return null;
    }
}

const pointsOf = (view, side) => Object.entries(view.objectives).reduce((n, [tile, v]) => n + (view.control[tile][side] === 'controlled' ? v : 0), 0);
const riflemenOn = (view, seat) => Object.values(view.units).filter((u) => u.seat === seat && u.tile && unitType(u.id)[0] === 'R').length;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A preference of the companion (unc-prefs, shared with the start screen). */
export function pref(key) {
    try {
        return JSON.parse(localStorage.getItem('unc-prefs'))?.[key];
    } catch {
        return undefined;
    }
}

function setPref(key, value) {
    try {
        localStorage.setItem('unc-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('unc-prefs') ?? '{}'), [key]: value }));
    } catch {}
}

export class CompanionView {
    /** @param {HTMLElement} root @param {{ setup: any, answers?: string[], marks?: number[] }} game */
    constructor(root, game, { onExit } = {}) {
        this.root = root;
        this.onExit = onExit;
        this.session = new Session(withoutRoundLimit(game.setup), game.answers ?? []);
        this.me = this.session.setup.external;
        this.botSeat = 1 - this.me;
        this.sc = scenarioById(this.session.setup.scenario);
        this.bot = computerBot(this.sc.id, this.botSeat, `${this.session.setup.seed}:bot`);
        this.marks = game.marks ?? []; // answers.length before each of the player's answers (undo)
        this.steps = [];
        this.sel = null; // the card chosen in a "play" decision, before its action
        this.busy = false;
        this.modal = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.modal) this.hideModal(); } });
        this.top = h('header', { class: 'bar' });
        // the map's frame outlives every render: the zoom stays while the map is redrawn
        this.zoom = new BoardZoom({ onInfo: (x, y) => this.showTile(x, y), tapAgain: (pick) => t('touch.tapAgain', { what: this.labelOf(pick) }), resetLabel: t('board.reset') });
        this.panel = h('aside', { class: 'panel' });
        this.root.replaceChildren(h('div', { class: 'cplay' }, this.top, h('main', {}, this.zoom.el, this.panel), this.modal));
        loadSamples();
        // leaving full screen with Back or Esc changes the menu's label too
        this.onFullscreen = () => { if (!this.disposed) this.renderTop(this.view()); };
        for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, this.onFullscreen);
        // a new game starts with the steps of its first round (draw your cards); a saved one where it was
        if (!game.answers?.length) this.steps = this.stepsOf(this.session.state.log, this.view());
        this.runBot(0, null);
    }

    dispose() {
        this.disposed = true;
        for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(ev, this.onFullscreen);
    }

    view() {
        return this.session.view(this.me);
    }

    save() {
        try {
            localStorage.setItem(SAVE, JSON.stringify({ setup: this.session.setup, answers: this.session.answers, marks: this.marks }));
        } catch {}
    }

    /** The player's answer: then the computer plays until the player's next decision; their steps go first. */
    act(answer) {
        if (this.busy || this.disposed) return;
        const before = this.view();
        const logStart = this.session.state.log.length;
        this.marks.push(this.session.answers.length);
        this.sel = null;
        this.session.act(answer);
        this.runBot(logStart, before);
    }

    async runBot(logStart, before) {
        this.busy = true;
        this.render();
        while (!this.session.over && this.session.pending?.seat === this.botSeat) {
            await tick(30); // let the page show that the computer is thinking
            if (this.disposed) return;
            const req = this.session.pending;
            this.session.act(this.bot(req, this.session.view(this.botSeat)));
        }
        this.busy = false;
        const entries = this.session.state.log.slice(logStart);
        if (logStart > 0 || before) this.steps.push(...this.stepsOf(entries, before));
        this.save();
        this.render();
    }

    /** The steps of these log entries, each with the board as it stands after it. */
    stepsOf(entries, before) {
        const base = before ?? this.view();
        return guideSteps(entries, this.me, before, this.view())
            .map((step) => ({ ...step, board: boardAt(base, entries, step.at ?? entries.length - 1) }));
    }

    undo() {
        if (this.busy || !this.marks.length) return;
        this.session.rewindTo(this.marks.pop());
        this.steps = [];
        this.sel = null;
        this.save();
        this.render();
    }

    exit() {
        this.dispose();
        this.onExit?.();
    }

    // ------------------------------------------------------------------ drawing

    render() {
        if (this.disposed) return;
        const view = this.view();
        this.renderTop(view);
        const step = this.steps[0];
        const req = !step && !this.busy && !this.session.over ? this.session.pending : null;
        const picks = new Map();
        let arrow = null, focus = {};
        if (step) {
            focus = step.focus ?? {};
            arrow = step.arrow ?? null;
        } else if (req) {
            this.picksFor(req, picks);
            if (req.kind === 'roll') arrow = req.attack === 'blast' ? null : { from: req.unit, to: req.target, kind: 'attack', side: SIDES[req.attacker] };
            if (req.kind === 'roll' || req.kind === 'casualty') focus = { unit: req.target ?? req.unit };
            if (req.kind === 'move') focus = { unit: req.unit };
        }
        this.shown = step?.board ?? view;
        this.zoom.show(drawMap(this.shown, { picks, onPick: (id) => this.pick(id), viewer: this.me, focus, arrow, terrain: pref('terrain') !== false }));
        const main = step ? this.stepCard(step) : this.busy ? h('div', { class: 'card-box thinking' }, t('cmp.thinking'))
            : this.session.over ? this.endCard() : req ? this.askCard(req, view) : null;
        this.panel.replaceChildren(main ?? '', deckPanel(view, this.me), this.botPanel(view), this.logPanel(view));
    }

    renderTop(view) {
        const score = SIDES.map((side, seat) => {
            const win = this.sc.win[side];
            const who = seat === this.me ? `${sideName(seat)} (${t('cmp.you')})` : sideName(seat);
            return h('span', { class: `score ${side}` }, win.points ? t('cmp.score.points', { side: who, n: pointsOf(view, side), need: win.points })
                : t('cmp.score.pin', { side: who, n: riflemenOn(view, 1 - seat) }));
        });
        this.top.replaceChildren(
            h('strong', {}, `${this.sc.id}. ${tr(this.sc.title)}`),
            h('span', { class: 'muted' }, t('cmp.round', { n: Math.max(1, view.round) })),
            h('span', { class: `ini ${SIDES[view.initiative]}` }, t('cmp.initiative', { side: sideName(view.initiative) })),
            ...score,
            h('span', { class: 'grow' }),
            h('button', { onclick: () => this.undo(), disabled: this.busy || !this.marks.length }, `↶ ${t('cmp.menu.undo')}`),
            h('span', { class: 'extras' }, this.menuItems().map(([label, fn]) => h('button', { onclick: fn }, label))),
            h('button', { class: 'menu-btn', title: t('cmp.menu'), onclick: () => this.showMenu() }, '☰'));
    }

    /** What the bar offers beside Undo; on a phone it goes behind ☰. */
    menuItems() {
        return [
            [t('cmp.menu.check'), () => this.showCheck()],
            [t(pref('dice3d') === false ? 'ui.diceOff' : 'ui.diceOn'), () => {
                setPref('dice3d', pref('dice3d') === false);
                this.render();
                if (!this.modal.hidden) this.showMenu();
            }],
            // in a phone's browser; the Android app is already full screen, iPhone's Safari does not allow it
            canFullscreen() ? [t(isFullscreen() ? 'ui.exitFullscreen' : 'ui.fullscreen'), () => {
                this.hideModal();
                toggleFullscreen();
            }] : null,
            [t('cmp.menu.code'), () => this.copyCode()],
            CONTACT ? [t('cmp.bug'), () => this.reportBug()] : null,
            [t('cmp.menu.exit'), () => this.exit()],
        ].filter(Boolean);
    }

    showMenu() {
        this.showModal(h('div', { class: 'opts' }, this.menuItems().map(([label, fn]) => h('button', { class: 'opt', onclick: fn }, label)),
            h('button', { class: 'opt quiet', onclick: () => this.hideModal() }, t('cmp.close'))));
    }

    /** One step for the table; an attack by the computer rolls its dice first. */
    stepCard(step) {
        const n = this.steps.length;
        const done = () => {
            this.steps.shift();
            this.render();
        };
        /** The text with the computer's card and action in bold and in its side's colour. */
        const marked = (text) => {
            const i = step.played ? text.indexOf(step.played) : -1;
            if (i < 0) return text;
            return [text.slice(0, i), h('strong', { class: `played ${step.side}` }, step.played), text.slice(i + step.played.length)];
        };
        const box = h('div', { class: `card-box step ${step.kind} ${step.side}` },
            step.head ? h('div', { class: 'head' }, marked(step.head)) : null,
            h('p', { class: 'big' }, marked(step.text)),
            step.lines?.length ? h('ul', {}, step.lines.map((l) => h('li', {}, l))) : null);
        const result = h('p', { class: `result ${step.hit ? 'hit' : 'miss'}` });
        const buttons = h('div', { class: 'buttons' },
            h('button', { class: 'primary', onclick: done }, t('cmp.done')),
            n > 1 ? h('button', { onclick: () => { this.steps = []; this.render(); } }, t('cmp.doneAll', { n })) : null);
        if (step.after) {
            box.append(result);
            if (step.dice && !step.rolled) {
                buttons.hidden = true;
                this.rollDice(step).then(() => {
                    step.rolled = true;
                    result.textContent = step.after;
                    buttons.hidden = false;
                });
            } else result.textContent = step.after;
        }
        box.append(buttons);
        return box;
    }

    async rollDice(step) {
        sfx.dice();
        const tray = pref('dice3d') === false ? null : await diceTray();
        if (tray) {
            const roll = tray.roll(step.dice.map((value) => ({ sides: 10, value, color: step.side })), { rect: this.zoom.el.getBoundingClientRect() });
            if (await Promise.race([roll.then(() => false), tick(6000).then(() => true)])) tray.skip();
        } else await tick(400);
        (step.hit ? sfx.impact : () => sfx.miss(step.dice.length))();
    }

    endCard() {
        const r = this.session.state.result;
        const title = r.winner == null ? t('cmp.end.draw') : r.winner === this.me ? t('cmp.end.won') : t('cmp.end.lost');
        return h('div', { class: 'card-box end' }, h('h2', {}, title), h('p', {}, resultText(r)),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => { try { localStorage.removeItem(SAVE); } catch {} this.exit(); } }, t('cmp.end.again'))));
    }

    picksFor(req, picks) {
        for (const o of req.options) {
            if (o.id.startsWith('tile:')) picks.set(o.id, o.id);
            else if (o.id.startsWith('unit:')) picks.set(o.id, o.id);
        }
        if (req.kind === 'play' && !this.sel) {
            // a counter of the player opens the card of its unit
            for (const o of req.options) {
                if (!o.card) continue;
                const uid = `${SIDES[this.me]}:${o.card}`;
                if (this.session.state.units[uid]?.tile) picks.set(`unit:${uid}`, `sel:${o.card}`);
            }
        }
    }

    pick(id) {
        if (id.startsWith('sel:')) {
            this.sel = id.slice(4);
            this.render();
            return;
        }
        this.act(id);
    }

    /** The player's decision. */
    askCard(req, view) {
        const un = (uid) => unitName(uid, this.me);
        const btn = (o, label, cls = '') => h('button', { class: `opt ${cls}`, onclick: () => this.act(o.id) }, label);
        const box = (title, ...rest) => h('div', { class: `card-box ask ${req.kind}` }, h('h3', {}, title), ...rest);
        const hint = req.options.some((o) => o.id.startsWith('tile:') || o.id.startsWith('unit:')) ? h('p', { class: 'small muted' }, t('cmp.pickOnMap')) : null;
        switch (req.kind) {
            case 'bid': {
                const opts = [...req.options].sort((a, b) => b.initiative - a.initiative);
                return box(t('cmp.ask.bid'), h('p', {}, t('cmp.ask.bidText')), view.players[this.botSeat].bidding ? h('p', { class: 'small muted' }, t('cmp.ask.bidBot')) : null,
                    h('div', { class: 'opts grid' }, opts.map((o) => btn(o, t('cmp.ask.bidOpt', { card: cardName(o.card), n: o.initiative })))));
            }
            case 'play':
                return this.playCard(req, view);
            case 'move':
                return box(t('cmp.ask.move', { unit: un(req.unit), step: req.step, of: req.of }), hint,
                    h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, o.id === 'stop' ? t('opt.stop') : o.tile, o.id === 'stop' ? 'quiet' : ''))));
            case 'guide':
                return box(t('cmp.ask.guide'), hint, h('div', { class: 'opts' }, req.options.map((o) => btn(o, `${un(o.unit)} (${o.tile})`))));
            case 'attack':
            case 'suppress':
                return box(t(`cmp.ask.${req.kind}`, { unit: un(req.unit) }), hint, h('div', { class: 'opts' }, req.options.map((o) =>
                    btn(o, t('cmp.ask.target.opt', { ...o, unit: un(o.unit), pct: Math.round(100 * hitChance(o.total, o.dice)) })))));
            case 'target':
                return box(t('cmp.ask.target'), hint, h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, o.tile))));
            case 'bolster':
            case 'inspire':
                return box(t(`cmp.ask.${req.kind}`, { left: req.left }), h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.id === 'done' ? t('opt.done') : cardName(o.card), o.id === 'done' ? 'quiet' : ''))));
            case 'leftover':
                return box(t('cmp.ask.leftover', { left: req.left }), h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, cardName(o.card)))));
            case 'casualty':
                return box(t('cmp.ask.casualty', { unit: un(req.unit) }), h('p', { class: 'small' }, t('cmp.ask.casualtyRule')),
                    h('div', { class: 'opts' }, req.options.map((o) => btn(o, t(`cmp.ask.from.${o.from}`)))));
            case 'roll':
                return this.rollCard(req, btn);
            default:
                return box(req.kind, h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.tile ?? o.card ?? o.id))));
        }
    }

    playCard(req, view) {
        const p = view.players[this.me];
        const btn = (o, label, cls = '') => h('button', { class: `opt ${cls}`, onclick: () => this.act(o.id) }, label);
        const end = req.options.find((o) => o.id === 'end');
        const cards = [...new Set(req.options.filter((o) => o.card).map((o) => o.card))];
        if (this.sel && cards.includes(this.sel)) {
            const own = req.options.filter((o) => o.card === this.sel);
            const label = (o) => (o.action === 'hunker' ? t('opt.hunker') : o.action === 'rally' ? t('opt.rally') : actionName(o.action, o.value, o.squad));
            return h('div', { class: 'card-box ask play' }, h('h3', {}, t('cmp.ask.playCard', { card: cardName(this.sel) })),
                h('div', { class: 'opts' }, own.map((o) => btn(o, label(o), o.action === 'hunker' ? 'quiet' : ''))),
                h('div', { class: 'buttons' }, h('button', { onclick: () => { this.sel = null; this.render(); } }, `← ${t('cmp.back')}`)));
        }
        const where = (type) => this.session.state.units[`${SIDES[this.me]}:${type}`]?.tile;
        return h('div', { class: 'card-box ask play' }, h('h3', {}, t('cmp.ask.play')),
            h('p', { class: 'small muted' }, t('cmp.ask.playHand', { n: p.handCount })),
            h('div', { class: 'opts grid' }, cards.map((type) => h('button', { class: 'opt card-opt', onclick: () => { this.sel = type; this.render(); } },
                h('b', {}, cardName(type)), where(type) ? h('span', { class: 'small' }, ` · ${where(type)}`) : null))),
            end ? h('div', { class: 'buttons' }, btn(end, t('cmp.ask.end'), 'quiet')) : null);
    }

    rollCard(req, btn) {
        const un = (uid) => unitName(uid, this.me);
        const mine = req.attacker === this.me;
        const need = req.total <= 1 ? t('cmp.roll.sure') : req.total >= 10 ? t('cmp.roll.needZero') : t('cmp.roll.need', { total: req.total });
        const sum = t(req.attack === 'blast' ? 'cmp.roll.sumBlast' : 'cmp.roll.sum', req);
        return h('div', { class: `card-box ask roll ${SIDES[req.attacker]}` },
            h('h3', {}, t(mine ? 'cmp.roll.title' : 'cmp.roll.botTitle', { n: req.dice })),
            h('p', {}, `${actionName(req.attack)}: ${t('cmp.roll.what', { unit: un(req.unit), target: un(req.target) })}`),
            h('p', { class: 'need' }, req.total <= 1 ? '✓' : req.total >= 10 ? '0' : `${req.total}+`),
            h('p', { class: 'big' }, need),
            h('p', { class: 'small muted' }, sum),
            h('div', { class: 'opts two' }, req.options.map((o) => btn(o, t(`cmp.roll.${o.id}`), o.id))));
    }

    botPanel(view) {
        const p = view.players[this.botSeat];
        const groups = (cards) => {
            const n = {};
            for (const c of cards) n[c.split(':')[1]] = (n[c.split(':')[1]] ?? 0) + 1;
            return Object.entries(n).map(([type, k]) => `${cardName(type)}${k > 1 ? ` ×${k}` : ''}`).join(', ') || t('cmp.check.none');
        };
        return h('details', { class: 'info bot' }, h('summary', {}, `${sideName(this.botSeat)} (${t('cmp.bot')}) · ${t('game.handCount', { n: p.handCount })} · ${t('game.deck', { n: p.deckCount })}`),
            h('p', { class: 'small' }, h('b', {}, `${t('game.discardPile')}: `), groups(p.discard)),
            h('p', { class: 'small' }, h('b', {}, `${t('game.supply')}: `), groups(p.supply)));
    }

    logPanel(view) {
        const lines = view.log.slice(-60).map((e) => h('li', { class: e.k === 'round' ? 'round' : '' }, logLine(e, this.me)));
        return h('details', { class: 'info log' }, h('summary', {}, t('cmp.menu.log')), h('ol', {}, lines.reverse()));
    }

    // ------------------------------------------------------------------ the check and the code

    /** What is on a tile, as text: its units and its markers. */
    tileContents(tile, view) {
        const units = Object.values(view.units).filter((u) => u.tile === tile).map((u) => `${unitName(u.id, this.me)}${u.suppressed ? ` (${t('cmp.map.suppressed')})` : ''}`);
        const marks = [];
        for (const [seat, side] of SIDES.entries()) {
            const c = view.control[tile][side];
            if (c) marks.push(t(`cmp.check.${c}`, { side: sideName(seat) }));
            if (view.targets[seat] === tile) marks.push(t('cmp.check.target', { side: sideName(seat) }));
        }
        if (view.objectives[tile]) marks.push(t('cmp.check.objective', { n: view.objectives[tile] }));
        return { units: units.join(', ') || t('cmp.check.none'), marks: marks.join(', ') || t('cmp.check.none') };
    }

    /** A long press on the map: what is on that tile. */
    showTile(x, y) {
        const tile = tileAtPoint(this.sc, x, y);
        if (!tile) return;
        const { units, marks } = this.tileContents(tile, this.shown);
        this.showModal(h('div', { class: 'check' },
            h('h3', {}, `${tile} · ${t('cmp.map.cover')} ${coverText(TILES[tile].cover)}`),
            h('p', {}, h('b', {}, `${t('cmp.check.units')}: `), units),
            h('p', {}, h('b', {}, `${t('cmp.check.markers')}: `), marks),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.hideModal() }, t('cmp.close')))));
    }

    /** The name of a map pick, for "tap again to confirm". */
    labelOf(pick) {
        return pick.startsWith('unit:') ? unitName(pick.slice(5), this.me) : pick.slice(pick.indexOf(':') + 1);
    }

    showCheck() {
        const view = this.view();
        const rows = this.sc.tiles.map((tile) => {
            const { units, marks } = this.tileContents(tile.id, view);
            return h('tr', {}, h('td', {}, h('b', {}, tile.id)), h('td', {}, units), h('td', {}, marks));
        });
        const off = Object.values(view.units).filter((u) => !u.tile).map((u) => unitName(u.id, this.me));
        this.showModal(h('div', { class: 'check' },
            h('h3', {}, t('cmp.check.title')),
            h('p', { class: 'small' }, t('cmp.check.intro')),
            h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('cmp.check.tile')), h('th', {}, t('cmp.check.units')), h('th', {}, t('cmp.check.markers')))), h('tbody', {}, rows)),
            off.length ? h('p', { class: 'small' }, h('b', {}, `${t('cmp.check.offBoard')}: `), off.join(', ')) : null,
            deckPanel(view, this.me, { open: true }),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.hideModal() }, t('cmp.close')))));
    }

    async copyCode() {
        const code = await encodeRecord(makeRecord(this.session, 'companion'));
        try {
            await navigator.clipboard.writeText(code);
            this.toast(t('cmp.menu.codeCopied'));
        } catch {
            this.showModal(h('div', {}, h('textarea', { rows: 6, cols: 40, readonly: true }, code),
                h('div', { class: 'buttons' }, h('button', { onclick: () => this.hideModal() }, t('cmp.close')))));
        }
    }

    /** An email to report a bug, with the game's code: in the body, or by the clipboard when it is too long. */
    async reportBug() {
        const code = await encodeRecord(makeRecord(this.session, 'companion'));
        const mail = bugMail(CONTACT, { code, app: appKind(), agent: navigator.userAgent });
        if (mail.clipboard) {
            try {
                await navigator.clipboard.writeText(code);
                this.toast(t('cmp.bug.copied'));
            } catch {}
        }
        h('a', { href: mail.url }).click();
    }

    toast(text) {
        const el = h('div', { class: 'toast' }, text);
        document.body.append(el);
        setTimeout(() => el.remove(), 2200);
    }

    showModal(content) {
        this.modal.replaceChildren(h('div', { class: 'modal-box' }, content));
        this.modal.hidden = false;
        // a step of the page's history, so that Back closes it and does not leave the game
        if (!history.state?.modal) history.pushState({ game: true, modal: true }, '');
    }

    hideModal() {
        if (history.state?.modal) history.back(); // popstate closes it
        else this.closeModal();
    }

    closeModal() {
        this.modal.hidden = true;
        this.modal.replaceChildren();
    }
}
