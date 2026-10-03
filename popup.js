const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const BOLD = /\*\*(.+?)\*\*/g;
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const toHtml = (text) => escapeHtml(text).replace(BOLD, "<b>$1</b>");
const toPlain = (text) => text.replace(BOLD, "$1");

let state = { recording: false, steps: [], title: "", startedAt: null };

function toast(text) {
  $("toast").textContent = text;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($("toast").textContent = ""), 3000);
}

// Old recordings (before sections existed) have no "kind"
const isSection = (item) => item.kind === "section";

// ---------- Editable text ----------
// Steps are edited as they look: bold stays bold and the cursor stays where
// you click. Ctrl+B toggles bold. Stored text uses **stars** for bold.
function fromEditable(node) {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { out += child.nodeValue; return; }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    if (child.tagName === "BR") { out += " "; return; }
    const weight = parseInt(getComputedStyle(child).fontWeight, 10);
    const bold = child.tagName === "B" || child.tagName === "STRONG" || weight >= 600;
    const inner = fromEditable(child);
    out += bold && inner.trim() ? `**${inner.replace(/\*\*/g, "")}**` : inner;
  });
  return out;
}

function tidy(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\*\*(\s*)\*\*/g, "$1")               // merge touching bold parts
    .replace(/\*\*\s+/g, (m, o, s) => "** ")      // keep spacing readable
    .replace(/\*\*([^*]*?)\s+\*\*/g, "**$1** ")
    .replace(/\*\*\s*\*\*/g, "")
    .trim();
}

function editable(text, onSave) {
  const p = document.createElement("p");
  p.innerHTML = toHtml(text);
  p.contentEditable = "true";
  p.spellcheck = false;
  p.title = "Click to edit. Ctrl+B makes words bold.";
  p.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); p.blur(); } });
  // Paste as plain text so no outside formatting sneaks in
  p.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  });
  p.addEventListener("blur", () => {
    const value = tidy(fromEditable(p));
    if (value === text) { p.innerHTML = toHtml(text); return; }
    onSave(value);
  });
  return p;
}

function iconButton(label, title, onClick, cls = "") {
  const btn = document.createElement("button");
  btn.className = "icon " + cls;
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", onClick);
  return btn;
}

function render() {
  $("rec").classList.toggle("on", state.recording);
  $("recLabel").textContent = state.recording ? "Stop recording" : (state.steps.length ? "Continue recording" : "Start recording");
  $("verifyPage").disabled = !state.recording;

  if (document.activeElement !== $("title")) $("title").value = state.title || "";

  const n = state.steps.filter((s) => !isSection(s)).length;
  $("count").textContent = n ? `${n} step${n === 1 ? "" : "s"} · click any text to edit it` : "No steps yet";
  $("empty").hidden = state.steps.length > 0;
  ["saveTxt", "saveDoc", "copy", "clear"].forEach((id) => ($(id).disabled = state.steps.length === 0));

  // Don't redraw while the user is editing
  if (document.activeElement && document.activeElement.closest("#steps")) return;

  const list = $("steps");
  list.innerHTML = "";
  let num = 0;
  state.steps.forEach((item, i) => {
    const li = document.createElement("li");
    if (isSection(item)) {
      li.className = "section";
      const p = editable(item.text, (t) => send(t ? { type: "EDIT", index: i, text: t } : { type: "DELETE", index: i }));
      li.append(p, iconButton("×", "Delete this section heading", () => send({ type: "DELETE", index: i }), "del"));
      list.append(li);
      return;
    }
    num++;
    const numEl = document.createElement("span");
    numEl.className = "num";
    numEl.textContent = num + ".";
    const body = document.createElement("div");
    body.append(editable(item.text, (t) => send(t ? { type: "EDIT", index: i, text: t } : { type: "DELETE", index: i })));
    if (item.subs && item.subs.length) {
      const ol = document.createElement("ol");
      ol.className = "subs";
      item.subs.forEach((sub, j) => {
        const sli = document.createElement("li");
        sli.append(editable(sub, (t) => send(t ? { type: "EDIT", index: i, sub: j, text: t } : { type: "DELETE", index: i, sub: j })));
        sli.append(iconButton("×", "Delete this sub-point", () => send({ type: "DELETE", index: i, sub: j }), "del"));
        ol.append(sli);
      });
      body.append(ol);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      iconButton("§", "Add a section heading above this step", () => {
        const name = prompt("Section name (e.g. Login scenario)");
        if (name && name.trim()) send({ type: "INSERT_SECTION", index: i, text: name.trim() });
      }),
      iconButton("×", "Delete this step", () => send({ type: "DELETE", index: i }), "del")
    );
    li.append(numEl, body, actions);
    list.append(li);
  });
  list.scrollTop = list.scrollHeight;
}

