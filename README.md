# Step Recorder

A free, lightweight Chrome extension that records your clicks, typing, and page changes as plain-English steps — ready to copy into a Jira ticket or export to Word or a text file.

No AI, no account, no knowledge base. Install it and start recording.

> Great for writing test scenarios by hand, documenting bug reproductions, or producing clean step lists that an AI automation can read straight from a Jira description.

---

## Features

- **Records as you navigate** — every click, keystroke, and page change becomes a numbered step automatically.
- **Plain English** — steps read like normal sentences, so testers, developers, and business analysts can all follow them.
- **Sections** — group steps under headings (e.g. "Login scenario") while recording.
- **Auto-verify rules** — after you click configured buttons (e.g. *Change Status*), a verify step is added automatically if the window closes or the page changes within 5 seconds.
- **Login safety** — username and password typed in the same form become sub-points, and the real password is never recorded or stored.
- **Edit anything** — click any step to edit it; bold stays bold, and `Ctrl+B` makes selected words bold.
- **Export** — copy to Jira (keeps sections, numbering, sub-points, and bold), save as Word (`.doc`), or save as plain text (`.txt`).
- **Multi-tab** — records the tab you started in and any tabs it opens.

---

## Install

1. Download or clone this repository.
   ```bash
   git clone https://github.com/RushDoshi/step-recorder.git
   ```
2. Open **chrome://extensions** in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `step-recorder` folder.
5. Pin the Step Recorder icon from the extensions menu for quick access.

---

## Record a scenario

1. Open your web app, then click the Step Recorder icon.
2. *(Optional)* Type the first section name, e.g. "Login scenario", and click **Add section**.
3. Click **Start recording** and use the app normally.

### While recording

| Action | How |
| --- | --- |
| New section | `Alt + Shift + S`, then type the name |
| Verify on page | `Alt + Shift + V`, then click the text to verify (the app does not receive that click). Press `Esc` to cancel. |
| Add your own step | Open the popup, type it, click **Add step** |

Shortcuts can be changed at **chrome://extensions/shortcuts**.

### Auto-verify after buttons

In the popup, open **Auto-verify after buttons** to see or change the rules. Defaults:

| When clicked | Verify step added |
| --- | --- |
| Change Status | Verify the Status change should be created successfully |
| Assign Attributes | Verify Assign Attributes should be created successfully |

The verify step is added only if the button's window closes or the page changes within 5 seconds of the click, and you take no other action first. If the window stays open (e.g. a validation error), no verify step is added.

---

## After recording

- Click any text to edit it. Bold stays bold; `Ctrl+B` makes selected words bold.
- Hover a step: **§** adds a section heading above it, **×** deletes it.
- **Copy steps** — paste into Jira (sections, numbers, sub-points, bold names preserved).
- **Save Word** — keeps the same layout; **Save .txt** — plain text.

---

## Notes

- Login username and password typed in the same form become sub-points:
  ```
  username: <what you typed>
  password: <password>
  ```
  The real password is never recorded or stored.
- Other typed values **are** recorded. Review before sharing if sensitive.
- Only the tab you started in (and tabs it opens) is recorded.
- Chrome's own pages (`chrome://`, the Web Store) cannot be recorded.

---

## License

[MIT](LICENSE) © Rushabh Doshi
