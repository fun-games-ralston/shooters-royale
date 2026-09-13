/* Optional, per-tab playtime reminder. This never controls scoring or access. */
(function (root) {
  'use strict';
  const INTERVAL_MS = 30 * 60 * 1000;
  const STORAGE_KEY = 'sr_playtime_reminder_v1';

  function create(storage) {
    let playedMs = 0, nextReminderMs = INTERVAL_MS;
    let lastNow = null, wasActive = false, lastSavedMs = 0;
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY));
      if (saved && Number.isFinite(saved.playedMs) && saved.playedMs >= 0 &&
          Number.isFinite(saved.nextReminderMs) && saved.nextReminderMs >= INTERVAL_MS) {
        playedMs = saved.playedMs;
        nextReminderMs = saved.nextReminderMs;
      }
    } catch (_) { /* Storage is optional, just like the reminder. */ }
    lastSavedMs = playedMs;

    function save() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify({ playedMs, nextReminderMs })); } catch (_) {}
      lastSavedMs = playedMs;
    }
    return {
      update(now, active) {
        const delta = lastNow === null ? 0 : now - lastNow;
        // Count foreground gameplay, not suspended frames, menus or outro time.
        // Visibility/pagehide handlers break the interval before backgrounding.
        if (wasActive && active && delta > 0 && delta <= 5000) playedMs += delta;
        if ((wasActive && !active) || playedMs - lastSavedMs >= 15000) save();
        lastNow = now;
        wasActive = active;
      },
      due() { return playedMs >= nextReminderMs; },
      minutes() { return Math.floor(playedMs / 60000); },
      dismiss() {
        // Both choices are optional: remind again only after 30 more active minutes.
        nextReminderMs = playedMs + INTERVAL_MS;
        save();
      },
      save,
    };
  }
  const api = { create, INTERVAL_MS, STORAGE_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlockRoyalePlaytime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
