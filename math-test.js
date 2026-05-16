/* =====================================================================
   math-test.js
   Comprehensive locked-down math final test for Grade 3 Learning Hub.
   ---------------------------------------------------------------------
   WHAT THIS FILE DOES (high level)
   ---------------------------------------------------------------------
   1. Loads 50 multiple-topic math questions from content/math-test.json.
   2. Shows a START SCREEN where the student types their name and the
      parent's email. Nothing else is allowed until they click Start.
   3. Once Started, switches to the TEST SCREEN and:
       a) Renders all 50 questions on one scrollable page.
       b) Starts a 90-minute countdown timer (sticky at top of viewport).
       c) Saves every keystroke into localStorage so a refresh, tab close,
          or accidental swipe-back will NOT erase the student's answers.
       d) Locks the page: warns on tab close (beforeunload) and traps the
          browser back button (history.pushState).
   4. When the student submits OR when the timer hits 0:00:
       a) Auto-grades the answers (case-insensitive substring match,
          same algorithm as the existing app.js so behavior is consistent).
       b) Emails the full report to the parent via formsubmit.co
          (same provider/pattern the rest of the site already uses).
       c) Switches to the LOCKED SCREEN with the score, and marks the
          test as submitted in localStorage so it cannot be retaken.
   5. On any future page load, if a test is in progress, we resume it
      with the correct remaining time. If the test was already submitted,
      we show the locked screen forever.

   ---------------------------------------------------------------------
   IS THIS CRASH-SAFE?
   ---------------------------------------------------------------------
   Yes — every change is mirrored to localStorage immediately, so if the
   browser, tab, or computer crashes, the student returns to exactly
   where they left off. The timer is computed from a stored start
   timestamp (not from a counter), so even if the browser was closed
   for 10 minutes, those 10 minutes still count against the 90-minute
   total — this prevents cheating by closing the tab to "pause" time.
   ===================================================================== */


/* =====================================================================
   SECTION 1 — CONFIGURATION CONSTANTS
   These never change at runtime. Tweak here to adjust test behavior.
   ===================================================================== */

// ⚙️ SINGLE CONFIG POINT — change ONLY this filename to switch tests.
// Example: 'math-test.json', 'DOG-test.json', 'science-quiz.json', etc.
// The file must live inside the ./content/ folder.
const TEST_CONTENT_FILE = 'DOG-test-compatible.json';

// Everything below is derived automatically — no other edits needed.
const TEST_DATA_URL = `./content/${TEST_CONTENT_FILE}`;

// Where the email goes. Matches the address used in app.js for consistency.
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

// Total test duration. The user requested 1 hour 30 minutes = 90 minutes.
const TEST_DURATION_MINUTES = 90;

// Same number expressed in milliseconds. We do all timer math in ms because
// JavaScript's Date.now() returns ms, and that's the easiest way to compute
// elapsed/remaining time precisely.
const TEST_DURATION_MS = TEST_DURATION_MINUTES * 60 * 1000;

// localStorage keys. Derived from the content filename so that switching to
// a different test (e.g. DOG-test.json) automatically gets its own storage
// namespace — no stale answers bleed across different tests.
const _STORAGE_PREFIX = TEST_CONTENT_FILE.replace(/\.json$/i, '') + '_';
const STORAGE_KEY_ANSWERS    = _STORAGE_PREFIX + 'answers';     // object: { 0: "string", 1: "string", ... }
const STORAGE_KEY_START      = _STORAGE_PREFIX + 'startTime';   // number: ms timestamp when test started
const STORAGE_KEY_SUBMITTED  = _STORAGE_PREFIX + 'submitted';   // string: "true" once submitted
const STORAGE_KEY_STUDENT    = _STORAGE_PREFIX + 'studentInfo'; // object: { name, email }
const STORAGE_KEY_RESULT     = _STORAGE_PREFIX + 'finalResult'; // object: { score, total, submittedAt, reason }

