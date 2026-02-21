# Mini Street Clash

A 2-player browser fighting game built with plain HTML, CSS, and JavaScript.

This project is intentionally simple:
- One HTML page
- One CSS file
- One main game logic file
- One audio engine file
- No framework required

## What The Game Is

Two fighters face each other on one screen.

Each player can:
- Move left and right
- Jump
- Punch
- Kick
- Do a jump kick (jump, then kick while in the air)

The goal is simple: reduce the other player's life to `0`.

## Quick Start

### 1) Requirements

- `python3` installed
- A modern browser (Chrome, Safari, Edge, or Firefox)

You do not need a build step.

### 2) Run The Game

From this folder:

```bash
npm run serve
```

Then open:

`http://127.0.0.1:5173`

If port `5173` is busy, use another port:

```bash
python3 -m http.server 6001
```

Then open:

`http://127.0.0.1:6001`

Important: avoid port `6000` in browsers, many browsers block it as an unsafe port.

## How To Play

### Keyboard Controls

Player 1:
- Move: `A` / `D`
- Jump: `W`
- Punch: `C`
- Kick: `V`

Player 2:
- Move: `Left` / `Right`
- Jump: `Up`
- Punch: `/`
- Kick: `Down`

Global:
- Start/Restart round: `R`
- Fullscreen toggle: `F`

### Gamepad Controls

- Move: D-pad or left stick
- Jump: `Y` / `Triangle`
- Punch: `A` / `Cross` (or `X` depending on controller mapping)
- Kick: `B` / `Circle`
- Start/restart: `Start`

### Round Rules

- Both players start with `100` life.
- Attack damage: punch (light), kick (medium), jump kick (heavy).
- First player to reach `0` life loses.
- Winner screen appears, then press `R` or `Start` to play again.

## Change Controls (Optional)

Open `index.html` and edit `window.GAME_CONFIG`.

Example:

```html
window.GAME_CONFIG = {
  keyBindings: {
    p1: { left: "KeyA", right: "KeyD", jump: "KeyW", punch: "KeyC", kick: "KeyV" },
    p2: { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", punch: "Slash", kick: "ArrowDown" }
  },
  gamepadAssignments: { p1: 0, p2: 1 },
  newRoundKey: "KeyR"
};
```

## Teen-Friendly Code Tour

If you are new to coding, start here:

- `index.html`: the page, canvas, start overlay, and control config.
- `style.css`: visual styling for the page and menu overlay.
- `game.js`: game loop, controls, physics, combat, winner logic, and drawing.
- `audio.js`: music and sound effects generated with the Web Audio API.
- `assets/`: background, fighter sprites, and UI art.

### How `game.js` flows

Think of each frame like a checklist:

1. Read input (keyboard + gamepad)
2. Update player movement/jump/attacks
3. Check collisions and apply damage
4. Update particles and round state
5. Draw the new frame on canvas
6. Repeat using `requestAnimationFrame`

### Helpful debugging hooks

`game.js` exposes two browser helpers:

- `window.render_game_to_text()`: returns current game state as JSON text.
- `window.advanceTime(ms)`: advances simulation time for automated tests.

## Project Scripts

From `package.json`:

- `npm run serve`: run local web server on port `5173`
- `npm run generate-art`: generate artwork assets
- `npm run generate-fighter-frames`: generate fighter animation frames

## Troubleshooting

- No sound: click the page once, browsers block audio until user interaction.
- Page will not load on a port: try `5173` or `6001`.
- Controls do nothing: click the game tab/window first to give it focus.
