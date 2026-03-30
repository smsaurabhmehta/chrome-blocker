const STORAGE_KEY = "chromeBlockerSettings";
const ALARM_NAME = "chromeBlocker:nextTransition";

function getDefaultSettings() {
  return {
    blockedSites: [],
    schedule: {
      mon: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      tue: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      wed: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      thu: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      fri: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      sat: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      },
      sun: {
        enabled: false,
        windows: [
          { enabled: true, start: "06:00", end: "12:00" },
          { enabled: true, start: "18:00", end: "00:00" }
        ]
      }
    }
  };
}

function normalizeSchedule(schedule, defaults) {
  const out = { ...defaults.schedule, ...(schedule || {}) };
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const key of keys) {
    const d = out[key] || structuredClone(defaults.schedule[key]);
    d.enabled = !!d.enabled;
    const wins = Array.isArray(d.windows) ? d.windows : [];
    d.windows = [0, 1].map((i) => {
      const w = wins[i] || defaults.schedule[key].windows[i];
      return {
        enabled: w?.enabled !== false,
        start: typeof w?.start === "string" ? w.start : defaults.schedule[key].windows[i].start,
        end: typeof w?.end === "string" ? w.end : defaults.schedule[key].windows[i].end
      };
    });
    out[key] = d;
  }
  return out;
}

function dayKeyFromDate(d) {
  // JS: 0=Sun..6=Sat
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()];
}

function parseHHMM(hhmm) {
  const [hStr, mStr] = (hhmm || "").split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function withTime(baseDate, minutesFromMidnight) {
  const d = new Date(baseDate);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutesFromMidnight, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeDomainInput(input) {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  try {
    // If user entered a scheme, parse as URL.
    if (raw.includes("://")) {
      const u = new URL(raw);
      return u.hostname;
    }
  } catch {
    // fall through
  }
  // Otherwise strip path/query fragments.
  const host = raw.split("/")[0].split("?")[0].split("#")[0];
  // Basic sanity (no spaces, no scheme remnants)
  if (!host || host.includes(" ") || host.includes("://")) return null;
  return host;
}

function computeActiveAndNextTransition(settings, now = new Date()) {
  const schedule = settings?.schedule || {};

  let isActive = false;
  let activeUntil = null; // Date
  let nextTransition = null; // Date
  let activeDayKey = null;
  let activeWindowIndex = null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Evaluate current activity by checking today + possible overnight from yesterday.
  const todayKey = dayKeyFromDate(now);
  const yesterday = addDays(now, -1);
  const yesterdayKey = dayKeyFromDate(yesterday);

  function evalDayForNow(dayDate, dayKey, allowOvernightCarry) {
    const day = schedule?.[dayKey];
    if (!day?.enabled) return;
    const windows = Array.isArray(day.windows) ? day.windows : [];
    for (let i = 0; i < windows.length; i++) {
      if (windows[i]?.enabled === false) continue;
      const startMin = parseHHMM(windows[i]?.start);
      const endMin = parseHHMM(windows[i]?.end);
      if (startMin == null || endMin == null) continue;

      if (endMin === startMin) continue;

      if (endMin > startMin) {
        // Same-day window
        if (dayKey === todayKey && nowMinutes >= startMin && nowMinutes < endMin) {
          isActive = true;
          activeDayKey = dayKey;
          activeWindowIndex = i;
          activeUntil = withTime(now, endMin);
        }
      } else {
        // Overnight window: start -> 24:00 and 0:00 -> end (next day)
        if (dayKey === todayKey) {
          if (nowMinutes >= startMin) {
            isActive = true;
            activeDayKey = dayKey;
            activeWindowIndex = i;
            activeUntil = withTime(addDays(now, 1), endMin);
          }
        } else if (allowOvernightCarry) {
          // This is yesterday's overnight carrying into today.
          if (nowMinutes < endMin) {
            isActive = true;
            activeDayKey = dayKey;
            activeWindowIndex = i;
            activeUntil = withTime(now, endMin);
          }
        }
      }

      if (isActive) return;
    }
  }

  evalDayForNow(now, todayKey, false);
  if (!isActive) evalDayForNow(yesterday, yesterdayKey, true);

  // Compute next transition boundary (start or end) in the next 8 days.
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const dayDate = addDays(now, dayOffset);
    const dayKey = dayKeyFromDate(dayDate);
    const day = schedule?.[dayKey];
    if (!day?.enabled) continue;
    const windows = Array.isArray(day.windows) ? day.windows : [];

    for (const w of windows) {
      if (w?.enabled === false) continue;
      const startMin = parseHHMM(w?.start);
      const endMin = parseHHMM(w?.end);
      if (startMin == null || endMin == null) continue;
      if (startMin === endMin) continue;

      const startAt = withTime(dayDate, startMin);
      let endAt = withTime(dayDate, endMin);
      if (endMin <= startMin) {
        endAt = withTime(addDays(dayDate, 1), endMin);
      }

      if (startAt > now) candidates.push(startAt);
      if (endAt > now) candidates.push(endAt);
    }
  }
  candidates.sort((a, b) => a - b);
  nextTransition = candidates[0] || null;

  return { isActive, activeUntil, nextTransition, activeDayKey, activeWindowIndex };
}

async function getSettings() {
  const defaults = getDefaultSettings();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const merged = { ...defaults, ...(stored?.[STORAGE_KEY] || {}) };
  // Shallow-merge schedule keys too (so missing days get defaults)
  merged.schedule = normalizeSchedule(merged.schedule, defaults);
  // Migrate blockedSites entries to include id/enabled.
  merged.blockedSites = (Array.isArray(merged.blockedSites) ? merged.blockedSites : [])
    .map((s) => ({
      id: s?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      pattern: s?.pattern || "",
      enabled: s?.enabled !== false
    }))
    .filter((s) => !!normalizeDomainInput(s.pattern));
  return merged;
}

function makeRuleIdForSite(site, index) {
  // Deterministic small int range for DNR IDs.
  // 1000..1999 reserved for sites.
  let hash = 0;
  const s = `${site.pattern || ""}`.toLowerCase();
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return 1000 + ((hash + index) % 900);
}

function buildDynamicRules(settings) {
  const blockedSites = Array.isArray(settings?.blockedSites) ? settings.blockedSites : [];
  const enabledSites = blockedSites
    .map((s) => ({ ...s, pattern: normalizeDomainInput(s?.pattern) }))
    .filter((s) => s.enabled !== false && s.pattern);

  const rules = enabledSites.map((site, idx) => {
    const id = makeRuleIdForSite(site, idx);
    const domain = site.pattern;
    return {
      id,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/src/blocked/blocked.html" }
      },
      condition: {
        // Use urlFilter to match host and subdomains.
        // ||example.com^ matches example.com and *.example.com
        urlFilter: `||${domain}^`,
        resourceTypes: ["main_frame"]
      }
    };
  });

  return rules;
}

