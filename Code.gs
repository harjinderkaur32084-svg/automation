const SHEET_NAMES = {
  accounts: "Accounts",
  progress: "Progress",
  sessions: "Sessions"
};

const TABLE_MASTER_SPREADSHEET_ID = "YOUR_GOOGLE_SHEET_ID";

const HEADERS = {
  Accounts: ["accountId", "name", "normalizedName", "pinSalt", "pinHash", "createdAt"],
  Progress: ["accountId", "progressJson", "updatedAt"],
  Sessions: ["accountId", "tokenHash", "createdAt"]
};

function doPost(event) {
  let requestId = "";
  try {
    const input = JSON.parse((event.parameter && event.parameter.payload) || "{}");
    requestId = String(input.requestId || "");
    const result = routeRequest(input);
    return responsePage({ channel: "table-master-sheets", requestId: requestId, ok: true, result: result });
  } catch (error) {
    const message = error && error.message ? error.message : "The Google Sheets request failed.";
    return responsePage({ channel: "table-master-sheets", requestId: requestId, ok: false, error: message });
  }
}

function setupTableMaster() {
  if (TABLE_MASTER_SPREADSHEET_ID === "YOUR_GOOGLE_SHEET_ID") {
    throw new Error("Set TABLE_MASTER_SPREADSHEET_ID to your private Google Sheet ID before setup.");
  }
  const spreadsheet = SpreadsheetApp.openById(TABLE_MASTER_SPREADSHEET_ID);
  PropertiesService.getScriptProperties().setProperty("TABLE_MASTER_SPREADSHEET_ID", spreadsheet.getId());
  ensureSheets(spreadsheet);
  getPinPepper();
  return "Table Master is connected to " + spreadsheet.getName();
}

function routeRequest(input) {
  if (TABLE_MASTER_SPREADSHEET_ID === "YOUR_GOOGLE_SHEET_ID") {
    throw new Error("Set TABLE_MASTER_SPREADSHEET_ID to your private Google Sheet ID before deployment.");
  }
  const spreadsheetId = TABLE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Run setupTableMaster once from the Apps Script editor.");
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  ensureSheets(spreadsheet);

  switch (input.action) {
    case "ping":
      return { ready: true, spreadsheet: spreadsheet.getName() };
    case "signup":
      return createAccount(spreadsheet, input);
    case "login":
      return signIn(spreadsheet, input);
    case "load":
      return loadProgress(spreadsheet, input);
    case "save":
      return saveProgress(spreadsheet, input);
    case "logout":
      return signOut(spreadsheet, input);
    default:
      throw new Error("Unknown account action.");
  }
}

function ensureSheets(spreadsheet) {
  Object.keys(HEADERS).forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
      sheet.setFrozenRows(1);
    }
  });
}

function createAccount(spreadsheet, input) {
  const name = cleanName(input.name);
  const normalizedName = name.toLocaleLowerCase();
  const pin = cleanPin(input.pin);
  const classNumber = Number(input.classNumber);
  if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 12) {
    throw new Error("Choose a class from 1 to 12.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const accounts = spreadsheet.getSheetByName(SHEET_NAMES.accounts);
    const rows = accounts.getDataRange().getValues();
    if (rows.slice(1).some(function (row) { return row[2] === normalizedName; })) {
      throw new Error("That student name already has an account. Sign in instead, or use a different name.");
    }

    const accountId = Utilities.getUuid();
    const salt = Utilities.getUuid();
    const token = newToken();
    const progress = cleanProgress(input.progress);
    progress.name = name;
    progress.classNumber = classNumber;

    accounts.appendRow([accountId, name, normalizedName, salt, pinDigest(pin, salt), new Date()]);
    writeProgress(spreadsheet, accountId, progress);
    addSession(spreadsheet, accountId, token);
    return { token: token, accountId: accountId, name: name, progress: progress };
  } finally {
    lock.releaseLock();
  }
}

function signIn(spreadsheet, input) {
  const name = cleanName(input.name);
  const normalizedName = name.toLocaleLowerCase();
  const pin = cleanPin(input.pin);
  const accountRows = spreadsheet.getSheetByName(SHEET_NAMES.accounts).getDataRange().getValues();
  const account = accountRows.slice(1).find(function (row) { return row[2] === normalizedName; });
  if (!account) throw new Error("Student name or PIN is incorrect.");

  const cache = CacheService.getScriptCache();
  const attemptsKey = "pin-attempts:" + normalizedName;
  const attempts = Number(cache.get(attemptsKey) || 0);
  if (attempts >= 5) throw new Error("Too many tries. Please wait 15 minutes before trying again.");
  if (!constantTimeEquals(pinDigest(pin, String(account[3])), String(account[4]))) {
    cache.put(attemptsKey, String(attempts + 1), 900);
    throw new Error("Student name or PIN is incorrect.");
  }
  cache.remove(attemptsKey);

  const token = newToken();
  addSession(spreadsheet, String(account[0]), token);
  const progress = readProgress(spreadsheet, String(account[0]));
  if (progress.name === "Student") progress.name = String(account[1]);
  return { token: token, accountId: String(account[0]), name: String(account[1]), progress: progress };
}

