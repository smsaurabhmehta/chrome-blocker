const STORAGE_KEY = "chromeBlockerSettings";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" }
];

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getDefaultSettings() {
  const dayTemplate = {
    enabled: false,
    windows: [
      { enabled: true, start: "06:00", end: "12:00" },
      { enabled: true, start: "18:00", end: "00:00" }
    ]
  };
  return {
    blockedSites: [],
    schedule: {
      mon: structuredClone(dayTemplate),
      tue: structuredClone(dayTemplate),
      wed: structuredClone(dayTemplate),
      thu: structuredClone(dayTemplate),
      fri: structuredClone(dayTemplate),
      sat: structuredClone(dayTemplate),
      sun: structuredClone(dayTemplate)
    }
  };
}

function normalizeSchedule(schedule, defaults) {
  const out = { ...defaults.schedule, ...(schedule || {}) };
  for (const { key } of DAYS) {
    const d = out[key] || structuredClone(defaults.schedule[key]);
    d.enabled = !!d.enabled;
    const wins = Array.isArray(d.windows) ? d.windows : [];
    d.windows = [0, 1].map((i) => {
      const w = wins[i] || defaults.schedule[key].windows[i];
      return {
        enabled: w?.enabled !== false,
        start: timeIsValid(w?.start) ? w.start : defaults.schedule[key].windows[i].start,
        end: timeIsValid(w?.end) ? w.end : defaults.schedule[key].windows[i].end
      };
    });
    out[key] = d;
  }
  return out;
}

function normalizeDomainInput(input) {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  try {
    if (raw.includes("://")) return new URL(raw).hostname;
  } catch {
    // fall through
  }
  const host = raw.split("/")[0].split("?")[0].split("#")[0];
  if (!host || host.includes(" ") || host.includes("://")) return null;
  return host;
}

