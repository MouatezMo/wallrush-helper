# WallRush Helper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![JavaScript](https://img.shields.io/badge/JavaScript-local%20engine-f7df1e.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

Unofficial browser extension for [WallRush Game](https://wallrush.online/) that analyzes the current board locally and highlights a suggested move.

## Features

- Local game engine — no remote AI service.
- Pawn moves and wall placement analysis.
- Easy, Normal, Hard and Hardcore levels.
- Green move highlighting.
- Optional Auto Play.
- Diagnostic log export.
- Duel, Race and Quad support.

## The story

I discovered WallRush through a reel and got hooked.

What started as a small personal helper became a game-AI experiment. Beginning **September 19, 2026**, I used Python and Colab as a laboratory: test an idea, run games simulation, inspect the numbers, then move what survived into JavaScript. Some ideas improved the engine. Others failed badly. Both were useful.

The current engine is **LeapFrog-1** — the first public step, not the final answer.

It is public because the interesting part is no longer just the extension. It is the search itself. Better evaluation, wall strategy, search, performance, and experiments can make it much stronger.

## Install

**[Download the latest release](../../releases/latest)**

1. Extract the `.zip`.
2. Open your browser's extensions page.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder containing `manifest.json`.
6. Pin **WallRush Helper** extension.

> On Android, extension support and the installation UI vary by browser and build. Use a Chromium-based browser that supports user-installed Manifest V3 extensions. Personally, I use the [Cromite browser](https://github.com/uazo/cromite) For Chrome extensions.

The ZIP is for distribution. **Load unpacked uses the extracted folder, not the ZIP itself.**

## Use

Open [WallRush Game](https://wallrush.online/), open WallRush Helper, choose an engine level, and wait for the green suggestion on your turn.

## Engine

The local engine uses alpha-beta search, iterative deepening, transposition tables, Zobrist hashing, move ordering, and board evaluation.

Current board models: **Duel 9×9, Race 9×13, Quad 11×11**.

## Contribute

The main goal is simple: **make the engine stronger**.

Ideas, experiments, benchmarks, search improvements, evaluation changes, wall strategy, performance work, and bug fixes are welcome.

Bring evidence when possible. A failed experiment is useful too.

## Credits

Created and maintained by **MouatezMo**.

WallRush Helper is an independent project and is not affiliated with WallRush.

## License

**MIT License**
