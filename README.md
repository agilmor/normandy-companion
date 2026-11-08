# Normandy Companion

An unofficial companion for playing **Undaunted: Normandy** solo against the computer, **with your own copy of the
game**. The app plays the other side; you play yours with your cards, tiles, counters, markers and dice.

- The app never draws for you: it only knows which cards you may hold, and tells you when to draw, shuffle, discard,
  take a Fog of War or remove a casualty's card. It checks that what you play is a card you can have.
- You say which card you play, what it does and where; for each attack it works out the number you need and asks
  whether you hit. Its own dice roll on screen (or you roll them on the table).
- After each of your answers it tells you, step by step, what the computer does on the table, with a map of its own
  (the tiles by their numbers, the cover, the objectives and the markers).
- Scenarios 1 to 12 of the scenario book; set them up with your book. Spanish and English.

## Play

Open `index.html` through a local server, for example:

    node serve.mjs

and go to http://localhost:8061/. No build and no dependencies: plain JavaScript modules.

## Credits

Undaunted: Normandy is a game by David Thompson and Trevor Benjamin, published by Osprey Games. This companion is not
official and not endorsed by them. It includes none of the game's art, rulebook or scenario texts: you need the game.

3D dice: three.js and cannon-es (MIT, `vendor/`). Sounds: CC0 recordings and Kenney's Casino Audio (CC0,
`assets/sounds/`). Map terrain: our own pixel art, made with PixelLab (`assets/terrain/`).

## Tests

    npm test