async function loadSettings() {
  const defaults = getDefaultSettings();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const merged = { ...defaults, ...(stored?.[STORAGE_KEY] || {}) };
  merged.schedule = normalizeSchedule(merged.schedule, defaults);
  return merged;
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function setError(el, msg) {
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("error");
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.classList.add("error");
}

function timeIsValid(t) {
  return typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
}

function validateSchedule(schedule) {
  for (const { key } of DAYS) {
    const d = schedule?.[key];
    if (!d) return `Missing schedule for ${key}.`;
    if (!Array.isArray(d.windows) || d.windows.length !== 2) return `Schedule for ${key} must have 2 windows.`;
    for (let i = 0; i < 2; i++) {
      const w = d.windows[i];
      if (w?.enabled === false) continue;
      if (!timeIsValid(w?.start) || !timeIsValid(w?.end)) return `Invalid time format for ${key} window ${i + 1}.`;
      if (w.start === w.end) return `${key} window ${i + 1} start and end cannot be the same.`;
    }
  }
  return null;
}

function renderSites(settings) {
  const list = document.getElementById("sitesList");
  list.innerHTML = "";

  const sites = Array.isArray(settings.blockedSites) ? settings.blockedSites : [];
  if (!sites.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "No blocked sites yet.";
    list.appendChild(li);
    return;
  }

  for (const site of sites) {
    const li = document.createElement("li");
    li.className = "siteItem";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "toggle";
    checkbox.checked = site.enabled !== false;
    checkbox.addEventListener("change", async () => {
      site.enabled = checkbox.checked;
      await saveSettings(settings);
      await refreshStatusBadge();
    });

    const meta = document.createElement("div");
    meta.className = "siteMeta";
    const domain = document.createElement("div");
    domain.className = "siteDomain";
    domain.textContent = site.pattern;
    const small = document.createElement("div");
    small.className = "siteSmall";
    small.textContent = site.enabled !== false ? "Enabled" : "Disabled";
    meta.appendChild(domain);
    meta.appendChild(small);

    checkbox.addEventListener("change", () => {
      small.textContent = checkbox.checked ? "Enabled" : "Disabled";
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      settings.blockedSites = sites.filter((s) => s.id !== site.id);
      await saveSettings(settings);
      renderSites(settings);
      await refreshStatusBadge();
    });

    li.appendChild(checkbox);
    li.appendChild(meta);
    li.appendChild(removeBtn);
    list.appendChild(li);
  }
}

function renderSchedule(settings) {
  const wrap = document.getElementById("scheduleTable");
  wrap.innerHTML = "";

  function makeApplyAllRow(windowIndex) {
    const row = document.createElement("div");
    row.className = "applyAll";

    const title = document.createElement("div");
    title.className = "applyAllTitle";
    title.textContent = `Window ${windowIndex + 1}`;

    const range = document.createElement("div");
    range.className = "range";

    const start = document.createElement("input");
    start.type = "time";
    start.className = "time";
    start.value = settings.schedule.mon.windows[windowIndex].start;

    const dash = document.createElement("div");
    dash.className = "dash";
    dash.textContent = "→";

    const end = document.createElement("input");
    end.type = "time";
    end.className = "time";
    end.value = settings.schedule.mon.windows[windowIndex].end;

    range.appendChild(start);
    range.appendChild(dash);
    range.appendChild(end);

    const btn = document.createElement("button");
    btn.className = "miniBtn";
    btn.textContent = "Apply to all days";
    btn.addEventListener("click", async () => {
      const startVal = start.value;
      const endVal = end.value;
      if (!timeIsValid(startVal) || !timeIsValid(endVal) || startVal === endVal) {
        setError(document.getElementById("scheduleError"), "Enter a valid start and end time for apply-to-all.");
        return;
      }
      for (const { key } of DAYS) {
        settings.schedule[key].windows[windowIndex].start = startVal;
        settings.schedule[key].windows[windowIndex].end = endVal;
      }
      const err = validateSchedule(settings.schedule);
      setError(document.getElementById("scheduleError"), err);
      if (!err) {
        await saveSettings(settings);
        renderSchedule(settings);
        await refreshStatusBadge();
      }
    });

    row.appendChild(title);
    row.appendChild(range);
    row.appendChild(btn);
    return row;
  }

  wrap.appendChild(makeApplyAllRow(0));
  wrap.appendChild(makeApplyAllRow(1));

  for (const { key, label } of DAYS) {
    const row = document.createElement("div");
    row.className = "dayRow";

    const head = document.createElement("div");
    head.className = "dayHead";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = !!settings.schedule?.[key]?.enabled;
    enabled.addEventListener("change", async () => {
      settings.schedule[key].enabled = enabled.checked;
      await saveSettings(settings);
      await refreshStatusBadge();
      updateDisabled();
    });

    const dayLabel = document.createElement("div");
    dayLabel.className = "dayLabel";
    dayLabel.textContent = label;

    head.appendChild(enabled);
    head.appendChild(dayLabel);

    function makeWindow(windowIndex) {
      const win = document.createElement("div");
      win.className = "win";

      const winHead = document.createElement("div");
      winHead.className = "winHead";

      const winToggle = document.createElement("input");
      winToggle.type = "checkbox";
      winToggle.className = "toggle";
      winToggle.checked = settings.schedule[key].windows[windowIndex].enabled !== false;

      const winLabel = document.createElement("div");
      winLabel.className = "winLabel";
      winLabel.textContent = windowIndex === 0 ? "W1" : "W2";

      winHead.appendChild(winToggle);
      winHead.appendChild(winLabel);

      const range = document.createElement("div");
      range.className = "range";

      const start = document.createElement("input");
      start.type = "time";
      start.className = "time";
      start.value = settings.schedule[key].windows[windowIndex].start;

      const dash = document.createElement("div");
      dash.className = "dash";
      dash.textContent = "→";

      const end = document.createElement("input");
      end.type = "time";
      end.className = "time";
      end.value = settings.schedule[key].windows[windowIndex].end;

      range.appendChild(start);
      range.appendChild(dash);
      range.appendChild(end);

      async function persist() {
        const w = settings.schedule[key].windows[windowIndex];
        w.enabled = winToggle.checked;
        w.start = start.value;
        w.end = end.value;
        const err = validateSchedule(settings.schedule);
        setError(document.getElementById("scheduleError"), err);
        if (!err) {
          await saveSettings(settings);
          await refreshStatusBadge();
        }
      }

      winToggle.addEventListener("change", async () => {
        updateDisabled();
        await persist();
      });
      start.addEventListener("change", persist);
      end.addEventListener("change", persist);

      win.appendChild(winHead);
      win.appendChild(range);

      function updateDisabled() {
        const dayDisabled = !enabled.checked;
        const winDisabled = !winToggle.checked;
        range.querySelectorAll("input").forEach((i) => (i.disabled = dayDisabled || winDisabled));
        win.style.opacity = dayDisabled ? "0.7" : winDisabled ? "0.75" : "1";
      }
      updateDisabled();

      return { el: win, updateDisabled };
    }

    const w1 = makeWindow(0);
    const w2 = makeWindow(1);

    row.appendChild(head);
    row.appendChild(w1.el);
    row.appendChild(w2.el);
    wrap.appendChild(row);

    function updateDisabled() {
      const disabled = !enabled.checked;
      if (disabled) {
        row.querySelectorAll("input[type='time']").forEach((i) => (i.disabled = true));
      }
      w1.updateDisabled();
      w2.updateDisabled();
      row.style.opacity = disabled ? "0.7" : "1";
    }
    updateDisabled();
  }
}

async function refreshStatusBadge() {
  const badge = document.getElementById("statusBadge");
  const status = await chrome.storage.local.get("chromeBlockerStatus");
  const s = status?.chromeBlockerStatus;
  if (!s) {
    badge.textContent = "Status: unknown";
    badge.className = "status";
    return;
  }
  const active = !!s.isActive;
  badge.textContent = active ? "Status: active" : "Status: inactive";
  badge.className = `status ${active ? "ok" : "warn"}`;
}

async function init() {
  const siteError = document.getElementById("siteError");
  const scheduleError = document.getElementById("scheduleError");
  setError(siteError, null);
  setError(scheduleError, null);

  const settings = await loadSettings();

  // Ensure ids exist
  settings.blockedSites = (settings.blockedSites || []).map((s) => ({
    id: s.id || uid(),
    pattern: s.pattern,
    enabled: s.enabled !== false
  }));
  // Persist any migrations/defaults.
  settings.schedule = normalizeSchedule(settings.schedule, getDefaultSettings());
  await saveSettings(settings);

  renderSites(settings);
  renderSchedule(settings);
  await refreshStatusBadge();

  document.getElementById("addSiteBtn").addEventListener("click", async () => {
    setError(siteError, null);
    const input = document.getElementById("siteInput");
    const domain = normalizeDomainInput(input.value);
    if (!domain) {
      setError(siteError, "Enter a valid domain like reddit.com (optionally with https://).");
      return;
    }
    const exists = (settings.blockedSites || []).some((s) => (s.pattern || "").toLowerCase() === domain);
    if (exists) {
      setError(siteError, "That site is already in your block list.");
      return;
    }
    settings.blockedSites.unshift({ id: uid(), pattern: domain, enabled: true });
    await saveSettings(settings);
    input.value = "";
    renderSites(settings);
    await refreshStatusBadge();
  });

  document.getElementById("siteInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addSiteBtn").click();
  });

  document.getElementById("forceApplyBtn").addEventListener("click", async () => {
    // A no-op write triggers service worker apply via storage.onChanged.
    const cur = await loadSettings();
    await saveSettings(cur);
    await refreshStatusBadge();
  });
}

init();