// Timer warning thresholds (in ms). When time-remaining drops below these
// values, we change the timer's CSS class to give the student a visual
// warning that time is running out.
const WARN_THRESHOLD_MS   = 10 * 60 * 1000; // 10 minutes left -> yellow
const DANGER_THRESHOLD_MS =  5 * 60 * 1000; //  5 minutes left -> red and pulsing


/* =====================================================================
   SECTION 2 — DOM REFERENCES
   We grab these once on load and cache them so we don't repeatedly query
   the DOM (which is wasteful). All references are nullable until the DOM
   is ready, so the bootstrap step at the bottom of this file initializes
   them inside DOMContentLoaded.
   ===================================================================== */
let startScreen, testScreen, lockedScreen;
let startForm, studentNameInput, parentEmailInput;
let timerDisplay, answeredCountEl, totalCountEl, studentDisplay;
let questionsContainer, submitTestBtn;
let finalScoreEl, finalStudentEl, finalEmailEl, finalDateEl;
let lockedTitleEl, lockedSubtitleEl, lockedHeroEl;


/* =====================================================================
   SECTION 3 — RUNTIME STATE
   In-memory mirror of what's in localStorage, plus the loaded questions
   and the active timer interval. We keep both an in-memory copy and a
   localStorage copy because reading from memory is faster, but the
   localStorage copy is the source of truth across page reloads.
   ===================================================================== */
let testQuestions = [];        // populated from the content JSON
let testPassages  = [];        // populated from the content JSON (if present)
let answers       = {};        // { questionIndex: studentTypedString }
let timerInterval = null;      // setInterval handle so we can clear it later
let pageLockInstalled = false; // tracks whether beforeunload+popstate handlers are attached


/* =====================================================================
   SECTION 4 — STORAGE HELPERS
   Thin wrappers around localStorage that JSON-encode objects.
   We keep these in one place so the rest of the file doesn't need to
   know about JSON.parse/stringify or about catching corrupted data.
   ===================================================================== */

function saveAnswersToStorage() {
  // Persist the entire answers object as a JSON string. We save the WHOLE
  // object every time rather than diffing — for 50 short text answers this
  // is well under 10 KB, so it's fast enough and much simpler than diffs.
  try {
    localStorage.setItem(STORAGE_KEY_ANSWERS, JSON.stringify(answers));
  } catch (err) {
    // localStorage can throw if it's full or disabled (e.g. private mode).
    // We log but do not crash — the student can still see their answers
    // on screen, they just won't survive a refresh in this rare case.
    console.warn('Could not save answers to localStorage:', err);
  }
}

function loadAnswersFromStorage() {
  // Returns the stored answers object, or {} if nothing is saved or the
  // saved value is corrupt. Defensive parsing prevents one bad write from
  // bricking the whole test.
  const raw = localStorage.getItem(STORAGE_KEY_ANSWERS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // Defensive: only accept plain objects. If somebody manually wrote a
    // string or array into this slot, treat it as empty.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn('Stored answers were corrupt; starting fresh:', err);
    return {};
  }
}

function saveStudentInfo(name, email) {
  // Stash the name and email so that if the page reloads mid-test we
  // already know who the student is (we don't need to ask again).
  localStorage.setItem(STORAGE_KEY_STUDENT, JSON.stringify({ name, email }));
}

