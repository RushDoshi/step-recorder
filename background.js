// Step Recorder - background worker
// Single place that writes steps to storage, so steps stay in order.

const DEFAULTS = {
  recording: false,
  steps: [],          // [{ kind: "step"|"section", text, tag, subs?, time }]
  title: "",
  trackedTabs: [],    // tab ids being recorded (start tab + tabs it opens)
  lastUrls: {},       // tabId -> last recorded URL
  siteTitle: "",      // title of the first page, used to trim site names from later titles
  startedAt: null
};

let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch((e) => console.error(e)));

const getState = () => chrome.storage.local.get(DEFAULTS);
const setState = (patch) => chrome.storage.local.set(patch);

async function pushStep(state, text, tag = null, replaceLast = null, kind = "step", sid = null) {
  const last = state.steps[state.steps.length - 1];
  // Merge related steps (login details, right-click + menu choice) only when
  // the previous step really is the one being merged.
  if (replaceLast && last && last.tag === replaceLast) {
    state.steps[state.steps.length - 1] = { kind, text, tag, time: Date.now() };
    await setState({ steps: state.steps });
    return;
  }
  // Drop the same step fired twice by the browser (happens within milliseconds).
  // Kept short so two real, identical actions are both recorded.
  // Typed text is already protected per field, so it's never de-duplicated here.
  if (tag !== "typed" && last && last.text === text && Date.now() - last.time < 400) return;
  const step = { kind, text, tag, time: Date.now() };
  if (sid) step.sid = sid;
  state.steps.push(step);
  await setState({ steps: state.steps });
}

function updateBadge(recording) {
  chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#C8342B" });
}

async function injectInto(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
  } catch (e) {
    // Chrome's own pages (chrome://, Web Store) can't be recorded.
  }
}

const SEP = /\s+[|\u2013\u2014-]\s+/; // " | ", " - ", " – ", " — "

// Page name from the real page title. If the title looks like "Dashboard | XYZ"
// and the first page's title shared that edge part ("Login | XYZ"), the shared
// site name is dropped. At most one part is dropped, and only from an edge.
function pageTitle(tab, siteTitle) {
  const title = (tab.title || "").trim();
  if (!title || title === tab.url) return "";
  const parts = title.split(SEP).map((p) => p.trim()).filter(Boolean);
  const site = (siteTitle || "").split(SEP).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2 || site.length < 2) return title;
  const candidates = new Set([site[0], site[site.length - 1]]);
  if (candidates.has(parts[parts.length - 1].toLowerCase())) return parts.slice(0, -1).join(" - ");
  if (candidates.has(parts[0].toLowerCase())) return parts.slice(1).join(" - ");
  return title;
}

function pageRef(tab, siteTitle) {
  const name = pageTitle(tab, siteTitle);
  if (!name) return tab.url;
  const bold = `**${name.replace(/\*\*/g, "*")}**`;
  return /\bpage$/i.test(name) ? `the ${bold}` : `the ${bold} page`;
}

// ---------- Auto-verify steps ----------
const DEFAULT_RULES = [
  { button: "Change Status", verify: "Verify the Status change should be created successfully" },
  { button: "Assign Attributes", verify: "Verify Assign Attributes should be created successfully" }
];
const pendingVerify = {}; // sid -> { text, timer }

// Puts the verify step directly after the click that triggered it
async function insertVerify(sid) {
  const p = pendingVerify[sid];
  if (!p) return;
  clearTimeout(p.timer);
  delete pendingVerify[sid];
  const state = await getState();
  const i = state.steps.findIndex((x) => x.sid === sid);
  if (i < 0) return; // the click step was deleted or never stored
  state.steps.splice(i + 1, 0, { kind: "step", text: p.text, tag: "autoverify", time: Date.now() });
  await setState({ steps: state.steps });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { rules } = await chrome.storage.local.get("rules");
  if (!Array.isArray(rules)) await chrome.storage.local.set({ rules: DEFAULT_RULES });
});

