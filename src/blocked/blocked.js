function fmt(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

async function load() {
  const { chromeBlockerLastBlocked, chromeBlockerStatus } = await chrome.storage.local.get([
    "chromeBlockerLastBlocked",
    "chromeBlockerStatus"
  ]);

  const last = chromeBlockerLastBlocked || {};
  const status = chromeBlockerStatus || {};

  const blockedUrl = document.getElementById("blockedUrl");
  blockedUrl.textContent = last.url ? `URL: ${last.url}` : "URL: (unknown — try reloading the page)";

  const details = document.getElementById("details");
  const allowAgain = status?.activeUntil ? fmt(status.activeUntil) : null;
  const nextTs = status?.nextTransition ? fmt(status.nextTransition) : "—";
  const activeLine = status?.isActive
    ? `Active now • Allowed again: ${allowAgain || "—"}`
    : "Not active now (this block may be stale)";
  details.textContent = `${activeLine} • Next schedule change: ${nextTs} • Last matched: ${fmt(last.time)}`;

  document.getElementById("openOptions").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });

  document.getElementById("refresh").addEventListener("click", () => {
    location.reload();
  });
}

load();