function loadStudentInfo() {
  // Returns { name, email } or null if not saved.
  const raw = localStorage.getItem(STORAGE_KEY_STUDENT);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function clearTestStateExceptResult() {
  // Wipes everything related to an in-progress test, but leaves the final
  // result and submitted flag in place. We call this after a successful
  // submission so re-opens still see the locked screen with the score.
  localStorage.removeItem(STORAGE_KEY_ANSWERS);
  localStorage.removeItem(STORAGE_KEY_START);
}


/* =====================================================================
   SECTION 5 — LOAD QUESTIONS
   Fetch and parse the JSON. This runs once when the page first opens.
   ===================================================================== */
async function loadTestData() {
  const response = await fetch(TEST_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load test data: HTTP ${response.status}`);
  }
  const data = await response.json();
  testQuestions = data.questions;
  testPassages  = data.passages || [];

  // If the JSON specifies its own title/description/duration, apply them to
  // the start screen so the same HTML works for any content file.
  if (data.title) {
    const heroH1 = document.querySelector('.test-hero h1');
    if (heroH1) heroH1.textContent = data.title;
    document.title = `📝 ${data.title}`;
  }
  if (data.description) {
    const sub = document.querySelector('.test-subtitle');
    if (sub) sub.textContent = data.description;
  }
  if (data.directions) {
    const directionsEl = document.getElementById('test-directions');
    if (directionsEl) directionsEl.textContent = data.directions;
  }
  // Update the info cards to reflect the actual content
  const qCountEl = document.querySelector('.test-info-card:nth-child(1) .info-value');
  if (qCountEl) qCountEl.textContent = String(testQuestions.length);
  const passCountEl = document.querySelector('.test-info-card:nth-child(3) .info-value');
  if (passCountEl && testPassages.length) {
    passCountEl.textContent = `${testPassages.length} Passages`;
  }
}


/* =====================================================================
   SECTION 6 — START SCREEN LOGIC
   Initial entry point. Validates input then transitions to the test.
   ===================================================================== */

function showStartScreen() {
  // Toggle visibility: only the start screen is visible at this point.
  startScreen.classList.remove('hidden');
  testScreen.classList.add('hidden');
  lockedScreen.classList.add('hidden');
}

function attachStartFormHandler() {
  // We use 'submit' (not 'click') so the browser handles Enter-key submission
  // automatically and the required="required" attributes on the inputs work.
  startForm.addEventListener('submit', (event) => {
    event.preventDefault(); // stop the browser from doing a real form post

    const name  = studentNameInput.value.trim();
    const email = parentEmailInput.value.trim();

    // Basic validation — the inputs already have HTML 'required' but we
    // double-check here in case some browser ignores it.
    if (!name || !email) {
      alert('Please enter both your name and your parent\'s email before starting.');
      return;
    }

    // Persist the student info so it survives a refresh.
    saveStudentInfo(name, email);

    // Begin the test for real.
    startTest();
  });
}


/* =====================================================================
   SECTION 7 — TEST SCREEN: STARTING & RESUMING
   ===================================================================== */

function startTest() {
  // Record the exact moment the test began. Everything timer-related
  // is derived from this single timestamp, so even if the page reloads
  // we can still compute remaining time correctly.
  const startTime = Date.now();
  localStorage.setItem(STORAGE_KEY_START, String(startTime));

  // No answers yet, but make sure we have a clean object.
  answers = {};
  saveAnswersToStorage();

  // Switch screens.
  startScreen.classList.add('hidden');
  testScreen.classList.remove('hidden');

  // Render questions, install handlers, lock the page, start the timer.
  renderQuestions();
  installPageLock();
  startTimer(startTime);
  updateAnsweredCount();
  populateStudentDisplay();

  // Scroll to the top so the student sees the timer right away.
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function resumeTest(startTime) {
  // Called when we detect (on page load) that a test is already in progress.
  // The flow is the same as startTest() except we DO NOT reset the start
  // time and we DO restore previously-typed answers.
  answers = loadAnswersFromStorage();

  startScreen.classList.add('hidden');
  testScreen.classList.remove('hidden');

  renderQuestions();          // creates the textareas
  restoreAnswersToTextareas();// fills them with the saved values
  installPageLock();
  startTimer(startTime);
  updateAnsweredCount();
  populateStudentDisplay();
}

function populateStudentDisplay() {
  // Show the student's name in the sticky bar so they can see whose
  // test this is (helpful if a parent and child share a device).
  const info = loadStudentInfo();
  if (info && info.name) {
    studentDisplay.textContent = info.name;
  }
}


/* =====================================================================
   SECTION 8 — RENDER QUESTIONS
   Build a card for each question and wire up auto-save on every keystroke.
   ===================================================================== */

function renderQuestions() {
  questionsContainer.innerHTML = '';
  totalCountEl.textContent = String(testQuestions.length);

  // Build a lookup: passageNumber -> passage object
  const passageMap = {};
  testPassages.forEach((p) => { passageMap[p.passageNumber] = p; });

  // Track which passages we've already rendered so we don't repeat them.
  const renderedPassages = new Set();

  testQuestions.forEach((question, index) => {
    // If this question belongs to a passage we haven't shown yet, render it.
    if (question.passageNumber && passageMap[question.passageNumber] && !renderedPassages.has(question.passageNumber)) {
      renderedPassages.add(question.passageNumber);
      const passage = passageMap[question.passageNumber];
      const passageBlock = document.createElement('div');
      passageBlock.className = 'passage-block';
      passageBlock.innerHTML = `
        <div class="passage-header">
          <span class="passage-number">Passage ${passage.passageNumber}</span>
          <span class="passage-type">${escapeHtml(passage.type || '')}</span>
        </div>
        <h3 class="passage-title">${escapeHtml(passage.title || '')}</h3>
        <div class="passage-text">${escapeHtml(passage.text || '').replace(/\n/g, '<br>')}</div>
        ${passage.moral ? `<p class="passage-moral"><em>Moral: ${escapeHtml(passage.moral)}</em></p>` : ''}
      `;
      questionsContainer.appendChild(passageBlock);
    }

    // Build the question card.
    const card = document.createElement('div');
    card.className = 'question-card';
    card.dataset.questionIndex = String(index);

    // Decide input type: if the question has `options`, render radio buttons;
    // otherwise fall back to a textarea (works for both math and MC formats).
    let inputHtml = '';
    if (question.options && typeof question.options === 'object') {
      // Multiple-choice radio buttons
      const entries = Object.entries(question.options);
      inputHtml = `<div class="mc-options" data-question-index="${index}">` +
        entries.map(([letter, text]) => `
          <label class="mc-option">
            <input type="radio" name="q${index}" value="${escapeHtml(letter)}" data-question-index="${index}" />
            <span class="mc-letter">${escapeHtml(letter)}</span>
            <span class="mc-text">${escapeHtml(text)}</span>
          </label>
        `).join('') +
        `</div>`;
    } else {
      // Free-text textarea (original math-test style)
      inputHtml = `
        <textarea
          rows="2"
          data-question-index="${index}"
          placeholder="Type your answer here..."
          autocomplete="off"
          spellcheck="false"></textarea>
      `;
    }

    // For MC prompts, only show the question stem (text before the options list).
    // The prompt may contain "A. ...\nB. ..." already — strip those since we
    // render them as clickable buttons.
    let promptText = question.prompt || '';
    if (question.options) {
      // Remove lines that start with A. / B. / C. / D. (the options block)
      promptText = promptText.replace(/\n[A-D]\.\s.*/g, '').trim();
    }

    card.innerHTML = `
      <span class="question-number">Q${index + 1}</span>
      <span class="question-topic">${escapeHtml(question.topic || '')}</span>
      <p class="question-prompt">${escapeHtml(promptText)}</p>
      ${inputHtml}
    `;

    questionsContainer.appendChild(card);
  });

  // Wire up event delegation for BOTH textareas and radio buttons.
  questionsContainer.addEventListener('input', handleAnswerInput);
  questionsContainer.addEventListener('change', handleAnswerInput);
}

function handleAnswerInput(event) {
  const el = event.target;
  let index, value;

  if (el.tagName === 'TEXTAREA') {
    index = parseInt(el.dataset.questionIndex, 10);
    value = el.value;
  } else if (el.tagName === 'INPUT' && el.type === 'radio') {
    index = parseInt(el.dataset.questionIndex, 10);
    value = el.value; // the letter: "A", "B", etc.
    // Highlight the selected option label
    const optionsContainer = el.closest('.mc-options');
    optionsContainer.querySelectorAll('.mc-option').forEach((lbl) => lbl.classList.remove('selected'));
    el.closest('.mc-option').classList.add('selected');
  } else {
    return;
  }

  answers[index] = value;
  saveAnswersToStorage();

  const card = el.closest('.question-card');
  if (value && value.trim().length > 0) {
    card.classList.add('answered');
  } else {
    card.classList.remove('answered');
  }

  updateAnsweredCount();
}

function restoreAnswersToTextareas() {
  Object.keys(answers).forEach((indexStr) => {
    const savedValue = answers[indexStr];
    if (!savedValue || !savedValue.trim()) return;

    // Try textarea first (math-style questions)
    const textarea = questionsContainer.querySelector(
      `textarea[data-question-index="${indexStr}"]`
    );
    if (textarea) {
      textarea.value = savedValue;
      textarea.closest('.question-card').classList.add('answered');
      return;
    }

    // Try radio buttons (multiple-choice questions)
    const radio = questionsContainer.querySelector(
      `input[type="radio"][name="q${indexStr}"][value="${savedValue}"]`
    );
    if (radio) {
      radio.checked = true;
      radio.closest('.mc-option').classList.add('selected');
      radio.closest('.question-card').classList.add('answered');
    }
  });
}

function updateAnsweredCount() {
  // Count how many questions have at least one non-whitespace character.
  const count = Object.values(answers).filter(
    (value) => typeof value === 'string' && value.trim().length > 0
  ).length;
  answeredCountEl.textContent = String(count);
}

function escapeHtml(text) {
  // Tiny HTML-escape helper. We use it for the question prompt and topic
  // so any quotes / brackets in the JSON content can't break the page or
  // create accidental script-injection vectors.
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


/* =====================================================================
   SECTION 9 — TIMER
   The timer reads the start timestamp from storage and recomputes
   remaining time on every tick. This is more reliable than counting
   down a variable because it survives the JS event loop pausing
   (e.g. when the tab is backgrounded) and still gives an accurate read.
   ===================================================================== */

function startTimer(startTime) {
  // Make sure any previous interval is cleared (idempotency).
  if (timerInterval) clearInterval(timerInterval);

  // Update once immediately so the student sees the right value right away
  // (without waiting one full second for the first tick).
  tickTimer(startTime);

  // Then update every second.
  timerInterval = setInterval(() => tickTimer(startTime), 1000);
}

function tickTimer(startTime) {
  // How much time has elapsed since the test began.
  const elapsed   = Date.now() - startTime;
  // How much time is left.
  const remaining = TEST_DURATION_MS - elapsed;

  // If time has run out, stop the timer and force submission.
  if (remaining <= 0) {
    clearInterval(timerInterval);
    timerInterval = null;
    timerDisplay.textContent = '00:00';
    timerDisplay.classList.add('danger');
    handleTimeUp();
    return;
  }

  // Otherwise update the display and adjust the warning class.
  timerDisplay.textContent = formatRemaining(remaining);

  // Warning thresholds — driven by the constants at the top of the file.
  if (remaining <= DANGER_THRESHOLD_MS) {
    timerDisplay.classList.remove('warn');
    timerDisplay.classList.add('danger');
  } else if (remaining <= WARN_THRESHOLD_MS) {
    timerDisplay.classList.add('warn');
    timerDisplay.classList.remove('danger');
  } else {
    timerDisplay.classList.remove('warn');
    timerDisplay.classList.remove('danger');
  }
}

function formatRemaining(ms) {
  // Convert milliseconds to "MM:SS" format. We use Math.floor so the
  // displayed seconds value matches the actual remaining time (Math.ceil
  // would show 90:00 for one extra tick, which feels misleading).
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // String#padStart pads with leading zeros so we always get "MM:SS".
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function handleTimeUp() {
  // The 90 minutes have elapsed. Auto-submit whatever the student typed.
  // The 'reason' parameter is passed to submitTest so the locked screen
  // can show a different message ("Time's up!" vs "Test complete!").
  submitTest({ reason: 'timeout' });
}


/* =====================================================================
   SECTION 10 — PAGE LOCK
   Two mechanisms work together:
     a) beforeunload — the browser shows a "Are you sure you want to
        leave?" dialog if the student tries to close the tab or navigate
        to a different URL. We can't fully block this (browsers no longer
        let pages truly trap users), but we can warn.
     b) popstate    — pushing a history entry on test start and re-pushing
        it whenever the browser fires popstate effectively neutralizes
        the back button. The page never actually navigates away.
   Both are removed when the test is submitted so the student can leave.
   ===================================================================== */

function beforeUnloadHandler(event) {
  // Modern browsers ignore the custom message and show their own generic
  // dialog, but they still need event.preventDefault() + returnValue set
  // for the warning to appear at all.
  event.preventDefault();
  event.returnValue = 'Your test is in progress. Leaving will pause the timer in some browsers, but it WILL keep running. Are you sure?';
  return event.returnValue;
}

function popStateHandler() {
  // Whenever the user presses Back, the browser fires popstate. By
  // immediately pushing a new identical state, we cancel the navigation —
  // the URL stays the same and the page does not change.
  history.pushState(null, '', location.href);
}

function installPageLock() {
  // Idempotent — calling twice does nothing extra.
  if (pageLockInstalled) return;

  // Push one history state so there's something for popstate to fire on.
  history.pushState(null, '', location.href);

  window.addEventListener('beforeunload', beforeUnloadHandler);
  window.addEventListener('popstate',    popStateHandler);

  pageLockInstalled = true;
}

function uninstallPageLock() {
  // Called after submission so the student can leave the page normally.
  if (!pageLockInstalled) return;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  window.removeEventListener('popstate',    popStateHandler);
  pageLockInstalled = false;
}


/* =====================================================================
   SECTION 11 — SUBMIT & GRADE
   Triggered either by the student clicking Submit or by the timer
   reaching zero. Same code path either way, with a small difference
   in the message shown on the locked screen.
   ===================================================================== */

function attachSubmitHandler() {
  submitTestBtn.addEventListener('click', () => {
    // Confirm if not all questions are answered. This is just a courtesy —
    // the student is still allowed to submit early.
    const answered = Object.values(answers).filter(v => v && v.trim()).length;
    const total    = testQuestions.length;
    if (answered < total) {
      const ok = confirm(
        `You have answered ${answered} out of ${total} questions. ` +
        `Are you sure you want to submit now? You can't come back to fix anything.`
      );
      if (!ok) return;
    }
    submitTest({ reason: 'manual' });
  });
}

