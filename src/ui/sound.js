// Sound effects with the Web Audio API. From 58_World_War_Zed (itself from 48 via 51), with the weapons of Undaunted.
// The gunshots are recordings: The Free Firearm Sound Library (CC0, the licence beside them), cut to
// assets/sounds/fire/ by tools/build_sounds.py, one gun per side and kind (rifle, sniper, machine gun). They
// are fetched and decoded up front (loadSamples); until they are, or if one fails, a synthesised shot plays.
// Cards (a card sliding, a deck shuffled) are Kenney's Casino Audio (CC0), as in 48: assets/sounds/cards/.
// Everything else (the mortar's whistle and blast, dice, hits...) is synthesised. ☰ turns it all off.

let ctx = null;
let master = null;
let muted = false;

function audio() {
    if (muted) return null;
    if (!ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    if (!master) {
        master = ctx.createGain();
        master.gain.value = 0.3;
        master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/** 1..n */
function range(n) { return Array.from({ length: n }, (_, i) => i + 1); }

/** Recorded gunshots: a pool per side and kind (one is picked at random each time, slightly retuned), its volume. */
const POOLS = { rifle: { us: 4, de: 11, gain: 0.42 }, sniper: { us: 4, de: 11, gain: 0.6 }, mg: { us: 8, de: 10, gain: 0.45 } };
const SAMPLES = Object.fromEntries(Object.entries(POOLS).flatMap(([kind, p]) => ['us', 'de'].map((side) =>
    [`${side}-${kind}`, { files: range(p[side]).map((i) => `fire/${side}-${kind}-${i}.wav`), gain: p.gain }])));
SAMPLES.slide = { files: range(8).map((i) => `cards/card-slide-${i}.ogg`), gain: 0.55 };
SAMPLES.shuffle = { files: ['cards/card-shuffle.ogg'], gain: 0.6 };
/** file -> decoded AudioBuffer */
const buffers = new Map();
let loading = null;

/** Fetches and decodes every sample, once. Never fails: a missing one is synthesised instead. */
export function loadSamples() {
    if (loading) return loading;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    ctx ??= new AC();             // suspended until the first tap; decoding does not need it running
    const files = Object.values(SAMPLES).flatMap((s) => s.files);
    loading = Promise.all(files.map(async (f) => {
        try {
            const data = await (await fetch(`assets/sounds/${f}`)).arrayBuffer();
            buffers.set(f, await ctx.decodeAudioData(data));
        } catch { /* synthesised instead */ }
    }));
    return loading;
}

/** Plays one sample of a pool. @returns {boolean} whether it played (or would have, muted) */
function sample(name, { delay = 0, gain: level = 1 } = {}) {
    const s = SAMPLES[name];
    const buf = s && buffers.get(s.files[Math.floor(Math.random() * s.files.length)]);
    if (!buf) return false;
    const a = audio();
    if (!a) return true;
    const src = a.createBufferSource();
    const gain = a.createGain();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    gain.gain.value = s.gain * level;
    src.connect(gain).connect(a.destination);
    src.start(a.currentTime + delay);
    return true;
}

/** One enveloped oscillator note. */
function tone(freq, dur, { type = 'sine', gain = 0.3, delay = 0, slideTo = null } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

/** A burst of filtered noise. */
function noise(dur, { gain = 0.25, delay = 0, freq = 1800, q = 0.8, type = 'bandpass', slideTo = null } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    filter.Q.value = q;
    const env = a.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
}

/**
 * A bullet flying past: a narrow band of noise that swells as it comes and fades as it goes, its pitch dropping
 * (the Doppler shift), with a faint whistle on top.
 */
function whiz(delay = 0, { gain = 0.22, from = 4200 + Math.random() * 1400, dur = 0.24 + Math.random() * 0.08 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(from * 0.32, t + dur);
    const env = a.createGain();
    const peak = t + dur * 0.45;          // closest to the ear a little before the middle
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, peak);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
    const osc = a.createOscillator();
    const tenv = a.createGain();
    osc.frequency.setValueAtTime(from * 0.45, t);
    osc.frequency.exponentialRampToValueAtTime(from * 0.16, t + dur);
    tenv.gain.setValueAtTime(0.0001, t);
    tenv.gain.exponentialRampToValueAtTime(gain * 0.12, peak);
    tenv.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(tenv).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

/** A single gunshot: a crack of noise and a low thump. */
function shot(delay = 0, { gain = 0.45, freq = 1400 } = {}) {
    noise(0.11, { delay, freq, q: 0.5, gain });
    tone(120, 0.09, { type: 'square', gain: 0.07, slideTo: 50, delay });
}

export const sfx = {
    /**
     * The fire of an attack by kind of unit (unitKind): R, S rifles, one shot a die; M a burst; SN one crack and its echo.
     * `side` ('us' | 'de') picks the guns' recordings.
     */
    fire(kind, n = 1, side = 'us') {
        if (kind === 'M') {
            if (!sample(`${side}-mg`)) for (let i = 0; i < 7; i++) shot(i * 0.07, { gain: 0.32, freq: 1100 + (i % 2) * 300 });
        } else if (kind === 'SN') {
            if (!sample(`${side}-sniper`)) { shot(0, { gain: 0.6, freq: 2200 }); noise(0.5, { delay: 0.12, freq: 700, q: 1, gain: 0.08, type: 'lowpass' }); }
        } else {
            for (let i = 0; i < n; i++) {
                const delay = i * 0.18 + Math.random() * 0.05;
                if (!sample(`${side}-rifle`, { delay, gain: i ? 0.8 : 1 })) shot(delay);
            }
        }
    },
    /** The mortar: the shell whistles down. */
    whistle() { tone(1500, 0.75, { type: 'sine', gain: 0.07, slideTo: 380 }); },
    dice() { for (let i = 0; i < 5; i++) noise(0.035, { delay: i * 0.055 + Math.random() * 0.02, freq: 2500 + Math.random() * 1500, gain: 0.22 }); },
    impact() { noise(0.16, { freq: 900, q: 0.7, gain: 0.35 }); tone(85, 0.25, { type: 'sine', gain: 0.35, slideTo: 40 }); },
    boom() { tone(60, 1.2, { type: 'sine', gain: 0.6, slideTo: 25 }); noise(1.3, { freq: 1200, slideTo: 60, gain: 0.5, type: 'lowpass' }); },
    /** A miss: `n` bullets whiz past (up to 3, one a die), and now and then one ricochets off a stone. */
    miss(n = 1) {
        const k = Math.min(Math.max(n, 1), 3);
        for (let i = 0; i < k; i++) whiz(i * 0.13 + Math.random() * 0.05);
        if (Math.random() < 0.35) sfx.ricochet(k * 0.13 + 0.05);
    },
    ricochet(delay = 0) { noise(0.03, { delay, freq: 3500, q: 1.5, gain: 0.12 }); tone(2400, 0.35, { type: 'sine', gain: 0.05, slideTo: 900, delay }); },
    pinned() { noise(0.5, { freq: 500, slideTo: 200, q: 0.8, gain: 0.18, type: 'lowpass' }); tone(220, 0.3, { type: 'triangle', gain: 0.06, slideTo: 150 }); },
    steps() { for (let i = 0; i < 3; i++) noise(0.06, { delay: i * 0.12, freq: 380 + i * 40, q: 2, gain: 0.14 }); },
    thud() { tone(90, 0.22, { type: 'sine', gain: 0.35, slideTo: 45 }); noise(0.12, { freq: 300, gain: 0.15 }); },
    fall() { tone(140, 0.6, { type: 'sawtooth', gain: 0.08, slideTo: 40 }); noise(0.6, { freq: 900, slideTo: 120, gain: 0.22, type: 'lowpass' }); },
    rally() { [440, 554, 659].forEach((f, i) => tone(f, 0.16, { type: 'triangle', gain: 0.1, delay: i * 0.07 })); },
    flag() { [523, 659, 784].forEach((f, i) => tone(f, 0.28, { type: 'square', gain: 0.06, delay: i * 0.11 })); },
    /** A card sliding or turning over (one of Kenney's eight card slides, at random). */
    flip(delay = 0) {
        if (sample('slide', { delay })) return;
        noise(0.07, { delay, freq: 1600, q: 1.2, gain: 0.16 });
        noise(0.07, { delay: delay + 0.12, freq: 1800, q: 1.2, gain: 0.16 });
    },
    /** A deck being shuffled: Kenney's shuffle, or a synthesised riffle `times` over. */
    riffle(times = 2, delay = 0) {
        if (sample('shuffle', { delay })) return;
        for (let r = 0; r < times; r++) {
            for (let i = 0; i < 14; i++) noise(0.018, { delay: delay + r * 0.8 + 0.25 + i * 0.022 + Math.random() * 0.008, freq: 4200 + Math.random() * 1800, q: 0.7, gain: 0.12, type: 'highpass' });
        }
    },
    chime() { [660, 880].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.09 })); },
    win() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain: 0.2, delay: i * 0.12 })); },
    lose() { [330, 311, 294, 262].forEach((f, i) => tone(f, 0.45, { type: 'sawtooth', gain: 0.08, delay: i * 0.18 })); },
};

/** @param {boolean} m */
export function setMuted(m) { muted = m; }