async function applyBlockingState(reason = "unknown") {
  const settings = await getSettings();
  const { isActive, activeUntil, nextTransition, activeDayKey, activeWindowIndex } = computeActiveAndNextTransition(
    settings,
    new Date()
  );

  // Always clear alarm and reschedule.
  await chrome.alarms.clear(ALARM_NAME);
  if (nextTransition) {
    await chrome.alarms.create(ALARM_NAME, { when: nextTransition.getTime() });
  }

  // Update dynamic rules based on schedule activity.
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existing.map((r) => r.id);

  if (!isActive) {
    if (existingIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
    }
  } else {
    const desired = buildDynamicRules(settings);
    // Replace the whole dynamic ruleset to avoid stale rules sticking around.
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: desired
    });
  }

  // Persist a tiny status snapshot for UI/debug.
  await chrome.storage.local.set({
    chromeBlockerStatus: {
      isActive,
      reason,
      updatedAt: Date.now(),
      activeUntil: activeUntil?.getTime() || null,
      activeDayKey,
      activeWindowIndex,
      nextTransition: nextTransition?.getTime() || null
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  await applyBlockingState("onInstalled");
});

chrome.runtime.onStartup.addListener(async () => {
  // Ensure defaults/migrations are persisted.
  const settings = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  await applyBlockingState("onStartup");
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[STORAGE_KEY]) return;
  await applyBlockingState("settingsChanged");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await applyBlockingState("alarm");
});

// Capture last matched request for the blocked page UI.
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
  try {
    const settings = await getSettings();
    const rules = buildDynamicRules(settings);
    const matchedRule = rules.find((r) => r.id === info?.rule?.ruleId);
    const pattern = matchedRule?.condition?.urlFilter || null;

    await chrome.storage.local.set({
      chromeBlockerLastBlocked: {
        url: info?.request?.url || null,
        time: Date.now(),
        ruleId: info?.rule?.ruleId || null,
        pattern
      }
    });
  } catch {
    // ignore
  }
});