function submitTest({ reason }) {
  // Stop the timer so it doesn't tick to zero AFTER we've already submitted.
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Disable all inputs so the student can't keep editing after submit.
  questionsContainer.querySelectorAll('textarea').forEach((ta) => {
    ta.disabled = true;
  });
  questionsContainer.querySelectorAll('input[type="radio"]').forEach((r) => {
    r.disabled = true;
  });

  // Re-read answers one more time (handles both textareas and radios).
  questionsContainer.querySelectorAll('textarea').forEach((ta) => {
    answers[ta.dataset.questionIndex] = ta.value;
  });
  questionsContainer.querySelectorAll('input[type="radio"]:checked').forEach((r) => {
    answers[r.dataset.questionIndex] = r.value;
  });
  saveAnswersToStorage();

  // Grade the test using the same algorithm as the existing app.js.
  const result = gradeTest();

  // Read student info that we saved at the start.
  const info = loadStudentInfo() || { name: 'Student', email: '' };

  // Stash the result so future page loads can display the locked screen
  // with the right score even after we clear the in-progress data.
  const resultPayload = {
    score: result.correct,
    total: result.total,
    submittedAt: new Date().toISOString(),
    reason: reason || 'manual'
  };

  // Send the email. We do this BEFORE removing the lock so that even if
  // the email pop-up takes focus, the page itself remains locked.
  sendEmail(info, result, reason);

  // Remove the page lock — the student can leave normally now.
  uninstallPageLock();

  // Wipe in-progress data so the next page load shows a fresh start screen
  // (the test is no longer locked — it can be retaken).
  clearTestStateExceptResult();

  // Show the locked / results screen.
  showLockedScreen({
    name:  info.name,
    email: info.email,
    score: result.correct,
    total: result.total,
    submittedAt: resultPayload.submittedAt,
    reason
  });
}

