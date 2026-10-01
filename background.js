import { aiMove, AI_LEVELS } from './ai.js';

const LEVEL_NAME = { 1: 'easy', 2: 'normal', 3: 'hard', 4: 'hardcore' };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'ANALYZE') return;

  chrome.storage.local.get({ level: 4 }, (opts) => {
    const lvl = Math.max(1, Math.min(4, opts.level | 0));
    const name = LEVEL_NAME[lvl];
    const cfg = AI_LEVELS[name] || AI_LEVELS.hardcore;

    const t0 = performance.now();
    try {
      const move = aiMove(msg.state, name, {
        recent: msg.recent || []
      });
      sendResponse({
        move: move,
        engine: 'ai.js',
        level: lvl,
        levelName: name,
        budget: cfg.budget,
        maxDepth: cfg.maxDepth,
        ms: Math.round(performance.now() - t0)
      });
    } catch (err) {
      sendResponse({ error: String(err) });
    }
  });

  return true;
});