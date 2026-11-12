# Normandy Companion

An unofficial companion for playing **Undaunted: Normandy** solo against the computer, **with your own copy of the
game**. The app plays the other side; you play yours with your cards, tiles, counters, markers and dice.

- The app never draws for you: it only knows which cards you may hold, and tells you when to draw, shuffle, discard,
  take a Fog of War or remove a casualty's card. It checks that what you play is a card you can have.
- You say which card you play, what it does and where; for each attack it works out the number you need and asks
  whether you hit. Its own dice roll on screen (or you roll them on the table).
- After each of your answers it tells you, step by step, what the computer does on the table, with a map of its own
  (the tiles by their numbers, the cover, the objectives and the markers).
- Scenarios 1 to 12 of the scenario book; set them up with your book. Spanish and English, and more languages are
  welcome: see [Translating the companion](#translating-the-companion).

**Beta (0.2.0-beta).** Play it at https://plissken2013es.github.io/normandy-companion/, and tell us what goes wrong: open an
[issue](https://github.com/plissken2013es/normandy-companion/issues) (with the game code from ☰ → Code, if you can) or use *Report a bug* in the app.

## Play locally

Open `index.html` through a local server, for example:

    node serve.mjs

and go to http://localhost:8061/. No build and no dependencies: plain JavaScript modules.

## Translating the companion

The companion speaks Spanish and English, and new languages are very welcome. Please open your pull request on this
repository: it is applied to the project it is built from, with you as its author, and comes back in the next release
of the web version and of the Android app (see [CONTRIBUTING.md](CONTRIBUTING.md)).

1. **Start your file** (using Italian, `it`, as the example):

       node src/i18n/new-language.mjs it Italiano

   It writes `src/i18n/lang/it.js` with every English text in place and lists it in `src/i18n/lang/index.js`. There is
   nothing else to touch: the language menu, the names of the cards, counters and scenarios, and the credits all come
   from that file.
2. **Translate the strings.** Keep the keys, the `{placeholders}` and the code of the two small functions (they write
   "1 die" or "2 dice"): change only the words.

   ```js
   'cmp.round': 'Round {n}',                       // → 'Turno {n}',
   'cmp.ask.bidOpt': '{card} · initiative {n}',    // → '{card} · iniziativa {n}',
   ```
3. **Use the words printed in the game in your language.** The player reads the app with the cards in hand, so the
   names of the cards (`cards`), the counters (`units`), the scenarios (`scenarios`) and terms such as Fog of War,
   Suppressed, Pinned, Control, Initiative or Scout must be exactly those of the official edition of *Undaunted:
   Normandy* in your language, not new translations of the English ones. If there is no edition in your language, say
   so in the pull request and choose the words a player would expect.
4. **Only the companion's own texts.** Nothing from the rulebook or the scenario book (the app writes the objectives
   itself from the victory conditions).
5. **Credit yourself** in `credit` (for example `'Traduzione italiana: your name'`): it shows in the credits of the
   start screen.

Before opening the pull request:

    node src/i18n/new-language.mjs --check it   # what is still in English, or broken
    npm test                                    # all tests must pass
    node serve.mjs                              # then http://localhost:8061/?lang=it: start a game, play a few turns

Texts added in later versions arrive in English first: `--check` lists them, and a short pull request filling them in is
just as welcome. If you would also like the app's Google Play listing in your language, add its short and long
description to the pull request.

## Credits

Undaunted: Normandy is a game by David Thompson and Trevor Benjamin, published by Osprey Games. This companion is not
official and not endorsed by them. It includes none of the game's art, rulebook or scenario texts: you need the game.

3D dice: three.js and cannon-es (MIT, `vendor/`). Sounds: CC0 recordings and Kenney's Casino Audio (CC0,
`assets/sounds/`). Map terrain: our own pixel art, made with PixelLab (`assets/terrain/`).

## Tests

    npm test

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The code is under the [MIT license](LICENSE). It covers this code only: Undaunted: Normandy, its rules, art and
texts belong to their owners. The 3D dice libraries and the sounds keep their own licences (`vendor/`,
`assets/sounds/`).