function gradeTest() {
  // Iterate every question and decide whether the typed answer matches
  // any of the acceptable variants. This is the SAME logic as app.js's
  // checkAnswers() — kept identical so behavior is consistent across the
  // site.
  let correct = 0;
  let total   = 0;

  testQuestions.forEach((question, index) => {
    const acceptable = question.acceptableAnswers || [];
    if (!acceptable.length) return; // skip parent-review-only questions

    total += 1;
    const value = (answers[index] || '').trim();
    if (!value) return; // blank answer — counts as wrong, not as skip

    // The match is a case-insensitive bidirectional substring check.
    // This is forgiving for kids: '24 cm' will match '24', and '4 four'
    // will match 'four'.
    const isCorrect = acceptable.some(
      (a) => normalize(value).includes(normalize(a))
          || normalize(a).includes(normalize(value))
    );
    if (isCorrect) correct += 1;
  });

  return { correct, total };
}

function normalize(text) {
  // Lowercase, strip non-alphanumerics, collapse whitespace. Same helper
  // as the existing app.js. Keeping it identical means students get the
  // same grading behavior whether they're doing daily practice or the
  // final test.
  return String(text).trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}


/* =====================================================================
   SECTION 12 — EMAIL
   Same formsubmit.co pattern that app.js already uses. We build a
   hidden form, append it to the body, submit it, and remove it — this
   is how formsubmit.co's free tier expects to be invoked.
   ===================================================================== */