async function load() {
  state = await chrome.storage.local.get({ recording: false, steps: [], title: "", startedAt: null });
  render();
}

chrome.storage.onChanged.addListener((changes) => {
  for (const [k, v] of Object.entries(changes)) state[k] = v.newValue;
  render();
});

// ---------- Controls ----------
$("rec").addEventListener("click", async () => {
  if (state.recording) {
    await send({ type: "STOP" });
    toast("Recording stopped");
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:|^file:/.test(tab.url || "")) {
    toast("Open your web app in this tab first, then start recording.");
    return;
  }
  await send({ type: "START", tabId: tab.id });
  window.close(); // get out of the way so the user can start working
});

$("verifyPage").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "VERIFY_MODE" }, { frameId: 0 });
    window.close();
  } catch (e) {
    toast("Refresh the web app page (F5) and try again.");
  }
});

$("title").addEventListener("input", (e) => send({ type: "TITLE", title: e.target.value }));

function addNote(kind) {
  const text = $("noteText").value.trim();
  if (!text || text === "Verify") return;
  send({ type: "NOTE", text, kind });
  $("noteText").value = "";
  toast(kind === "section" ? "Section added. New steps will go under it." : "Step added");
}
$("addStep").addEventListener("click", () => addNote("step"));
$("addSection").addEventListener("click", () => addNote("section"));
$("verifyText").addEventListener("click", () => {
  const box = $("noteText");
  if (!/^verify\b/i.test(box.value)) box.value = "Verify " + box.value.trimStart();
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
});
$("noteText").addEventListener("keydown", (e) => { if (e.key === "Enter") addNote("step"); });

$("clear").addEventListener("click", () => {
  if (confirm("Delete all recorded steps and sections?")) send({ type: "CLEAR" });
});

