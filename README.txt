STEP RECORDER 1.2.0 - Chrome extension (free, works on Ubuntu)

INSTALL / UPDATE
1. Unzip over your step-recorder folder (choose Replace if asked)
2. chrome://extensions -> click the reload icon on Step Recorder
3. Refresh your web app tab (F5)

RECORD A SCENARIO
1. Open your web app, click the Step Recorder icon
2. (Optional) type the first section name, e.g. "Login scenario", click "Add section"
3. Click "Start recording" and use the app normally

WHILE RECORDING
- New section:     Alt+Shift+S  -> type the section name
- Verify on page:  Alt+Shift+V  -> click the text to verify (the app does not
                   receive that click). Writes: Verify <text> is displayed.
                   Press Esc to cancel.
- Your own step:   open the popup, type it, click "Add step"
                   ("Verify..." starts the text with "Verify")
- Shortcuts can be changed at chrome://extensions/shortcuts

AUTO-VERIFY AFTER BUTTONS
- In the popup, open "Auto-verify after buttons" to see or change the rules.
  Default rules:
    Change Status     -> Verify the Status change should be created successfully
    Assign Attributes -> Verify Assign Attributes should be created successfully
- The verify step is added only if the button's window closes or the page
  changes within 5 seconds of the click, and you take no other action first.
  If the window stays open (e.g. a validation error), no verify step is added.

AFTER RECORDING
- Click any text to edit it. Bold stays bold; Ctrl+B makes selected words bold
- Hover a step: "§" adds a section heading above it, "x" deletes it
- "Copy steps" -> paste into Jira (sections, numbers, sub-points, bold names)
- "Save Word" keeps the same layout; "Save .txt" is plain text

NOTES
- Login: username and password typed in the same form become sub-points:
    username: <what you typed>
    password: <password>
  The real password is never recorded or stored.
- Other typed values ARE recorded. Review before sharing if sensitive.
- Only the tab you started in (and tabs it opens) is recorded.
