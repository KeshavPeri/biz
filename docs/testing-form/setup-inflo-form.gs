/**
 * Inflo Tester — form generator
 * -----------------------------------------------------------------------------
 * Run this ONCE from the Inflo Testing Tracker sheet. It will:
 *   1. Create a Google Form ("Log an Inflo issue").
 *   2. Link the form's raw responses to THIS spreadsheet (a backup tab).
 *   3. Add a trigger so every submission ALSO appends a clean row into the
 *      "Defects & refinements log" tab (auto ID + today's date + Status "New").
 *
 * So Devasri can log via the FORM or by editing the SHEET directly — both land
 * in the same log.
 *
 * HOW TO RUN (about 1 minute):
 *   a. Open the tracker sheet in Google Sheets.
 *   b. Menu:  Extensions → Apps Script.
 *   c. Delete any sample code, paste ALL of this file, click Save.
 *   d. In the function dropdown choose  setUpInfloForm  → click Run.
 *   e. Google asks you to authorize (it's your own script) → Allow.
 *   f. Open  View → Logs  (or the Execution log). It prints two links:
 *        • FORM (share this one with Devasri)
 *        • EDIT (for you, to tweak the form)
 * Re-running makes a NEW form; only run again if you want to start over.
 * -----------------------------------------------------------------------------
 */

// This spreadsheet's ID (from its URL). Already filled in for your tracker.
var SHEET_ID = '1YJ5CMGCPFBrDwV3-BbSM6iU7DKyZuU4KZ1aaSrMa53c';
var LOG_TAB  = 'Defects & refinements log';

function setUpInfloForm() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var form = FormApp.create('Log an Inflo issue')
    .setDescription(
      'Quick way to log anything you find while testing Inflo. ' +
      'Not sure if something is a bug or just not built yet? Pick Type = Question. ' +
      'See the tracker’s "Roadmap" tab for what’s planned vs built.')
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setLimitOneResponsePerUser(false);

  // 1 · Area / Screen
  form.addMultipleChoiceItem()
    .setTitle('Area / Screen')
    .setChoiceValues(['Auth','Creator onboarding','Brand onboarding','Signature',
                      'Maker-checker','Account','Navigation/App-wide','Other'])
    .setRequired(true);

  // 2 · Type
  form.addMultipleChoiceItem()
    .setTitle('Type')
    .setHelpText('Defect = broken · Refinement = works but could be better · Blocker = can’t continue')
    .setChoiceValues(['Defect','Refinement','Design/polish','Copy/wording','Blocker','Question'])
    .setRequired(true);

  // 3 · Priority
  form.addMultipleChoiceItem()
    .setTitle('Priority')
    .setChoiceValues(['Blocker','High','Medium','Low'])
    .setRequired(true);

  // 4 · Title
  form.addTextItem()
    .setTitle('Title')
    .setHelpText('One-line summary')
    .setRequired(true);

  // 5 · Description
  form.addParagraphTextItem()
    .setTitle('Description')
    .setHelpText('What happened, and what you expected instead')
    .setRequired(true);

  // 6 · Steps to reproduce
  form.addParagraphTextItem()
    .setTitle('Steps to reproduce')
    .setHelpText('Numbered steps so Keshav can repeat it');

  // 7 · Screenshot link
  //   Note: Apps Script cannot create a "File upload" question. This text field
  //   works immediately. To let Devasri upload a photo straight from her phone,
  //   see the OPTIONAL upgrade in the run guide (a 30-second manual step).
  form.addTextItem()
    .setTitle('Screenshot link')
    .setHelpText('Optional — paste a link to a screenshot if you have one');

  // 8 · RTM ID (optional)
  form.addTextItem()
    .setTitle('RTM ID')
    .setHelpText('Optional — the feature ID from the checklist tab, e.g. B1-006');

  // 9 · Reporter
  form.addMultipleChoiceItem()
    .setTitle('Reporter')
    .setChoiceValues(['Devasri','Keshav'])
    .setRequired(true);

  // Backup: raw responses into this spreadsheet (creates a "Form Responses" tab).
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SHEET_ID);

  // Clean append into the styled Defects log on every submit.
  removeOldTriggers_();
  ScriptApp.newTrigger('onInfloFormSubmit_')
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log('FORM (share with Devasri): ' + form.getPublishedUrl());
  Logger.log('EDIT (for you):            ' + form.getEditUrl());
}

/** Appends each form response as a clean row in the Defects log. */
function onInfloFormSubmit_(e) {
  var ss  = SpreadsheetApp.openById(SHEET_ID);
  var log = ss.getSheetByName(LOG_TAB);
  if (!log) return;

  var v = e.namedValues; // keys = question titles, values = arrays
  function g(k){ return (v[k] && v[k][0]) ? v[k][0] : ''; }

  // Entries live from row 3 down (row 2 is the EXAMPLE row).
  var colA = log.getRange(3, 1, Math.max(1, log.getMaxRows() - 2), 1).getValues();
  var used = colA.filter(function(r){ return String(r[0]).trim() !== ''; }).length;
  var targetRow = 3 + used;                       // assumes contiguous entries
  var id   = 'D-' + ('000' + (used + 1)).slice(-3);
  var date = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var reporter = g('Reporter') || 'Devasri';

  // Columns: A ID · B Date · C Reporter · D Area · E Type · F Priority · G Title
  //          H Description · I Steps · J Screenshot · K Status · L RTM ID · M Notes
  log.getRange(targetRow, 1, 1, 13).setValues([[
    id, date, reporter,
    g('Area / Screen'), g('Type'), g('Priority'),
    g('Title'), g('Description'), g('Steps to reproduce'),
    g('Screenshot link'), 'New', g('RTM ID'), ''
  ]]);
}

/** Avoids stacking duplicate submit triggers if you re-run setup. */
function removeOldTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'onInfloFormSubmit_') ScriptApp.deleteTrigger(t);
  });
}