// ---------- Export ----------
function scenarioName() {
  return state.title.trim() || "Recorded scenario";
}
function fileBase() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${scenarioName().replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "scenario"}_${stamp}`;
}
function dateLine() {
  return new Date(state.startedAt || Date.now()).toLocaleString();
}

// Groups: [{ heading: string|null, steps: [{ num, text, subs }] }]
// Numbering continues across sections (1 … N).
function groups() {
  const out = [];
  let current = null, num = 0;
  for (const item of state.steps) {
    if (isSection(item)) {
      current = { heading: item.text, steps: [] };
      out.push(current);
      continue;
    }
    if (!current) { current = { heading: null, steps: [] }; out.push(current); }
    current.steps.push({ num: ++num, text: item.text, subs: item.subs || [] });
  }
  return out;
}

// Plain text: headings, blank lines between sections, indented sub-points
function stepsAsText() {
  const blocks = groups().map((g) => {
    const lines = [];
    if (g.heading) lines.push(toPlain(g.heading), "");
    for (const s of g.steps) {
      lines.push(`${s.num}. ${toPlain(s.text)}`);
      s.subs.forEach((sub, j) => lines.push(`   ${j + 1}. ${toPlain(sub)}`));
    }
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

// HTML (for Jira paste and Word): bold headings, numbers written as text so
// they stay exactly as shown, sub-points indented
function stepsAsHtml() {
  return groups().map((g) => {
    let html = g.heading ? `<p><b>${toHtml(g.heading)}</b></p>` : "";
    const lines = [];
    for (const s of g.steps) {
      lines.push(`${s.num}. ${toHtml(s.text)}`);
      s.subs.forEach((sub, j) => lines.push(`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${j + 1}. ${toHtml(sub)}`));
    }
    if (lines.length) html += `<p>${lines.join("<br>")}</p>`;
    return html;
  }).join("");
}

function asText() {
  return [
    `Scenario: ${scenarioName()}`,
    `Recorded: ${dateLine()}`,
    "",
    "Steps to reproduce:",
    "",
    stepsAsText()
  ].join("\n") + "\n";
}

// Word opens HTML saved with a .doc extension as a normal document
// (so do LibreOffice Writer and Google Docs).
function asWord() {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${escapeHtml(scenarioName())}</title>
<style>
 body { font-family: Calibri, "Liberation Sans", Arial, sans-serif; font-size: 11pt; }
 h1 { font-size: 16pt; margin-bottom: 2pt; }
 p.meta { color: #555; margin-top: 0; }
 p { line-height: 1.5; }
</style></head>
<body>
<h1>${escapeHtml(scenarioName())}</h1>
<p class="meta">Recorded: ${escapeHtml(dateLine())}</p>
<h2 style="font-size:13pt">Steps to reproduce</h2>
${stepsAsHtml()}
</body></html>`;
}

function download(content, mime, filename) {
  const url = `data:${mime};charset=utf-8,` + encodeURIComponent(content);
  chrome.downloads.download({ url, filename, saveAs: true });
}

$("saveTxt").addEventListener("click", () => download(asText(), "text/plain", `${fileBase()}.txt`));
$("saveDoc").addEventListener("click", () => download("\ufeff" + asWord(), "application/msword", `${fileBase()}.doc`));
$("copy").addEventListener("click", async () => {
  // Rich copy keeps bold in Jira; plain text is included as a fallback.
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([stepsAsHtml()], { type: "text/html" }),
      "text/plain": new Blob([stepsAsText()], { type: "text/plain" })
    })]);
  } catch (e) {
    await navigator.clipboard.writeText(stepsAsText());
  }
  toast("Steps copied. Paste them into your Jira ticket.");
});

// ---------- Auto-verify rules ----------
let rules = [];
function renderRules() {
  $("ruleCount").textContent = rules.length;
  const list = $("ruleList");
  list.innerHTML = "";
  rules.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "rule";
    const text = document.createElement("div");
    const when = document.createElement("div");
    when.className = "when";
    when.innerHTML = `When <b>${escapeHtml(r.button)}</b> is clicked:`;
    const what = document.createElement("div");
    what.innerHTML = toHtml(r.verify);
    text.append(when, what);
    row.append(text, iconButton("×", "Delete this rule", async () => {
      rules.splice(i, 1);
      await chrome.storage.local.set({ rules });
    }, "del"));
    list.append(row);
  });
}
async function loadRules() {
  rules = (await chrome.storage.local.get({ rules: [] })).rules || [];
  renderRules();
}
chrome.storage.onChanged.addListener((ch) => { if (ch.rules) { rules = ch.rules.newValue || []; renderRules(); } });
$("ruleAdd").addEventListener("click", async () => {
  const button = $("ruleButton").value.replace(/\s+/g, " ").trim();
  const verify = $("ruleVerify").value.replace(/\s+/g, " ").trim();
  if (!button || !verify) { toast("Fill in both the button name and the verify step."); return; }
  const existing = rules.findIndex((r) => r.button.toLowerCase() === button.toLowerCase());
  if (existing >= 0) rules[existing] = { button, verify }; else rules.push({ button, verify });
  await chrome.storage.local.set({ rules });
  $("ruleButton").value = ""; $("ruleVerify").value = "";
  toast(existing >= 0 ? "Rule updated" : "Rule added");
});

load();
loadRules();
