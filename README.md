# WallRush Helper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![JavaScript](https://img.shields.io/badge/JavaScript-local%20engine-f7df1e.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

Unofficial browser extension for [WallRush Game](https://wallrush.online/) that analyzes the current board locally and highlights a suggested move.

## Features

- Local game engine — no remote AI service.
- Pawn moves and wall placement analysis.
- Easy, Normal, Hard and Hardcore levels.
- Green move highlighting on the board.
- Optional Auto Play.
- Diagnostic log export.
- Duel, Race and Quad board support.

## Install

Download the latest release:

**[Download latest release](https://github.com/user-attachments/files/32927594/wallrush-helper-v3.0.zip)**

1. Extract the downloaded `.zip`.
2. Open your browser's extensions page.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder containing `manifest.json`.
6. Pin **WallRush Helper** for quick access.

The ZIP is for distribution; **Load unpacked uses the extracted folder**, not the ZIP itself.

## Use

Open [WallRush Game](https://wallrush.online/), open WallRush Helper, choose a level, and wait for the green suggestion on your turn.

## Engine

The engine uses alpha-beta search, iterative deepening, transposition tables, Zobrist hashing, move ordering and board evaluation.

The current models are Duel 9×9, Race 9×13 and Quad 11×11.

## Contribute

The main goal is stronger play. Improvements to search, evaluation, wall selection, performance, testing and multi-player analysis are welcome✨.

## Credits

Created and maintained by **MouatezMo**.

WallRush Helper is an independent project and is not affiliated with WallRush.

## License

[MIT License]