function loadProgress(spreadsheet, input) {
  const accountId = accountForToken(spreadsheet, input.token);
  return { accountId: accountId, progress: readProgress(spreadsheet, accountId) };
}

function saveProgress(spreadsheet, input) {
  const accountId = accountForToken(spreadsheet, input.token);
  const progress = cleanProgress(input.progress);
  writeProgress(spreadsheet, accountId, progress);
  return { saved: true, updatedAt: new Date().toISOString() };
}

function signOut(spreadsheet, input) {
  const tokenHash = digest(String(input.token || ""));
  const sessions = spreadsheet.getSheetByName(SHEET_NAMES.sessions);
  const rows = sessions.getDataRange().getValues();
  for (let index = rows.length - 1; index >= 1; index--) {
    if (String(rows[index][1]) === tokenHash) sessions.deleteRow(index + 1);
  }
  return { signedOut: true };
}

function accountForToken(spreadsheet, token) {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) {
    throw new Error("Your sign-in expired. Please sign in again.");
  }
  const tokenHash = digest(token);
  const sessions = spreadsheet.getSheetByName(SHEET_NAMES.sessions).getDataRange().getValues();
  const session = sessions.slice(1).find(function (row) { return String(row[1]) === tokenHash; });
  if (!session) throw new Error("Your sign-in expired. Please sign in again.");
  return String(session[0]);
}

function addSession(spreadsheet, accountId, token) {
  spreadsheet.getSheetByName(SHEET_NAMES.sessions).appendRow([accountId, digest(token), new Date()]);
}

function readProgress(spreadsheet, accountId) {
  const rows = spreadsheet.getSheetByName(SHEET_NAMES.progress).getDataRange().getValues();
  const record = rows.slice(1).find(function (row) { return String(row[0]) === accountId; });
  if (!record || !record[1]) return { name: "", classNumber: 1, stars: 0, completed: [], quizScores: [], practice: {} };
  try {
    return cleanProgress(JSON.parse(String(record[1])));
  } catch (error) {
    throw new Error("Saved progress could not be read. Ask a parent to check the Progress sheet.");
  }
}

function writeProgress(spreadsheet, accountId, progress) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAMES.progress);
  const rows = sheet.getDataRange().getValues();
  const existingIndex = rows.slice(1).findIndex(function (row) { return String(row[0]) === accountId; });
  const rowNumber = existingIndex < 0 ? sheet.getLastRow() + 1 : existingIndex + 2;
  const json = JSON.stringify(progress);
  sheet.getRange(rowNumber, 1, 1, 3).setNumberFormat("@");
  sheet.getRange(rowNumber, 1, 1, 3).setValues([[accountId, json, new Date().toISOString()]]);
}

function cleanProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Learning progress is invalid.");
  }
  const result = {
    name: cleanStudentLabel(value.name),
    classNumber: Math.min(12, Math.max(1, Number(value.classNumber) || 1)),
    stars: Math.max(0, Math.min(1000000, Number(value.stars) || 0)),
    completed: Array.isArray(value.completed)
      ? Array.from(new Set(value.completed.map(Number).filter(function (number) { return Number.isInteger(number) && number >= 1 && number <= 100; })))
      : [],
    quizScores: Array.isArray(value.quizScores) ? value.quizScores.slice(0, 20) : [],
    practice: value.practice && typeof value.practice === "object" && !Array.isArray(value.practice) ? value.practice : {},
    lastPractice: typeof value.lastPractice === "string" ? value.lastPractice.slice(0, 20) : "",
    streak: Math.max(0, Math.min(100000, Number(value.streak) || 0)),
    dailyCompleted: typeof value.dailyCompleted === "string" ? value.dailyCompleted.slice(0, 20) : "",
    theme: value.theme === "dark" ? "dark" : "light",
    language: value.language === "hi" ? "hi" : "en"
  };
  const json = JSON.stringify(result);
  if (json.length > 45000) throw new Error("The saved learning record is too large.");
  return result;
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 24 || !/^[\p{L}\p{N} ._-]+$/u.test(name)) {
    throw new Error("Use a 2–24 character student name with letters, numbers or spaces.");
  }
  return name;
}

function cleanStudentLabel(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return name || "Student";
}

function cleanPin(value) {
  const pin = String(value || "");
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits.");
  return pin;
}

function pinDigest(pin, salt) {
  return digest(salt + ":" + pin + ":" + getPinPepper());
}

function getPinPepper() {
  const properties = PropertiesService.getScriptProperties();
  let pepper = properties.getProperty("TABLE_MASTER_PIN_PEPPER");
  if (!pepper) {
    pepper = newToken();
    properties.setProperty("TABLE_MASTER_PIN_PEPPER", pepper);
  }
  return pepper;
}

function digest(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}

function constantTimeEquals(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function newToken() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function responsePage(response) {
  const serialized = JSON.stringify(response).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const html = "<!doctype html><html><body><script>window.top.postMessage(" + serialized + ", '*');</script></body></html>";
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