// ---------- Messages from the page and the popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  enqueue(async () => {
    const state = await getState();

    switch (msg.type) {
      case "STEP": {
        const tabId = sender.tab?.id;
        if (!state.recording || !state.trackedTabs.includes(tabId)) break;
        await pushStep(state, msg.text, msg.tag, msg.replaceLast, "step", msg.sid || null);
        if (msg.sid && msg.verify) {
          // Wait for the page to report whether the action completed. If the
          // page itself went away (navigation), completion is assumed.
          pendingVerify[msg.sid] = {
            text: msg.verify,
            timer: setTimeout(() => enqueue(() => insertVerify(msg.sid)), 6500)
          };
        }
        break;
      }
      case "CONFIRM_VERIFY": {
        await insertVerify(msg.sid);
        break;
      }
      case "CANCEL_VERIFY": {
        const p = pendingVerify[msg.sid];
        if (p) { clearTimeout(p.timer); delete pendingVerify[msg.sid]; }
        break;
      }
      case "LOGIN": {
        // Username + password typed in the same form. The username step is
        // replaced by sub-points; the real password is never stored.
        const tabId = sender.tab?.id;
        if (!state.recording || !state.trackedTabs.includes(tabId)) break;
        let last = state.steps[state.steps.length - 1];
        if (msg.replaceTyped && last && last.tag === "typed") state.steps.pop();
        const subs = [msg.user, "password: <password>"];
        last = state.steps[state.steps.length - 1];
        if (last && last.tag === "open" && !last.subs) {
          last.subs = subs;          // "Open this url ..." with the login details under it
        } else {
          state.steps.push({ kind: "step", text: "Enter the login details", tag: "login", subs, time: Date.now() });
        }
        await setState({ steps: state.steps });
        break;
      }
      case "SECTION": {
        // From the keyboard shortcut on the page
        const tabId = sender.tab?.id;
        if (!state.recording || !state.trackedTabs.includes(tabId)) break;
        await pushStep(state, msg.text, null, null, "section");
        break;
      }
      case "START": {
        const tab = await chrome.tabs.get(msg.tabId);
        state.recording = true;
        state.trackedTabs = [tab.id];
        state.lastUrls = { [tab.id]: tab.url };
        if (!state.startedAt || state.steps.length === 0) state.startedAt = Date.now();
        // Remember the first page's title (used to trim the site name from later
        // page titles). Section headings added before Start don't count as steps.
        if (!state.siteTitle || !state.steps.some((x) => x.kind !== "section")) state.siteTitle = tab.title || "";
        await setState({
          recording: true, trackedTabs: state.trackedTabs, siteTitle: state.siteTitle,
          lastUrls: state.lastUrls, startedAt: state.startedAt
        });
        await pushStep(state, `Open this url ${tab.url.replace(/\/$/, "")}`, "open");
        await injectInto(tab.id);
        updateBadge(true);
        break;
      }
      case "STOP": {
        await setState({ recording: false, trackedTabs: [] });
        updateBadge(false);
        break;
      }
      case "CLEAR": {
        await setState({ steps: [], siteTitle: "", startedAt: state.recording ? Date.now() : null });
        break;
      }
      case "NOTE": {
        // Typed in the popup: a step, or a section heading (kind "section")
        await pushStep(state, msg.text, null, null, msg.kind === "section" ? "section" : "step");
        break;
      }
      case "INSERT_SECTION": {
        state.steps.splice(msg.index, 0, { kind: "section", text: msg.text, tag: null, time: Date.now() });
        await setState({ steps: state.steps });
        break;
      }
      case "EDIT": {
        const item = state.steps[msg.index];
        if (!item) break;
        if (msg.sub !== undefined && msg.sub !== null) {
          if (item.subs && item.subs[msg.sub] !== undefined) item.subs[msg.sub] = msg.text;
        } else {
          item.text = msg.text;
        }
        await setState({ steps: state.steps });
        break;
      }
      case "DELETE": {
        const item = state.steps[msg.index];
        if (!item) break;
        if (msg.sub !== undefined && msg.sub !== null) {
          item.subs.splice(msg.sub, 1);
          if (!item.subs.length) delete item.subs;
        } else {
          state.steps.splice(msg.index, 1);
        }
        await setState({ steps: state.steps });
        break;
      }
      case "TITLE": {
        await setState({ title: msg.title });
        break;
      }
    }
    sendResponse({ ok: true });
  });
  return true; // keep the channel open for the async response
});

// ---------- Page changes (full loads and single-page-app route changes) ----------
const pending = {};

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url && info.status !== "complete") return;
  clearTimeout(pending[tabId]);
  // Wait briefly so the page title has time to update
  pending[tabId] = setTimeout(() => {
    enqueue(async () => {
      const state = await getState();
      if (!state.recording || !state.trackedTabs.includes(tabId)) return;
      let tab;
      try { tab = await chrome.tabs.get(tabId); } catch { return; }
      if (!tab.url || state.lastUrls[tabId] === tab.url) return;
      state.lastUrls[tabId] = tab.url;
      await setState({ lastUrls: state.lastUrls });
      await pushStep(state, `User should be redirected to ${pageRef(tab, state.siteTitle)}`);
    });
  }, 900);
});

// New tabs opened from a recorded tab (e.g. links with target="_blank")
chrome.tabs.onCreated.addListener((tab) => {
  enqueue(async () => {
    const state = await getState();
    if (!state.recording || !state.trackedTabs.includes(tab.openerTabId)) return;
    state.trackedTabs.push(tab.id);
    await setState({ trackedTabs: state.trackedTabs });
    await pushStep(state, "A new browser tab opens");
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueue(async () => {
    const state = await getState();
    if (!state.recording || !state.trackedTabs.includes(tabId)) return;
    const tab = await chrome.tabs.get(tabId);
    const last = state.steps[state.steps.length - 1];
    if (last && last.text === "A new browser tab opens") return;
    if (state.trackedTabs.length > 1) await pushStep(state, `Switch to the browser tab showing ${pageRef(tab, state.siteTitle)}`);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const state = await getState();
    if (!state.trackedTabs.includes(tabId)) return;
    state.trackedTabs = state.trackedTabs.filter((id) => id !== tabId);
    await setState({ trackedTabs: state.trackedTabs });
    if (state.recording) await pushStep(state, "Close the browser tab");
  });
});

// Restore the badge when Chrome starts
chrome.runtime.onStartup.addListener(async () => updateBadge((await getState()).recording));
chrome.runtime.onInstalled.addListener(async () => updateBadge((await getState()).recording));

// ---------- Keyboard shortcuts (set in manifest; changeable at chrome://extensions/shortcuts) ----------
chrome.commands.onCommand.addListener(async (command) => {
  const state = await getState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !state.recording || !state.trackedTabs.includes(tab.id)) return;
  const type = command === "add-section" ? "ASK_SECTION" : command === "verify-mode" ? "VERIFY_MODE" : null;
  if (!type) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
  } catch (e) {
    // Page not ready or not recordable
  }
});
