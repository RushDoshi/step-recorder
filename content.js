// Step Recorder - content script
// Watches clicks, typing, dropdowns and right-click menus on the page and
// sends each action to the background worker as a plain English sentence.
(() => {
  if (window.__stepRecorderLoaded) return;
  window.__stepRecorderLoaded = true;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const short = (s, n = 60) => {
    s = clean(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const q = (s) => `"${s}"`;
  // Element names are wrapped in **...** so they can be shown in bold
  const b = (s) => `**${String(s).replace(/\*\*/g, "*")}**`;

  const TEXT_INPUTS = new Set([
    "text", "email", "password", "number", "search", "tel", "url",
    "date", "datetime-local", "month", "week", "time", ""
  ]);

  let lastRightClick = 0;
  let lastTypedEl = null;              // last text field the user typed in
  let lastSentTag = null;              // tag of the last step this page sent
  let lastRightClickTarget = "";       // description of what was right-clicked
  const recordedValue = new WeakMap(); // avoid logging the same typed value twice
  const editableStart = new WeakMap(); // contenteditable text at focus time

  // tag: what kind of step this is, so related steps can be merged.
  // replaceLast: ask the background to replace the previous step (only if its tag matches).
  function send(text, tag = null, replaceLast = null, extra = {}) {
    cancelWatches(); // a new action means the earlier button's window didn't close from that click
    lastSentTag = tag;
    try {
      chrome.runtime.sendMessage({ type: "STEP", text, tag, replaceLast, ...extra });
    } catch (e) {
      // Extension was reloaded; this old script can no longer talk to it.
    }
  }

  // ---------- Naming elements ----------
  function labelFor(el) {
    if (!el || el.nodeType !== 1) return "";
    const aria = el.getAttribute("aria-label");
    if (clean(aria)) return short(aria);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy.split(/\s+/)
        .map((id) => (document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || ""))
        .join(" ");
      if (clean(t)) return short(t);
    }

    const tag = el.tagName;
    const isField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

    if (isField) {
      if (el.labels && el.labels.length && clean((el.labels[0].innerText || el.labels[0].textContent))) {
        return short((el.labels[0].innerText || el.labels[0].textContent));
      }
      if (el.placeholder) return short(el.placeholder);
      if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type)) {
        return short(el.value || el.type);
      }
      if (el.title) return short(el.title);
      if (el.name) return short(el.name.replace(/[_\-.\[\]]+/g, " "));
      if (el.id) return short(el.id.replace(/[_\-.]+/g, " "));
      return "";
    }

    if (tag === "IMG") return short(el.alt || el.title);

    const text = el.innerText || el.textContent;
    if (clean(text)) return short(text);
    if (el.title) return short(el.title);
    const img = el.querySelector && el.querySelector("img[alt]");
    if (img && clean(img.alt)) return short(img.alt);
    const svgTitle = el.querySelector && el.querySelector("svg title");
    if (svgTitle && clean(svgTitle.textContent)) return short(svgTitle.textContent);
    if (el.getAttribute("data-tooltip")) return short(el.getAttribute("data-tooltip"));
    return "";
  }

  function kindOf(el) {
    const role = el.getAttribute("role");
    const roles = {
      tab: "tab", menuitem: "menu option", menuitemcheckbox: "menu option",
      menuitemradio: "menu option", option: "option", link: "link",
      button: "button", checkbox: "checkbox", switch: "toggle",
      treeitem: "item", gridcell: "", row: ""
    };
    if (role && roles[role]) return roles[role];
    switch (el.tagName) {
      case "A": return "link";
      case "BUTTON": return "button";
      case "SUMMARY": return "section";
      case "IMG": return "image";
      case "INPUT":
        if (["button", "submit", "reset", "image"].includes(el.type)) return "button";
        return "field";


      default: return "";
    }
  }

  const CLICKABLE = [
    "a[href]", "button", "summary", "input", "select", "textarea", "label",
    "[role=button]", "[role=tab]", "[role=link]", "[role=menuitem]",
    "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]",
    "[role=checkbox]", "[role=switch]", "[role=treeitem]", "[role=gridcell]",
    "[onclick]", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function meaningfulTarget(target) {
    if (!(target instanceof Element)) target = target?.parentElement;
    if (!target) return null;
    return target.closest(CLICKABLE) || target.closest("li, td, th") || target;
  }

  function isTextEntry(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (el.tagName === "INPUT") {
      return TEXT_INPUTS.has(el.type) || ["checkbox", "radio", "file", "range", "color"].includes(el.type);
    }
    return false;
  }

  // "the Submit button", "the Projects tab", "Row A", "a button"
  // When the clicked element holds a lot of text (a whole table row, a user
  // menu with name + email + company), name it by the exact text under the
  // mouse instead, so the step names something short and exact.
  function preciseName(el, target) {
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return labelFor(el);
    const full = clean(el.innerText || el.textContent);
    if (full.length <= 50 || !target) return labelFor(el);
    let node = target instanceof Element ? target : target.parentElement;
    while (node && node !== el) {
      const t = clean(node.innerText || node.textContent);
      if (t && t.length <= 80) return t;
      node = node.parentElement;
    }
    return labelFor(el);
  }

  function describe(el, target) {
    const name = target ? preciseName(el, target) : labelFor(el);
    const kind = kindOf(el);
    if (name && kind) return `the ${b(name)} ${kind}`;
    if (name) return b(name);
    if (kind) return `a ${kind}`;
    return "an item";
  }

  // "the Username field" or "the field"
  function fieldRef(el, noun) {
    const name = labelFor(el);
    return name ? `the ${b(name)} ${noun}` : `the ${noun}`;
  }

  const RIGHT_CLICK_WINDOW = 30000;

  // ---------- Auto-verify rules ----------
  // "When the <button> is clicked, add <verify step>" - set in the popup.
  // The verify step is only added if the action completed: the button's
  // window closed or the page changed within 5 seconds.
  let rules = [];
  try {
    chrome.storage.local.get({ rules: [] }, (r) => { rules = r.rules || []; });
    chrome.storage.onChanged.addListener((ch) => { if (ch.rules) rules = ch.rules.newValue || []; });
  } catch (e) {}

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function isVisible(el) {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden";
  }

  function matchRule(name) {
    const n = clean(name).toLowerCase();
    if (!n) return null;
    return rules.find((r) => clean(r.button).toLowerCase() === n) || null;
  }

  const watches = new Map(); // sid -> interval timer

  function endWatch(sid, type) {
    clearInterval(watches.get(sid));
    watches.delete(sid);
    try { chrome.runtime.sendMessage({ type, sid }); } catch (e) {}
  }

  function cancelWatches() {
    [...watches.keys()].forEach((sid) => endWatch(sid, "CANCEL_VERIFY"));
  }

  function watchCompletion(el, sid) {
    const started = Date.now();
    watches.set(sid, setInterval(() => {
      if (!isVisible(el)) endWatch(sid, "CONFIRM_VERIFY");
      else if (Date.now() - started > 5000) endWatch(sid, "CANCEL_VERIFY");
    }, 250));
  }

  // ---------- Login details ----------
  // Works whether the username/password were typed or filled in by Chrome.
  const loggedIn = new WeakSet();

  function loginArea(el) {
    if (el.form) return el.form;
    const form = el.closest("form");
    if (form) return form;
    let node = el.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      if (node.querySelector("input[type=password]")) return node;
    }
    return null;
  }

  function usernameField(area, pw) {
    if (lastTypedEl && lastTypedEl !== pw && area.contains(lastTypedEl) && lastTypedEl.value) return lastTypedEl;
    return [...area.querySelectorAll("input")].find((i) =>
      i !== pw && ["text", "email", ""].includes(i.type) && i.value && isVisible(i)) || null;
  }

  // Returns true if a login step was sent
  function sendLogin(area, pw) {
    if (!area || loggedIn.has(area)) return false;
    const user = usernameField(area, pw);
    if (!user) return false;
    loggedIn.add(area);
    const replaceTyped = lastSentTag === "typed" && lastTypedEl === user;
    lastSentTag = null;
    lastTypedEl = null;
    try {
      chrome.runtime.sendMessage({ type: "LOGIN", user: `${labelFor(user) || "username"}: ${user.value}`, replaceTyped });
    } catch (e) {}
    return true;
  }

  // Clicking a button in a login form whose details were filled in without typing
  function loginOnSubmit(el) {
    const area = loginArea(el);
    if (!area) return;
    const pw = [...area.querySelectorAll("input[type=password]")].find((p) => p.value);
    if (pw) sendLogin(area, pw);
  }

  // ---------- Clicks ----------
  document.addEventListener("click", (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    const el = meaningfulTarget(e.target);
    if (!el) return;

    // Typing, checkboxes and dropdowns are recorded by their own handlers.
    if (isTextEntry(el)) return;
    if (el.tagName === "LABEL" && el.control) return;

    const kind = kindOf(el);
    const name = labelFor(el);
    const recentRightClick = Date.now() - lastRightClick < RIGHT_CLICK_WINDOW;

    if (kind === "menu option" || (kind === "option" && recentRightClick)) {
      const option = name ? b(name) : "an option";
      if (recentRightClick && lastSentTag === "rightclick") {
        // Merge into one step: "Right-click on X and select Settings from the menu"
        lastRightClick = 0;
        send(`Right-click on ${lastRightClickTarget} and select ${option} from the menu`, null, "rightclick");
        return;
      }
      lastRightClick = 0;
      send(`Select ${option} from the menu`);
      return;
    }
    if (kind === "button") loginOnSubmit(el);
    const rule = matchRule(name);
    if (rule) {
      const sid = newId();
      send(`Click on ${describe(el, e.target)}`, null, null, { sid, verify: rule.verify });
      watchCompletion(el, sid);
    } else {
      send(`Click on ${describe(el, e.target)}`);
    }
  }, true);

  // Right-click
  document.addEventListener("contextmenu", (e) => {
    if (!e.isTrusted) return;
    lastRightClick = Date.now();
    const el = meaningfulTarget(e.target);
    lastRightClickTarget = el ? describe(el, e.target) : "the page";
    send(`Right-click on ${lastRightClickTarget}`, "rightclick");
  }, true);

  // Double-click
  document.addEventListener("dblclick", (e) => {
    if (!e.isTrusted) return;
    const el = meaningfulTarget(e.target);
    if (!el || isTextEntry(el)) return;
    send(`Double-click on ${describe(el, e.target)}`);
  }, true);

  // ---------- Typing, dropdowns, checkboxes ----------

  function recordField(el) {
    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      send(`Select ${b(short(opt ? opt.text : el.value))} from ${fieldRef(el, "dropdown")}`);
      return;
    }
    if (el.tagName === "INPUT") {
      if (el.type === "checkbox") {
        send(`${el.checked ? "Check" : "Uncheck"} ${fieldRef(el, "checkbox")}`);
        return;
      }
      if (el.type === "radio") {
        send(`Select ${fieldRef(el, "option")}`);
        return;
      }
      if (el.type === "file") {
        const files = Array.from(el.files || []).map((f) => f.name).join(", ");
        send(`Upload ${files ? b(short(files)) : "a file"} in ${fieldRef(el, "field")}`);
        return;
      }
      if (el.type === "range" || el.type === "color") {
        const name = labelFor(el);
        send(`Set ${name ? "the " + b(name) : "the value"} to ${el.value}`);
        return;
      }
    }

    const value = el.value;
    if (recordedValue.get(el) === value) return;
    recordedValue.set(el, value);

    if (el.type === "password") {
      if (!value) { send(`Clear ${fieldRef(el, "field")}`); return; }
      // Username (typed or filled by Chrome) in the same form -> one login step
      const area = loginArea(el);
      if (!sendLogin(area, el)) {
        if (area) loggedIn.add(area);
        send(`Enter the password in ${fieldRef(el, "field")}`);
      }
      lastTypedEl = null;
      return;
    }
    if (!value) {
      send(`Clear ${fieldRef(el, "field")}`);
      return;
    }
    lastTypedEl = el;
    send(`Enter ${q(short(value, 80))} in ${fieldRef(el, "field")}`, "typed");
  }

  document.addEventListener("change", (e) => {
    if (!e.isTrusted) return;
    const el = e.target;
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      recordField(el);
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!e.isTrusted || e.key !== "Enter" || e.shiftKey) return;
    const el = e.target;
    if (el.tagName === "INPUT" && TEXT_INPUTS.has(el.type)) {
      recordField(el);
      send("Press Enter");
    }
  }, true);

  // Rich text editors (contenteditable)
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el && el.isContentEditable) editableStart.set(el, clean(el.innerText || el.textContent));
  }, true);

  document.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el || !el.isContentEditable || !editableStart.has(el)) return;
    const before = editableStart.get(el);
    const after = clean(el.innerText || el.textContent);
    editableStart.delete(el);
    if (after === before) return;
    const host = el.closest("[aria-label], [role=textbox]") || el;
    const name = host.getAttribute("aria-label") ? short(host.getAttribute("aria-label")) : "";
    const where = name ? `the ${b(name)} editor` : "the editor";
    send(after ? `Type ${q(short(after, 80))} in ${where}` : `Clear ${where}`);
  }, true);

  // ---------- Messages from the extension (keyboard shortcuts, popup) ----------
  const isTop = window.top === window;
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!isTop) return;
      if (msg.type === "VERIFY_MODE") startVerify();
      if (msg.type === "ASK_SECTION") {
        const name = window.prompt("Step Recorder: name of the new section (e.g. Login scenario)");
        if (name && name.trim()) {
          try { chrome.runtime.sendMessage({ type: "SECTION", text: name.trim() }); } catch (e) {}
        }
      }
    });
  } catch (e) {}

  // ---------- Verify mode ----------
  // The next click is NOT passed to the web app. Instead the recorder writes
  // "Verify ... is displayed" using the exact text of what was clicked.
  let verifying = false, overlay = null, banner = null;
  const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "auxclick"];

  function makeBox(styles) {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "fixed", zIndex: "2147483647", pointerEvents: "none", boxSizing: "border-box"
    }, styles);
    return d;
  }

  function setBanner(text, warn) {
    banner.textContent = text;
    banner.style.background = warn ? "#C8342B" : "#1D2733";
  }

  function startVerify() {
    if (verifying) return;
    verifying = true;
    overlay = makeBox({
      border: "2px solid #3C5A78", background: "rgba(60,90,120,0.12)", borderRadius: "3px", display: "none"
    });
    banner = makeBox({
      top: "0", left: "50%", transform: "translateX(-50%)", color: "#fff",
      font: "13px/1.4 Ubuntu, Cantarell, system-ui, sans-serif", padding: "8px 16px",
      borderRadius: "0 0 8px 8px", boxShadow: "0 2px 8px rgba(0,0,0,.25)"
    });
    setBanner("Verify mode: click the text or item to verify. Press Esc to cancel.");
    document.documentElement.append(overlay, banner);
    window.addEventListener("mousemove", onVerifyMove, true);
    BLOCKED.forEach((t) => window.addEventListener(t, onVerifyBlock, true));
    window.addEventListener("keydown", onVerifyKey, true);
  }

  function stopVerify() {
    verifying = false;
    overlay?.remove(); banner?.remove();
    overlay = banner = null;
    window.removeEventListener("mousemove", onVerifyMove, true);
    BLOCKED.forEach((t) => window.removeEventListener(t, onVerifyBlock, true));
    window.removeEventListener("keydown", onVerifyKey, true);
  }

  function onVerifyMove(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || !overlay) return;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px"
    });
  }

  function onVerifyKey(e) {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopImmediatePropagation();
      stopVerify();
    }
  }

  function onVerifyBlock(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== "click" || e.button !== 0) return;
    const step = verifyStep(e.target);
    if (!step) {
      setBanner("No text found there. Click on a piece of text, or press Esc to cancel.", true);
      return;
    }
    try { chrome.runtime.sendMessage({ type: "STEP", text: step }); } catch (err) {}
    lastSentTag = null;
    stopVerify();
  }

  function verifyStep(target) {
    let el = target instanceof Element ? target : target?.parentElement;
    if (!el) return null;

    // Form fields: verify what they currently show
    const field = el.closest("input, select, textarea");
    if (field) {
      if (field.tagName === "SELECT") {
        const opt = field.options[field.selectedIndex];
        return opt ? `Verify ${b(clean(opt.text))} is selected in ${fieldRef(field, "dropdown")}` : null;
      }
      if (field.type === "checkbox") {
        return `Verify ${fieldRef(field, "checkbox")} is ${field.checked ? "checked" : "unchecked"}`;
      }
      if (field.type === "radio") {
        return `Verify ${fieldRef(field, "option")} is ${field.checked ? "selected" : "not selected"}`;
      }
      if (field.type === "password") return `Verify ${fieldRef(field, "field")} is ${field.value ? "filled in" : "empty"}`;
      return field.value
        ? `Verify ${fieldRef(field, "field")} shows ${q(clean(field.value))}`
        : `Verify ${fieldRef(field, "field")} is empty`;
    }

    // Text on the page: the element under the mouse, or a close parent, but
    // never beyond the item that was clicked (a button, link, row, cell ...).
    // Otherwise clicking an icon could pick up a whole toolbar's text.
    const boundary = el.closest(CLICKABLE) || el.closest("li, td, th, p, h1, h2, h3, h4, h5, h6");
    let node = el;
    for (let depth = 0; node && depth < 4; depth++) {
      const t = clean(node.innerText || node.textContent);
      if (t) {
        if (t.length > 150) return null; // a whole panel, not a specific item
        return `Verify ${b(t)} is displayed`;
      }
      if (node === boundary) break;
      node = node.parentElement;
    }

    // No text: use an accessible name on the item itself (icon with a label or tooltip)
    const named = el.closest("[aria-label], [title], img[alt]");
    if (named && (!boundary || boundary.contains(named) || named.contains(boundary))) {
      const name = labelFor(named);
      if (name) return `Verify ${b(name)} is displayed`;
    }
    return null;
  }
})();
