const LEVEL_META = {
  1: 'Easy · fast engine',
  2: 'Normal · balanced engine',
  3: 'Hard · strong engine',
  4: 'Hardcore · deepest engine'
};

function paint(level) {
  const buttons = document.querySelectorAll('#levels button');
  buttons.forEach(function (b) {
    b.classList.toggle('on', Number(b.dataset.level) === level);
  });

  const foot = document.getElementById('foot');
  if (foot) {
    foot.innerHTML = '<b>' + (LEVEL_META[level] || '') + '</b>';
  }
}

function paintAutoPlay(on) {
  const btn = document.getElementById('btn-auto-play');
  if (!btn) return;
  btn.classList.toggle('on', !!on);
  btn.textContent = on ? '🤖 Auto Play: ON' : '🤖 Auto Play: OFF';
}

const levelsBox = document.getElementById('levels');
if (levelsBox) {
  levelsBox.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-level]');
    if (!b) return;
    const lvl = Number(b.dataset.level);
    chrome.storage.local.set({ level: lvl });
    paint(lvl);
  });
}

chrome.storage.local.get({ level: 4, autoPlay: false }, function (r) {
  paint(r.level);
  paintAutoPlay(!!r.autoPlay);
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.level) paint(changes.level.newValue);
  if (changes.autoPlay) paintAutoPlay(!!changes.autoPlay.newValue);
});

const autoBtn = document.getElementById('btn-auto-play');
if (autoBtn) {
  autoBtn.addEventListener('click', async function () {
    try {
      const r = await chrome.storage.local.get({ autoPlay: false });
      const next = !r.autoPlay;
      await chrome.storage.local.set({ autoPlay: next });
      paintAutoPlay(next);
    } catch (err) {
      console.warn('AutoPlay toggle failed:', err);
    }
  });
}

const downloadBtn = document.getElementById('download-log');
if (downloadBtn) {
  downloadBtn.addEventListener('click', async function () {
    downloadBtn.disabled = true;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab) throw new Error('no active tab');

      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'WR_GET_LOG' });
      if (!resp || !resp.ok || !resp.text) {
        throw new Error((resp && resp.error) || 'empty log response');
      }

      const blob = new Blob([resp.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wallrush_helper_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 5000);
    } catch (err) {
      console.warn('Download log failed:', err);
      alert('Download log failed: ' + err.message + ' — open wallrush.online first, then refresh the page after extension reload.');
    } finally {
      downloadBtn.disabled = false;
    }
  });
}