function sendEmail(info, result, reason) {
  const answersText = testQuestions.map((q, i) => {
    const a = (answers[i] || '').trim() || '(blank)';
    // For MC questions, also show the correct answer
    const correct = q.correctChoice ? ` [Correct: ${q.correctChoice}]` : '';
    // Strip option lines from prompt for cleaner email
    let prompt = q.prompt || '';
    if (q.options) prompt = prompt.replace(/\n[A-D]\.\s.*/g, '').trim();
    return `Q${i + 1} [${q.topic}]: ${prompt}\n  Answer: ${a}${correct}`;
  }).join('\n\n');

  const reasonLabel = reason === 'timeout'
    ? '(time expired)'
    : '(submitted by student)';

  // Use the JSON title if available, otherwise fall back to generic
  const testTitle = document.querySelector('.test-hero h1')?.textContent || 'Test';
  const subject = `${testTitle} — ${info.name} ${reasonLabel}`;

  const body = [
    `Student Name : ${info.name}`,
    `Parent Email : ${info.email}`,
    `Submission   : ${reasonLabel}`,
    `Submitted At : ${new Date().toLocaleString()}`,
    `Score        : ${result.correct} / ${result.total}`,
    '',
    '── Answers ─────────────────────────────',
    answersText
  ].join('\n');

  // Build the hidden form. We use the same field names as app.js does so
  // any email template configured at formsubmit.co will work for both.
  const form = document.createElement('form');
  form.method       = 'POST';
  form.action       = `https://formsubmit.co/${encodeURIComponent(FORM_SUBMIT_TARGET)}`;
  form.target       = '_blank';
  form.style.display = 'none';

  const fields = {
    _subject     : subject,
    _captcha     : 'false',
    _template    : 'table',
    student_name : info.name,
    parent_email : info.email,
    section      : 'Math Final Test',
    score        : `${result.correct} / ${result.total}`,
    submission   : reasonLabel,
    full_report  : body,
    parent_notes : ''
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type  = 'hidden';
    input.name  = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  // Don't remove the form immediately — some browsers will cancel the POST
  // if its DOM node is removed too quickly. Wait one tick.
  setTimeout(() => form.remove(), 100);
}


/* =====================================================================
   SECTION 13 — LOCKED SCREEN
   Final state. Hides everything else and shows the score + confirmation.
   ===================================================================== */

function showLockedScreen({ name, email, score, total, submittedAt, reason }) {
  startScreen.classList.add('hidden');
  testScreen.classList.add('hidden');
  lockedScreen.classList.remove('hidden');

  // If the test was timed out, change the headline + emoji.
  if (reason === 'timeout') {
    lockedHeroEl.classList.add('timeout');
    lockedTitleEl.textContent    = 'Time\'s Up!';
    lockedSubtitleEl.textContent = 'Don\'t worry — your answers were saved and emailed to your parent.';
  } else {
    lockedHeroEl.classList.remove('timeout');
    lockedTitleEl.textContent    = 'Test Complete!';
    lockedSubtitleEl.textContent = 'Great job — your results have been sent.';
  }

  finalScoreEl.textContent   = `${score} / ${total}`;
  finalStudentEl.textContent = name  || '—';
  finalEmailEl.textContent   = email || '—';

  // Format the submission timestamp in the user's local time (locale-aware).
  // submittedAt is an ISO string, so new Date() parses it cleanly.
  const date = submittedAt ? new Date(submittedAt) : new Date();
  finalDateEl.textContent = date.toLocaleString();

  // Scroll to top so the score is the first thing the student sees.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* =====================================================================
   SECTION 14 — RESUME LOGIC (page load orchestrator)
   Decides which of the three screens to show based on what's currently
   in localStorage. This is THE entry point — it's called once per page
   load and chooses the correct flow.
   ===================================================================== */

function decideInitialScreen() {
  const startTime  = localStorage.getItem(STORAGE_KEY_START);

  // NOTE: Lock removed — the test can be retaken any time.
  // After each submission, in-progress data is cleared automatically
  // so the next page load lands back on the start screen.

  // Case A — a test is in progress (start time recorded).
  if (startTime) {
    const startTimeMs = parseInt(startTime, 10);
    const elapsed     = Date.now() - startTimeMs;

    // If 90 minutes have already elapsed (e.g. student closed the browser
    // for a long time), auto-submit immediately with whatever was typed.
    if (elapsed >= TEST_DURATION_MS) {
      // Restore the answers so submitTest can grade them.
      answers = loadAnswersFromStorage();
      // We need the questions and the test screen DOM in place before
      // we can grade and email. Render silently, then submit.
      renderQuestions();
      restoreAnswersToTextareas();
      submitTest({ reason: 'timeout' });
      return;
    }

    // Otherwise, resume the in-progress test with the remaining time.
    resumeTest(startTimeMs);
    return;
  }

  // Case C — fresh visit. Show the start screen.
  showStartScreen();
}


/* =====================================================================
   SECTION 15 — BOOTSTRAP
   Runs once the DOM is ready. Caches DOM references, loads questions,
   wires event handlers, then hands off to decideInitialScreen.
   ===================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  // ----- Cache DOM references -----
  startScreen        = document.getElementById('start-screen');
  testScreen         = document.getElementById('test-screen');
  lockedScreen       = document.getElementById('locked-screen');

  startForm          = document.getElementById('start-form');
  studentNameInput   = document.getElementById('student-name-input');
  parentEmailInput   = document.getElementById('parent-email-input');

  timerDisplay       = document.getElementById('timer-display');
  answeredCountEl    = document.getElementById('answered-count');
  totalCountEl       = document.getElementById('total-count');
  studentDisplay     = document.getElementById('student-display');
  questionsContainer = document.getElementById('questions-container');
  submitTestBtn      = document.getElementById('submit-test-btn');

  finalScoreEl       = document.getElementById('final-score');
  finalStudentEl     = document.getElementById('final-student');
  finalEmailEl       = document.getElementById('final-email');
  finalDateEl        = document.getElementById('final-date');
  lockedTitleEl      = document.getElementById('locked-title');
  lockedSubtitleEl   = document.getElementById('locked-subtitle');
  lockedHeroEl       = document.querySelector('.locked-hero');

  // ----- Wire static handlers -----
  attachStartFormHandler();
  attachSubmitHandler();

  // ----- Load test data -----
  try {
    await loadTestData();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `
      <main class="wrap"><div class="panel">
        <h2>Could not load test</h2>
        <p>${err.message}</p>
        <p><a href="index.html">Back to Learning Hub</a></p>
      </div></main>`;
    return;
  }

  // ----- Decide which screen to show -----
  decideInitialScreen();
});
