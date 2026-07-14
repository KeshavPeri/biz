# Build Devasri's logging form (5 minutes, no coding)

This creates the **"Log an Inflo issue"** Google Form and wires it to your tracker sheet so
every submission drops straight into the **Defects & refinements log** tab (with an auto ID +
today's date + Status "New"). Devasri can then log issues **either** via the form **or** by
editing the sheet — both end up in the same place.

## Steps

1. Open the tracker sheet in Google Sheets:
   https://docs.google.com/spreadsheets/d/1YJ5CMGCPFBrDwV3-BbSM6iU7DKyZuU4KZ1aaSrMa53c/edit
2. Top menu → **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete any sample code shown, then **paste the entire contents of `setup-inflo-form.gs`**.
   Click the **Save** icon (💾).
4. In the toolbar's function dropdown, pick **`setUpInfloForm`**, then click **Run** (▶).
5. Google will ask you to **authorize** — it's your own script acting on your own sheet.
   Choose your account → "Advanced" → "Go to (project) → Allow. (One time.)
6. When it finishes, open **Execution log** (bottom of the screen). It prints two links:
   - **FORM** → this is the one you share with Devasri.
   - **EDIT** → for you, if you ever want to tweak the questions.

That's it. A "Form Responses" tab also appears in the sheet as a raw backup — you can ignore it;
the clean data lands in the Defects log automatically.

## Optional upgrade — let her upload a photo directly (30 seconds)

The script adds a **"Screenshot link"** text field (works everywhere). Google's scripting can't
create a **file-upload** question, so if you want Devasri to attach a screenshot straight from
her phone (much easier on mobile), add it by hand:

1. Open the form via the **EDIT** link → click **+** to add a question.
2. Set the question type to **File upload** → allow images → title it "Screenshot".
3. Drag it above "RTM ID", and (optional) delete the "Screenshot link" text field.

Uploaded files land in your Drive and the response records a link to them automatically.

## Notes

- Re-running `setUpInfloForm` creates a **new** form — only do it if you want to start over
  (the script removes its old submit-trigger so you won't get duplicate rows).
- The form's choices (Area, Type, Priority, Reporter) match the sheet's dropdowns exactly, so
  the log's colour-coding fills in on every submission.
