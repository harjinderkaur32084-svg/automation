(() => {
  "use strict";

  const STORAGE_KEY = "tableMaster.student.v1";
  const AUTH_KEY = "tableMaster.account.v1";
  const SCRIPT_URL_KEY = "tableMaster.appsScriptUrl";
  const CLASS_LIMITS = [5, 5, 10, 10, 20, 20, 30, 30, 50, 50, 100, 100];
  const TABLE_MULTIPLIERS = 20;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const TABLE_TIPS = {
    2: "Double the number: 2 × 6 is the same as 6 + 6.",
    4: "Double the number, then double your answer once more.",
    5: "Answers end in 5 or 0. Count by fives!",
    9: "The digits in each answer add up to 9 (up to 9 × 10).",
    10: "Add a zero to the number you are multiplying.",
    11: "For 1–9, say the number twice: 11 × 7 = 77.",
    12: "Split 12 into 10 + 2, multiply both parts and add."
  };
  const TRICKS = {
    2: "Double the number, then double again!",
    4: "Double the number, then double your answer again.",
    5: "Count by fives. The answers end in 0 or 5.",
    9: "Try the finger trick, or check that the answer's digits add to 9.",
    10: "Add a zero to the end of the number.",
    11: "For 1–9, repeat the number: 11 × 7 = 77.",
    12: "Multiply by 10 and by 2, then add both answers."
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const todayKey = () => new Date().toLocaleDateString("en-CA");

  function isAppsScriptUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.hostname === "script.google.com" &&
        /^\/(?:macros\/(?:u\/\d+\/)?|a\/macros\/[a-z0-9.-]+\/)s\/[^/]+\/(?:exec|dev)\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function newStudent() {
    return {
      name: "",
      classNumber: 1,
      stars: 0,
      completed: [],
      quizScores: [],
      practice: {},
      lastPractice: "",
      streak: 0,
      dailyCompleted: "",
      theme: "light",
      language: "en"
    };
  }

  function loadStudent() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return newStudent();
      const base = newStudent();
      const result = { ...base, ...saved };
      result.classNumber = Math.min(12, Math.max(1, Number(result.classNumber) || 1));
      result.stars = Math.max(0, Number(result.stars) || 0);
      result.completed = Array.isArray(result.completed) ? [...new Set(result.completed.map(Number).filter(n => n >= 1 && n <= 100))] : [];
      result.quizScores = Array.isArray(result.quizScores) ? result.quizScores.slice(0, 20) : [];
      result.practice = result.practice && typeof result.practice === "object" ? result.practice : {};
      return result;
    } catch (error) {
      console.warn("Could not load saved learning progress.", error);
      return newStudent();
    }
  }

  let student = loadStudent();
  let currentTable = 7;
  let answersVisible = true;
  let currentPage = "home";
  let toastTimer;
  let quiz = null;
  let game = null;
  let speedTimer = null;
  let speechLine = -1;
  let translated = false;
  let authSession = loadAuthSession();
  let authRequired = !authSession;
  let authMode = "login";
  let cloudSaveTimer = null;
  let cloudSaveInFlight = false;
  let cloudSaveQueued = false;
  let cloudSavePromise = Promise.resolve();
  const pendingRequests = new Map();

  function loadAuthSession() {
    try {
      const value = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return value && typeof value.token === "string" && typeof value.endpoint === "string" ? value : null;
    } catch (error) {
      console.warn("Could not load the saved account session.", error);
      return null;
    }
  }

  function requestSheets(action, values = {}, endpoint = authSession?.endpoint || localStorage.getItem(SCRIPT_URL_KEY) || "https://script.google.com/macros/s/AKfycbx6otsqYR97K0Xpe5Gye9y0OBmOQPkx-GZe-B8TZng/dev") {
    return new Promise((resolve, reject) => {
      if (!isAppsScriptUrl(endpoint)) {
        reject(new Error("Paste a valid deployed Google Apps Script web app URL ending in /exec."));
        return;
      }
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const iframe = $("#sheets-bridge");
      const form = document.createElement("form");
      form.method = "post";
      form.action = endpoint;
      form.target = iframe.name;
      form.hidden = true;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify({ requestId, action, ...values });
      form.append(input);
      pendingRequests.set(requestId, { resolve, reject, form });
      document.body.append(form);
      form.submit();
      setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (!pending) return;
        pendingRequests.delete(requestId);
        form.remove();
        reject(new Error("Google Sheets did not respond. Check the deployed web app URL and try again."));
      }, 25000);
    });
  }

  function handleSheetsResponse(event) {
    const response = event.data;
    if (!response || response.channel !== "table-master-sheets" || !response.requestId) return;
    const pending = pendingRequests.get(response.requestId);
    const bridge = $("#sheets-bridge").contentWindow;
    if (!pending || !isFrameDescendant(bridge, event.source)) return;
    pendingRequests.delete(response.requestId);
    pending.form.remove();
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error || "Google Sheets request failed."));
  }

  function isFrameDescendant(frameWindow, sourceWindow) {
    if (!frameWindow || !sourceWindow) return false;
    if (frameWindow === sourceWindow) return true;
    try {
      for (let index = 0; index < frameWindow.frames.length; index++) {
        if (isFrameDescendant(frameWindow.frames[index], sourceWindow)) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function setAuthSession(session) {
    authSession = session;
    if (session) authRequired = false;
    if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_KEY);
    renderAccountButton();
  }

  function renderAccountButton() {
    const button = $("#account-button");
    if (!button) return;
    button.textContent = authSession ? `☁ ${displayName()}` : "Sign in";
    button.title = authSession ? "Google Sheets account options" : "Sign in to save progress to Google Sheets";
  }

  function renderSheetsStatus(message = "") {
    const status = $("#sheets-connection-status");
    if (!status) return;
    if (message) {
      status.textContent = message;
      return;
    }
    const endpoint = localStorage.getItem(SCRIPT_URL_KEY) || "";
    status.textContent = authSession
      ? `Connected as ${displayName()}. Progress syncs to Google Sheets.`
      : endpoint
        ? "Connection URL saved. Students can now sign in with their name and PIN."
        : "Not configured yet. A parent needs to paste the deployed Apps Script URL.";
  }

  function scheduleCloudSave() {
    if (!authSession) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(syncProgress, 700);
  }

  async function syncProgress() {
    if (!authSession) return;
    if (cloudSaveInFlight) {
      cloudSaveQueued = true;
      return cloudSavePromise;
    }
    cloudSaveInFlight = true;
    cloudSavePromise = (async () => {
      try {
        await requestSheets("save", { token: authSession.token, progress: student });
      } catch (error) {
        console.error("Google Sheets progress sync failed.", error);
        if (/sign-in expired/i.test(error.message)) {
          setAuthSession(null);
          authRequired = true;
          openAccountDialog("login");
          $("#account-error").textContent = "Your sign-in expired. Please sign in again to sync your progress.";
        } else {
          showToast("Could not sync to Google Sheets. Your progress is still saved on this device.");
        }
      } finally {
        cloudSaveInFlight = false;
        if (cloudSaveQueued) {
          cloudSaveQueued = false;
          scheduleCloudSave();
        }
      }
    })();
    return cloudSavePromise;
  }

  async function flushCloudProgress() {
    clearTimeout(cloudSaveTimer);
    if (cloudSaveInFlight) await cloudSavePromise;
    clearTimeout(cloudSaveTimer);
    cloudSaveQueued = false;
    if (authSession) await syncProgress();
  }

  async function restoreCloudSession() {
    if (!authSession) return;
    try {
      const result = await requestSheets("load", { token: authSession.token });
      if (!result || !result.progress) throw new Error("The saved account data could not be loaded.");
      student = { ...newStudent(), ...result.progress };
      student.completed = Array.isArray(student.completed) ? [...new Set(student.completed.map(Number).filter(number => number >= 1 && number <= 100))] : [];
      student.quizScores = Array.isArray(student.quizScores) ? student.quizScores.slice(0, 20) : [];
      student.practice = student.practice && typeof student.practice === "object" ? student.practice : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(student));
      renderAll();
      renderAccountButton();
    } catch (error) {
      console.error("Could not restore the Google Sheets account.", error);
      authRequired = true;
      setAuthSession(null);
      openAccountDialog("login");
      $("#account-error").textContent = "Could not reconnect to Google Sheets. Please sign in again.";
    }
  }

  function openAccountDialog(mode = authSession ? "account" : "login") {
    if (!authSession) authRequired = true;
    authMode = mode;
    $("#account-error").textContent = "";
    $("#account-name").value = student.name;
    $("#account-title").textContent = mode === "signup" ? "Create your account" : mode === "account" ? "Your account" : "Welcome back!";
    $("#account-subtitle").textContent = mode === "signup"
      ? "Choose a name and a 4-digit PIN. Your progress will be saved to Google Sheets."
      : mode === "account"
        ? "Your account remembers your progress across visits on this browser."
        : "Sign in to save your learning progress to Google Sheets.";
    $("#account-switch").classList.toggle("hidden", mode === "account");
    $("#account-switch").textContent = mode === "signup" ? "Already have an account? Sign in" : "New student? Create an account";
    $("#account-submit").innerHTML = mode === "signup" ? "Create account <span>→</span>" : "Sign in securely <span>→</span>";
    $("#account-pin").value = "";
    $("#account-pin").autocomplete = mode === "signup" ? "new-password" : "current-password";
    const classLabel = $("#account-class-label");
    if (classLabel) classLabel.classList.toggle("hidden", mode !== "signup");
    $("#account-close").classList.toggle("hidden", authRequired);
    document.body.classList.toggle("auth-required", authRequired);
    $("#account-backdrop").classList.remove("hidden");
    $("#account-backdrop").classList.toggle("auth-gate", authRequired);
  }

  function closeAccountDialog() {
    if (authRequired) return;
    $("#account-backdrop").classList.add("hidden");
    $("#account-backdrop").classList.remove("auth-gate");
    document.body.classList.remove("auth-required");
  }

  function openParentSetup() {
    authRequired = false;
    $("#account-backdrop").classList.add("hidden");
    $("#account-backdrop").classList.remove("auth-gate");
    document.body.classList.remove("auth-required");
    $("#account-close").classList.remove("hidden");
    navigate("parent");
  }

  async function submitAccount(event) {
    event.preventDefault();
    const name = $("#account-name").value.trim();
    const pin = $("#account-pin").value;
    const endpoint = authSession?.endpoint || localStorage.getItem(SCRIPT_URL_KEY) || "https://script.google.com/macros/s/AKfycbx6otsqYR97K0Xpe5Gye9y0OBmOQPkx-GZe-B8TZng/dev";
    const errorBox = $("#account-error");
    const submit = $("#account-submit");
    if (name.length < 2 || name.length > 24) {
      errorBox.textContent = "Student name must be 2–24 characters.";
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      errorBox.textContent = "Please enter a 4-digit PIN.";
      return;
    }
    if (!isAppsScriptUrl(endpoint)) {
      errorBox.textContent = "Google Sheets is not set up yet. Ask a parent to add the Apps Script URL in Parent view.";
      return;
    }
    submit.disabled = true;
    errorBox.textContent = "Connecting securely…";
    try {
      let result;
      if (authMode === "signup") {
        student.name = name;
        const selectedClass = Number($("#account-class")?.value);
        if (selectedClass) student.classNumber = selectedClass;
        result = await requestSheets("signup", { name, pin, classNumber: student.classNumber, progress: student }, endpoint);
      } else {
        result = await requestSheets("login", { name, pin }, endpoint);
      }
      if (!result || !result.token) throw new Error("The account service returned an invalid response.");
      setAuthSession({ token: result.token, endpoint, name: result.name || name });
      if (result.progress) {
        student = { ...newStudent(), ...result.progress };
        student.completed = Array.isArray(student.completed) ? [...new Set(student.completed.map(Number).filter(number => number >= 1 && number <= 100))] : [];
        student.quizScores = Array.isArray(student.quizScores) ? student.quizScores.slice(0, 20) : [];
        student.practice = student.practice && typeof student.practice === "object" ? student.practice : {};
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(student));
      closeAccountDialog();
      renderAll();
      renderAccountButton();
      renderSheetsStatus();
      showToast(`Welcome, ${displayName()}! Progress is connected to Google Sheets.`);
    } catch (error) {
      console.error("Google Sheets sign-in failed.", error);
      errorBox.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  function saveSheetsEndpoint() {
    const endpoint = $("#apps-script-url").value.trim();
    const status = $("#sheets-connection-status");
    if (!isAppsScriptUrl(endpoint)) {
      status.textContent = "Paste the full Apps Script Web app URL, ending in /exec.";
      status.classList.add("error");
      return;
    }
    const previousEndpoint = authSession?.endpoint;
    localStorage.setItem(SCRIPT_URL_KEY, endpoint);
    if (authSession && previousEndpoint !== endpoint) {
      const oldSession = authSession;
      setAuthSession(null);
      requestSheets("logout", { token: oldSession.token }, oldSession.endpoint).catch(error => {
        console.error("Could not revoke the previous Google Sheets session.", error);
      });
    }
    status.classList.remove("error");
    renderSheetsStatus(authSession ? "Connection updated. Sign in again to use the new Sheet." : "Connection saved. Students can now sign in using their name and PIN.");
    showToast(authSession ? "Connection updated. Please sign in again." : "Google Sheets connection saved.");
  }

  async function testSheetsConnection() {
    const endpoint = $("#apps-script-url").value.trim();
    const status = $("#sheets-connection-status");
    if (!isAppsScriptUrl(endpoint)) {
      status.textContent = "Paste the full Apps Script Web app URL, ending in /exec.";
      status.classList.add("error");
      return;
    }
    status.classList.remove("error");
    status.textContent = "Testing Google Sheets connection…";
    const button = $("#test-sheets-url");
    button.disabled = true;
    try {
      await requestSheets("ping", {}, endpoint);
      localStorage.setItem(SCRIPT_URL_KEY, endpoint);
      if (authSession && authSession.endpoint !== endpoint) setAuthSession(null);
      status.textContent = "Connection successful! The Sheet is ready for student accounts.";
      showToast("Google Sheets connection works.");
    } catch (error) {
      console.error("Google Sheets connection test failed.", error);
      status.classList.add("error");
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(student));
    } catch (error) {
      console.error("Could not save learning progress.", error);
      showToast("Progress could not be saved on this device.");
    }
    scheduleCloudSave();
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function showModal(title, message, actionText = "Wonderful!", callback = null) {
    $("#modal-title").textContent = title;
    $("#modal-message").textContent = message;
    $("#modal-action").textContent = actionText;
    $("#modal-backdrop").classList.remove("hidden");
    $("#modal-action").onclick = () => {
      $("#modal-backdrop").classList.add("hidden");
      if (callback) callback();
    };
  }

  function closeModal() {
    $("#modal-backdrop").classList.add("hidden");
  }

  function classLimit(classNumber = student.classNumber) {
    return CLASS_LIMITS[classNumber - 1];
  }

  function displayName() {
    return student.name.trim() || "Student";
  }

  function updateStreak(date = todayKey()) {
    if (student.lastPractice === date) return;
    const previous = new Date();
    previous.setDate(previous.getDate() - 1);
    const yesterday = previous.toLocaleDateString("en-CA");
    student.streak = student.lastPractice === yesterday ? student.streak + 1 : 1;
    student.lastPractice = date;
  }

  function recordPractice() {
    const date = todayKey();
    updateStreak(date);
    student.practice[date] = (Number(student.practice[date]) || 0) + 1;
    save();
    renderStats();
    renderCharts();
  }

  function setClass(value) {
    const selected = Math.min(12, Math.max(1, Number(value) || 1));
    student.classNumber = selected;
    save();
    $("#class-select").value = String(selected);
    $("#parent-class-select").value = String(selected);
    $("#class-hint").textContent = `Your class level goes up to table ${classLimit()}`;
    renderNumberGrid();
    renderStats();
    renderDashboard();
    renderParent();
  }

  function makeClassOptions(select) {
    select.innerHTML = Array.from({ length: 12 }, (_, index) =>
      `<option value="${index + 1}">Class ${index + 1}</option>`
    ).join("");
    select.value = String(student.classNumber);
  }

  function renderProfile() {
    const name = displayName();
    $("#top-name").textContent = name;
    $("#top-avatar").textContent = name[0].toUpperCase();
    $("#welcome-title").innerHTML = `Hey, ${escapeHtml(name)}!<br><span>Ready to shine?</span>`;
    $("#side-streak").textContent = `${student.streak} day${student.streak === 1 ? "" : "s"} streak`;
    $("#student-name").value = student.name;
    $("#parent-name").textContent = name;
    $("#parent-avatar").textContent = name[0].toUpperCase();
    $("#parent-class").textContent = `Class ${student.classNumber} · Learning tables up to ${classLimit()}`;
    renderAccountButton();
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function renderStats() {
    const completedCount = student.completed.length;
    const progress = Math.round(completedCount);
    $("#stat-stars").textContent = student.stars;
    $("#stat-tables").innerHTML = `${completedCount} <small>/ 100</small>`;
    $("#stat-streak").innerHTML = `${student.streak} <small>days</small>`;
    $("#stat-progress").textContent = `${progress}%`;
    $("#stat-progress-bar").style.width = `${progress}%`;
    const dayTable = (new Date().getDate() + new Date().getMonth() * 3) % 12 + 1;
    $("#daily-number").textContent = dayTable;
    $("#daily-title").textContent = dayTable;
    $("#daily-complete").textContent = student.dailyCompleted === todayKey() ? "✓ Challenge complete!" : "";
  }

  function renderNumberGrid() {
    const limit = $("#show-all-numbers").dataset.expanded === "true" ? 100 : 50;
    const numbers = Array.from({ length: limit }, (_, index) => index + 1);
    $("#number-grid").innerHTML = numbers.map(number =>
      `<button class="number-chip${number === currentTable ? " selected" : ""}${number <= classLimit() ? " suggested" : ""}" data-table="${number}" aria-label="Learn table ${number}">${number}</button>`
    ).join("");
    $("#show-all-numbers").textContent = limit === 100 ? "Show fewer numbers ⌃" : "Show all numbers ⌄";
  }

  function renderTable(number, scroll = false) {
    currentTable = Math.min(100, Math.max(1, Number(number) || 1));
    $("#lesson-table-number").textContent = currentTable;
    $("#lesson-tip").textContent = `Tap a line to highlight it. You’re doing great!`;
    $("#lesson-trick").textContent = TRICKS[currentTable] || `Count up in ${currentTable}s. Each answer is ${currentTable} more than the last.`;
    $("#table-lines").innerHTML = Array.from({ length: TABLE_MULTIPLIERS }, (_, index) => {
      const multiplier = index + 1;
      return `<button class="table-line${answersVisible ? "" : " answer-hidden"}" data-line="${multiplier}"><span class="equation">${currentTable} × ${multiplier}</span><span class="answer">= ${currentTable * multiplier}</span></button>`;
    }).join("");
    $$(".number-chip").forEach(button => button.classList.toggle("selected", Number(button.dataset.table) === currentTable));
    if (scroll) $("#lesson-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openTable(number) {
    const table = Number(number);
    if (!Number.isInteger(table) || table < 1 || table > 100) {
      showToast("Choose a table number from 1 to 100.");
      return;
    }
    navigate("learn");
    renderTable(table, true);
  }

  function renderCharts() {
    const now = new Date();
    const dates = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      dates.push({ key: date.toLocaleDateString("en-CA"), label: DAYS[date.getDay()] });
    }
    const max = Math.max(1, ...dates.map(item => Number(student.practice[item.key]) || 0));
    const markup = dates.map((item, index) => {
      const count = Number(student.practice[item.key]) || 0;
      const height = Math.max(4, Math.round(count / max * 62));
      return `<div class="week-day" title="${count} practice ${count === 1 ? "session" : "sessions"}"><div class="week-bar${index === 6 ? " today" : ""}" style="height:${height}px"></div><small>${item.label}</small></div>`;
    }).join("");
    ["#week-chart", "#dashboard-chart", "#parent-chart"].forEach(selector => { $(selector).innerHTML = markup; });
  }

  function getBadges() {
    return [
      { title: "First steps", detail: "Master your first table", icon: "🌱", earned: student.completed.length >= 1 },
      { title: "Table explorer", detail: "Master 5 tables", icon: "🧭", earned: student.completed.length >= 5 },
      { title: "Table champion", detail: "Master 10 tables", icon: "🏆", earned: student.completed.length >= 10 },
      { title: "Star collector", detail: "Earn 25 stars", icon: "⭐", earned: student.stars >= 25 },
      { title: "On a roll", detail: "Practise 3 days in a row", icon: "🔥", earned: student.streak >= 3 }
    ];
  }

  function renderDashboard() {
    const completed = student.completed.length;
    $("#dashboard-stats").innerHTML = [
      ["Tables learned", `${completed} / 100`],
      ["Quiz attempts", student.quizScores.length],
      ["Total stars", student.stars],
      ["Learning streak", `${student.streak} days`]
    ].map(([label, value]) => `<div class="dash-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
    const next = Array.from({ length: 100 }, (_, index) => index + 1).find(number => !student.completed.includes(number)) || 1;
    $("#recommendation-text").textContent = `You’ve practised ${completed} ${completed === 1 ? "table" : "tables"}. Try the table of ${next} next!`;
    $("#recommendation-go").dataset.table = String(next);
    const sorted = [...student.completed].sort((a, b) => a - b);
    $("#completed-tables").innerHTML = sorted.length ? sorted.map(number => `<span class="completed-pill">✓ Table ${number}</span>`).join("") : `<span class="empty-note">Your completed tables will show up here. Pick one and give it a try!</span>`;
    $("#history-count").textContent = `${completed} ${completed === 1 ? "table" : "tables"}`;
    $("#quiz-history").innerHTML = student.quizScores.length
      ? student.quizScores.slice(0, 5).map(item => `<div class="quiz-history-item"><span>${escapeHtml(item.level)} quiz · ${escapeHtml(item.date || "")}</span><b>${item.score}/10 · ${item.percent}%</b></div>`).join("")
      : `<span class="empty-note">Your quiz scores will appear here.</span>`;
    $("#badge-list").innerHTML = getBadges().map(badge => `<div class="badge-item${badge.earned ? " earned" : ""}"><span>${badge.icon}</span><div><b>${badge.title}</b><small>${badge.detail}</small></div></div>`).join("");
  }

  function renderParent() {
    const metrics = [
      ["⭐", student.stars, "stars earned"],
      ["▦", student.completed.length, "tables mastered"],
      ["✎", student.quizScores.length, "quizzes taken"],
      ["🔥", student.streak, "day streak"]
    ];
    $("#parent-metrics").innerHTML = metrics.map(([icon, value, label]) => `<div class="parent-metric"><b>${icon} ${value}</b><small>${label}</small></div>`).join("");
    $("#apps-script-url").value = localStorage.getItem(SCRIPT_URL_KEY) || "";
    renderSheetsStatus();
    renderProfile();
  }

  function renderAll() {
    renderProfile();
    renderStats();
    renderNumberGrid();
    renderTable(currentTable);
    renderCharts();
    renderDashboard();
    renderParent();
  }

  function navigate(page) {
    if (!$("#page-" + page)) return;
    currentPage = page;
    $$(".page").forEach(section => section.classList.toggle("active", section.id === `page-${page}`));
    $$(".nav-link[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    const labels = { home: "Home", learn: "Learn tables", games: "Maths games", quiz: "Quick quiz", magic: "Magic tricks", dashboard: "My progress", parent: "Parent view" };
    $("#page-crumb").textContent = labels[page];
    $("#sidebar").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (page === "dashboard") { renderDashboard(); renderCharts(); }
    if (page === "parent") { renderParent(); renderCharts(); }
    if (page === "games" && game) $("#game-stage").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function completeLesson() {
    const firstCompletion = !student.completed.includes(currentTable);
    if (firstCompletion) {
      student.completed.push(currentTable);
      student.stars += 5;
    }
    const dailyTable = (new Date().getDate() + new Date().getMonth() * 3) % 12 + 1;
    if (currentTable === dailyTable) student.dailyCompleted = todayKey();
    recordPractice();
    $("#lesson-status").textContent = firstCompletion ? "Table mastered — lovely work!" : "Practise complete — keep it up!";
    $("#lesson-status").style.color = "#35a77e";
    renderDashboard();
    const earned = getBadges().filter(badge => badge.earned).map(badge => badge.title);
    showModal(firstCompletion ? "Table mastered!" : "Practice complete!", firstCompletion ? `You earned 5 stars for learning the ${currentTable} times table. Keep that brilliant work up!` : `You practised the ${currentTable} times table. Every bit of practice helps!`);
    if (earned.length) $("#modal-message").textContent += ` Badge progress: ${earned.slice(-1)[0]} unlocked!`;
  }

  function speakTable() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      showToast("Speech is not available in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    speechLine = -1;
    $$(".table-line").forEach(line => line.classList.remove("current"));
    const utterance = new SpeechSynthesisUtterance();
    const lang = student.language === "hi" ? "hi-IN" : "en-US";
    utterance.lang = lang;
    utterance.rate = Number($("#voice-speed").value);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase().startsWith(student.language === "hi" ? "hi" : "en")) || null;
    const lines = Array.from({ length: TABLE_MULTIPLIERS }, (_, index) => student.language === "hi"
      ? `${currentTable} गुणा ${index + 1} बराबर ${currentTable * (index + 1)}।`
      : `${currentTable} times ${index + 1} equals ${currentTable * (index + 1)}.`);
    let index = 0;
    const speakNext = () => {
      if (index >= lines.length) return;
      speechLine = index;
      $$(".table-line").forEach((line, lineIndex) => line.classList.toggle("current", lineIndex === index));
      const item = new SpeechSynthesisUtterance(lines[index]);
      item.lang = lang;
      item.rate = Number($("#voice-speed").value);
      item.voice = utterance.voice;
      item.onend = () => { index++; speakNext(); };
      item.onerror = event => {
        if (event.error !== "canceled" && event.error !== "interrupted") showToast("The table could not be read aloud.");
      };
      window.speechSynthesis.speak(item);
    };
    speakNext();
  }

  function printCurrentTable() {
    window.print();
  }

  function downloadWorksheet() {
    const questions = Array.from({ length: TABLE_MULTIPLIERS }, (_, index) => {
      const multiplier = index + 1;
      return `<li>${currentTable} × ${multiplier} = __________</li>`;
    }).join("");
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Table ${currentTable} worksheet</title><style>body{font:18px Arial;max-width:700px;margin:40px auto;color:#222}h1{color:#6549cb}li{padding:13px 0}header{display:flex;justify-content:space-between;border-bottom:2px solid #ddd;padding-bottom:14px}.name{margin:25px 0}</style><header><h1>Table Master</h1><b>Multiplication practice</b></header><h2>The table of ${currentTable}</h2><p class="name">Name: __________________________ Date: ______________</p><ol>${questions}</ol><p>Great effort! Check your answers when you’re done.</p></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `table-${currentTable}-worksheet.html`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Your worksheet is ready to print!");
  }

  function makeQuestion(maxTable) {
    const factor = 1 + Math.floor(Math.random() * maxTable);
    const multiplier = 1 + Math.floor(Math.random() * TABLE_MULTIPLIERS);
    return { factor, multiplier, answer: factor * multiplier };
  }

  function distinctOptions(answer, max = Math.max(50, answer * 2)) {
    const values = new Set([answer]);
    while (values.size < 4) {
      let value = 1 + Math.floor(Math.random() * max);
      if (Math.random() < 0.45) value = answer + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 12));
      if (value > 0 && value !== answer) values.add(value);
    }
    return [...values].sort(() => Math.random() - 0.5);
  }

  function startGame(type) {
    clearInterval(speedTimer);
    game = { type, score: 0, question: 0, maxTable: Math.max(classLimit(), currentTable), time: 30, locked: false };
    $("#game-catalog").classList.add("hidden");
    $("#game-stage").classList.remove("hidden");
    if (type === "pairs") {
      startPairsGame();
      return;
    }
    if (type === "blanks") {
      game.maxTable = 1;
      game.fixedTable = currentTable;
    }
    renderGameQuestion();
    if (type === "speed") {
      speedTimer = setInterval(() => {
        game.time--;
        const clock = $("#game-time");
        if (clock) clock.textContent = `${game.time}s`;
        if (game.time <= 0) endGame("Time’s up!");
      }, 1000);
    }
    $("#game-stage").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderGameQuestion() {
    if (!game) return;
    game.locked = false;
    const { type } = game;
    const roundLimit = type === "blanks" ? TABLE_MULTIPLIERS : 10;
    if (game.question >= roundLimit && type !== "speed") { endGame("Brilliant playing!"); return; }
    if (type === "speed" && game.time <= 0) return;
    const q = type === "blanks"
      ? { factor: game.fixedTable, multiplier: game.question + 1, answer: game.fixedTable * (game.question + 1) }
      : makeQuestion(game.maxTable);
    game.current = q;
    const titleMap = { missing: "Missing number", correct: "Find the answer", speed: "Speed challenge", shooting: "Answer target", blanks: "Fill in the blanks" };
    const timeMarkup = type === "speed" ? `<span class="game-score" id="game-time">${game.time}s</span>` : "";
    let prompt;
    if (type === "missing") prompt = `${q.factor} × ${q.multiplier} = ?`;
    else if (type === "blanks") prompt = `${q.factor} × ${q.multiplier} = ___`;
    else prompt = `${q.factor} × ${q.multiplier} = ?`;
    const opts = distinctOptions(q.answer, Math.max(q.answer * 2, 40));
    game.options = opts;
    let content;
    if (type === "missing" || type === "blanks") {
      content = `<div class="game-answer-row"><input class="game-input" id="game-input" type="number" inputmode="numeric" aria-label="Your answer" autocomplete="off"><button class="btn btn-primary" id="game-submit">Check answer ✓</button></div>`;
    } else {
      content = `<div class="game-answer-row">${opts.map(value => `<button class="game-choice" data-answer="${value}">${value}</button>`).join("")}</div>`;
    }
    $("#game-stage").innerHTML = `<div class="game-stage-head"><div><span class="panel-kicker">${type === "speed" ? "30 SECONDS · READY, SET, GO!" : "ROUND " + (game.question + 1) + " OF " + roundLimit}</span><h2>${titleMap[type]}</h2></div><div>${timeMarkup}<span class="game-score">⭐ <b id="game-score">${game.score}</b></span></div></div><div class="game-question">${prompt}</div>${content}<div class="game-message" id="game-message" aria-live="polite"></div><div class="game-next"><button class="text-link hidden" id="game-next">Next question →</button></div><div class="game-next"><button class="text-link" id="back-games">← All games</button></div>`;
    $("#game-submit")?.addEventListener("click", () => checkGameAnswer($("#game-input").value));
    $("#game-input")?.addEventListener("keydown", event => { if (event.key === "Enter") checkGameAnswer($("#game-input").value); });
    $$(".game-choice").forEach(button => button.addEventListener("click", () => checkGameAnswer(button.dataset.answer, button)));
    $("#game-next").addEventListener("click", () => { game.question++; renderGameQuestion(); });
    $("#back-games").addEventListener("click", stopGame);
  }

  function checkGameAnswer(value, chosenButton = null) {
    if (!game || game.locked) return;
    if (value === "" || !Number.isFinite(Number(value))) {
      $("#game-message").textContent = "Pop in an answer first!";
      return;
    }
    game.locked = true;
    const correct = Number(value) === game.current.answer;
    if (correct) {
      game.score++;
      recordPractice();
      $("#game-message").textContent = ["Fantastic!", "You got it!", "Brilliant maths!", "That’s right!"][Math.floor(Math.random() * 4)];
      $("#game-message").style.color = "#28a276";
      if (chosenButton) chosenButton.classList.add("correct");
    } else {
      $("#game-message").textContent = `Not quite — the answer is ${game.current.answer}.`;
      $("#game-message").style.color = "#d5727d";
      if (chosenButton) chosenButton.classList.add("wrong");
      $$(".game-choice").forEach(button => { if (Number(button.dataset.answer) === game.current.answer) button.classList.add("correct"); });
    }
    const score = $("#game-score");
    if (score) score.textContent = game.score;
    $$(".game-choice").forEach(button => { button.disabled = true; });
    const input = $("#game-input");
    if (input) input.disabled = true;
    const submit = $("#game-submit");
    if (submit) submit.disabled = true;
    if (game.type === "speed") {
      game.locked = false;
      game.question++;
      setTimeout(() => { if (game && game.type === "speed" && game.time > 0) renderGameQuestion(); }, 450);
    } else {
      $("#game-next").classList.remove("hidden");
    }
  }

  function startPairsGame() {
    game = { ...game, type: "pairs", score: 0, question: 0, selected: [], matched: new Set(), turns: 0 };
    const pairNumbers = [1, 2, 3, 4];
    const cards = pairNumbers.flatMap(multiplier => [
      { key: multiplier, text: `${currentTable} × ${multiplier}` },
      { key: multiplier, text: String(currentTable * multiplier) }
    ]).sort(() => Math.random() - 0.5);
    game.pairCards = cards;
    renderPairs();
  }

  function renderPairs() {
    $("#game-stage").innerHTML = `<div class="game-stage-head"><div><span class="panel-kicker">MATCH ALL FOUR PAIRS</span><h2>Match the pairs</h2></div><span class="game-score"><b id="pairs-score">${game.matched.size / 2}</b> / 4 matched</span></div><p class="game-message">Tap a multiplication question, then its answer.</p><div class="pairs-board">${game.pairCards.map((card, index) => `<button class="pair-card" data-pair-card="${index}">?</button>`).join("")}</div><div class="game-next"><button class="text-link" id="back-games">← All games</button></div>`;
    $$("[data-pair-card]").forEach(button => button.addEventListener("click", () => flipPair(Number(button.dataset.pairCard), button)));
    $("#back-games").addEventListener("click", stopGame);
  }

  function flipPair(index, button) {
    if (!game || game.matched.has(index) || game.selected.some(item => item.index === index) || game.selected.length >= 2) return;
    const card = game.pairCards[index];
    button.textContent = card.text;
    button.classList.add("flipped");
    game.selected.push({ index, key: card.key });
    if (game.selected.length === 2) {
      game.turns++;
      const [first, second] = game.selected;
      if (first.key === second.key) {
        game.matched.add(first.index);
        game.matched.add(second.index);
        game.score++;
        recordPractice();
        setTimeout(() => {
          $$(".pair-card").forEach(item => {
            const cardIndex = Number(item.dataset.pairCard);
            if (game.matched.has(cardIndex)) item.classList.add("matched");
          });
          $("#pairs-score").textContent = game.score;
          game.selected = [];
          if (game.matched.size === 8) {
            student.stars += 3;
            save();
            renderStats();
            showModal("A perfect match!", "You found all four pairs and earned 3 stars. Nicely done!");
            $("#game-stage").insertAdjacentHTML("beforeend", `<p class="game-message">All matched! <button class="text-link" id="pairs-again">Play again</button></p>`);
            $("#pairs-again").addEventListener("click", () => startGame("pairs"));
          }
        }, 350);
      } else {
        setTimeout(() => {
          game.selected.forEach(item => {
            const el = $(`[data-pair-card="${item.index}"]`);
            if (el) { el.textContent = "?"; el.classList.remove("flipped"); }
          });
          game.selected = [];
        }, 750);
      }
    }
  }

  function endGame(message) {
    if (!game) return;
    clearInterval(speedTimer);
    const oldGame = game;
    if (oldGame.score > 0 && oldGame.type !== "pairs") {
      student.stars += Math.min(5, oldGame.score);
      save();
    }
    renderStats();
    renderDashboard();
    $("#game-stage").innerHTML = `<div class="quiz-result"><div class="result-emoji">${oldGame.score >= 7 ? "🏆" : "🌟"}</div><span class="panel-kicker">GAME COMPLETE</span><h2>${message}</h2><p>You got ${oldGame.score} right. Every round makes you stronger!</p><div class="result-score">${oldGame.score} <small style="font-size:14px;color:#999">points</small></div><div class="result-badges"><span>⭐ +${oldGame.type === "pairs" ? "3" : Math.min(5, oldGame.score)} stars</span><span>${oldGame.score >= 7 ? "🏅 Great job!" : "✦ Keep practising!"}</span></div><button class="btn btn-primary" id="play-again">Play again <span>↻</span></button> <button class="btn btn-outline" id="exit-game">All games</button></div>`;
    $("#play-again").addEventListener("click", () => startGame(oldGame.type));
    $("#exit-game").addEventListener("click", stopGame);
    game = null;
  }

  function stopGame() {
    clearInterval(speedTimer);
    game = null;
    $("#game-stage").classList.add("hidden");
    $("#game-catalog").classList.remove("hidden");
  }

  function startQuiz() {
    const selectedLevel = $(".difficulty.active").dataset.level;
    const maxTable = selectedLevel === "easy" ? 10 : selectedLevel === "medium" ? 20 : 100;
    quiz = { level: selectedLevel, maxTable, index: 0, score: 0, questions: [], locked: false };
    quiz.questions = Array.from({ length: 10 }, () => makeQuestion(maxTable));
    $("#quiz-setup").classList.add("hidden");
    $("#quiz-result").classList.add("hidden");
    $("#quiz-play").classList.remove("hidden");
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!quiz || quiz.index >= 10) { finishQuiz(); return; }
    quiz.locked = false;
    $("#quiz-next").classList.add("hidden");
    const q = quiz.questions[quiz.index];
    $("#quiz-question-count").textContent = `QUESTION ${quiz.index + 1} OF 10`;
    $("#quiz-score-label").textContent = `⭐ ${quiz.score}`;
    $("#quiz-progress-bar").style.width = `${quiz.index * 10}%`;
    $("#quiz-question").textContent = `${q.factor} × ${q.multiplier} = ?`;
    $("#quiz-feedback").textContent = "";
    $("#quiz-options").innerHTML = distinctOptions(q.answer, Math.max(q.answer * 2, 40)).map(answer =>
      `<button data-quiz-answer="${answer}">${answer}</button>`
    ).join("");
    $$("[data-quiz-answer]").forEach(button => button.addEventListener("click", () => answerQuiz(Number(button.dataset.quizAnswer), button)));
  }

  function answerQuiz(answer, button) {
    if (!quiz || quiz.locked) return;
    quiz.locked = true;
    const q = quiz.questions[quiz.index];
    const correct = answer === q.answer;
    if (correct) quiz.score++;
    $$("[data-quiz-answer]").forEach(option => {
      option.disabled = true;
      if (Number(option.dataset.quizAnswer) === q.answer) option.classList.add("correct");
    });
    if (!correct) button.classList.add("wrong");
    $("#quiz-score-label").textContent = `⭐ ${quiz.score}`;
    $("#quiz-feedback").textContent = correct ? ["Wonderful!", "You got it!", "That’s right!"][Math.floor(Math.random() * 3)] : `Good try! The answer is ${q.answer}.`;
    $("#quiz-feedback").style.color = correct ? "#28a276" : "#d5727d";
    if (correct) recordPractice();
    $("#quiz-progress-bar").style.width = `${(quiz.index + 1) * 10}%`;
    $("#quiz-next").textContent = quiz.index === 9 ? "See my result →" : "Next question →";
    $("#quiz-next").classList.remove("hidden");
  }

  function advanceQuiz() {
    if (!quiz || !quiz.locked) return;
    quiz.index++;
    renderQuizQuestion();
  }

  function finishQuiz() {
    if (!quiz) return;
    const completedQuiz = quiz;
    const percent = completedQuiz.score * 10;
    const date = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const stars = completedQuiz.score >= 8 ? 5 : completedQuiz.score >= 5 ? 3 : 1;
    student.stars += stars;
    student.quizScores.unshift({ level: completedQuiz.level[0].toUpperCase() + completedQuiz.level.slice(1), score: completedQuiz.score, percent, date });
    student.quizScores = student.quizScores.slice(0, 20);
    recordPractice();
    $("#quiz-play").classList.add("hidden");
    $("#quiz-result").classList.remove("hidden");
    $("#quiz-result").innerHTML = `<div class="result-emoji">${completedQuiz.score >= 8 ? "🏆" : completedQuiz.score >= 5 ? "🌟" : "🌱"}</div><span class="panel-kicker">QUIZ COMPLETE</span><h2>${completedQuiz.score >= 8 ? "You’re a table superstar!" : completedQuiz.score >= 5 ? "Look at you go!" : "Every try helps you grow!"}</h2><p>You got ${completedQuiz.score} out of 10 questions right. Keep practising — you’re doing great!</p><div class="result-score">${percent}%</div><div class="result-badges"><span>⭐ +${stars} stars</span><span>${completedQuiz.level.toUpperCase()} level</span>${completedQuiz.score >= 8 ? "<span>🏅 Quiz champ</span>" : ""}</div><button class="btn btn-primary" id="retry-quiz">Try another quiz <span>↻</span></button>`;
    $("#retry-quiz").addEventListener("click", () => {
      quiz = null;
      $("#quiz-result").classList.add("hidden");
      $("#quiz-setup").classList.remove("hidden");
    });
    quiz = null;
    renderStats();
    renderDashboard();
    showModal("Quiz finished!", `You scored ${percent}% and earned ${stars} stars. Every answer is a step forward!`);
  }

  function switchLanguage() {
    student.language = student.language === "en" ? "hi" : "en";
    save();
    applyLanguage();
    showToast(student.language === "hi" ? "Hindi voice selected when available." : "English voice selected.");
  }

  function applyLanguage() {
    translated = student.language === "hi";
    $("#language-toggle").innerHTML = translated ? "🇮🇳 <span>हिं</span>" : "🇬🇧 <span>EN</span>";
    const navs = $$(".side-nav .nav-link");
    const english = ["Home", "Learn tables", "Maths games", "Quick quiz", "Magic tricks", "My progress"];
    const hindi = ["होम", "पहाड़े सीखें", "गणित खेल", "क्विक क्विज़", "आसान तरीके", "मेरी प्रगति"];
    navs.forEach((nav, index) => { nav.lastChild.textContent = translated ? hindi[index] : english[index]; });
    $(".sidebar-bottom .nav-link").lastChild.textContent = translated ? "अभिभावक" : "Parent view";
  }

  function initialize() {
    makeClassOptions($("#class-select"));
    makeClassOptions($("#parent-class-select"));
    makeClassOptions($("#account-class"));
    if (student.theme === "dark") document.body.classList.add("dark");
    applyLanguage();
    renderAll();

    document.addEventListener("click", event => {
      const pageButton = event.target.closest("[data-page]");
      if (pageButton) { event.preventDefault(); navigate(pageButton.dataset.page); }
      const tableButton = event.target.closest("[data-table]");
      if (tableButton) renderTable(tableButton.dataset.table);
      const gameButton = event.target.closest("[data-game]");
      if (gameButton) startGame(gameButton.dataset.game);
      const trickButton = event.target.closest("[data-trick-table]");
      if (trickButton) openTable(trickButton.dataset.trickTable);
    });

    $("#class-select").addEventListener("change", event => setClass(event.target.value));
    $("#parent-class-select").addEventListener("change", event => setClass(event.target.value));
    $("#home-table-go").addEventListener("click", () => openTable($("#home-table").value));
    $("#home-table").addEventListener("keydown", event => { if (event.key === "Enter") openTable(event.target.value); });
    $("#daily-start").addEventListener("click", () => openTable($("#daily-number").textContent));
    $("#search-table").addEventListener("click", () => openTable($("#table-search").value));
    $("#table-search").addEventListener("keydown", event => { if (event.key === "Enter") openTable(event.target.value); });
    $("#show-all-numbers").addEventListener("click", event => {
      const expanded = event.currentTarget.dataset.expanded !== "true";
      event.currentTarget.dataset.expanded = String(expanded);
      renderNumberGrid();
    });
    $("#toggle-answers").addEventListener("click", () => {
      answersVisible = !answersVisible;
      $$(".table-line").forEach(line => line.classList.toggle("answer-hidden", !answersVisible));
      $("#toggle-answers").textContent = answersVisible ? "Hide answers" : "Show answers";
    });
    $("#table-lines").addEventListener("click", event => {
      const line = event.target.closest(".table-line");
      if (!line) return;
      $$(".table-line").forEach(item => item.classList.remove("current"));
      line.classList.add("current");
    });
    $("#prev-table").addEventListener("click", () => renderTable(currentTable === 1 ? 100 : currentTable - 1));
    $("#next-table").addEventListener("click", () => renderTable(currentTable === 100 ? 1 : currentTable + 1));
    $("#complete-lesson").addEventListener("click", completeLesson);
    $("#speak-table").addEventListener("click", speakTable);
    $("#pause-voice").addEventListener("click", () => {
      if (!("speechSynthesis" in window)) return showToast("Speech is not available in this browser.");
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      else if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
      else speakTable();
    });
    $("#repeat-voice").addEventListener("click", speakTable);
    $("#print-table").addEventListener("click", printCurrentTable);
    $("#download-worksheet").addEventListener("click", downloadWorksheet);
    $("#theme-toggle").addEventListener("click", () => {
      document.body.classList.toggle("dark");
      student.theme = document.body.classList.contains("dark") ? "dark" : "light";
      save();
    });
    $("#language-toggle").addEventListener("click", switchLanguage);
    $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#profile-button").addEventListener("click", () => navigate("parent"));
    $("#account-button").addEventListener("click", () => {
      if (authSession) {
        showModal("Sign out of Table Master?", "Your cloud progress is saved in Google Sheets. This browser will ask for your PIN next time.", "Sign out", () => {
          const session = authSession;
          clearTimeout(cloudSaveTimer);
          flushCloudProgress().finally(() => {
            requestSheets("logout", { token: session.token }, session.endpoint).catch(error => {
              console.error("Could not revoke the Google Sheets session.", error);
            });
          });
          setAuthSession(null);
          authRequired = true;
          openAccountDialog("login");
        });
      } else {
        authRequired = true;
        openAccountDialog();
      }
    });
    $("#account-form").addEventListener("submit", submitAccount);
    $("#save-sheets-url").addEventListener("click", saveSheetsEndpoint);
    $("#test-sheets-url").addEventListener("click", testSheetsConnection);
    $("#account-switch").addEventListener("click", () => openAccountDialog(authMode === "signup" ? "login" : "signup"));
    $("#account-parent-setup").addEventListener("click", openParentSetup);
    $("#account-close").addEventListener("click", closeAccountDialog);
    $("#account-backdrop").addEventListener("click", event => { if (event.target.id === "account-backdrop") closeAccountDialog(); });
    window.addEventListener("message", handleSheetsResponse);
    $("#recommendation-go").addEventListener("click", event => openTable(event.currentTarget.dataset.table));
    $$(".difficulty").forEach(button => button.addEventListener("click", () => {
      $$(".difficulty").forEach(option => option.classList.toggle("active", option === button));
    }));
    $("#start-quiz").addEventListener("click", startQuiz);
    $("#quiz-next").addEventListener("click", advanceQuiz);
    $("#save-profile").addEventListener("click", () => {
      student.name = $("#student-name").value.trim().slice(0, 24);
      student.classNumber = Number($("#parent-class-select").value) || 1;
      save();
      renderAll();
      showToast("Student details saved!");
    });
    $("#reset-progress").addEventListener("click", () => showModal(
      "Reset all progress?",
      "This removes the saved name, class, stars, tables and quiz scores from this device.",
      "Yes, reset",
      () => {
        localStorage.removeItem(STORAGE_KEY);
        student = newStudent();
        currentTable = 7;
        document.body.classList.remove("dark");
        makeClassOptions($("#class-select"));
        makeClassOptions($("#parent-class-select"));
        makeClassOptions($("#account-class"));
        applyLanguage();
        renderAll();
        save();
        showToast("Progress has been reset.");
      }
    ));
    $("#modal-close").addEventListener("click", closeModal);
    $("#modal-backdrop").addEventListener("click", event => { if (event.target.id === "modal-backdrop") closeModal(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") { closeModal(); closeAccountDialog(); $("#sidebar").classList.remove("open"); } });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && "speechSynthesis" in window) window.speechSynthesis.pause();
    });
    $("#top-name").textContent = displayName();
    renderAccountButton();
    if (authSession) restoreCloudSession();
    else openAccountDialog("login");
  }

  initialize();
})();
