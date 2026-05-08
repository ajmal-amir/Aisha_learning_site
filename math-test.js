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

// Where to fetch the 50 questions from. Same folder convention as the rest of the app.
const TEST_DATA_URL = './content/math-test.json';

// Where the email goes. Matches the address used in app.js for consistency.
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

// Total test duration. The user requested 1 hour 30 minutes = 90 minutes.
const TEST_DURATION_MINUTES = 90;

// Same number expressed in milliseconds. We do all timer math in ms because
// JavaScript's Date.now() returns ms, and that's the easiest way to compute
// elapsed/remaining time precisely.
const TEST_DURATION_MS = TEST_DURATION_MINUTES * 60 * 1000;

// localStorage keys. Using one prefix ('mathTest_') makes them easy to find
// in DevTools and easy to clear in bulk if we ever need to.
const STORAGE_KEY_ANSWERS    = 'mathTest_answers';     // object: { 0: "string", 1: "string", ... }
const STORAGE_KEY_START      = 'mathTest_startTime';   // number: ms timestamp when test started
const STORAGE_KEY_SUBMITTED  = 'mathTest_submitted';   // string: "true" once submitted
const STORAGE_KEY_STUDENT    = 'mathTest_studentInfo'; // object: { name, email }
const STORAGE_KEY_RESULT     = 'mathTest_finalResult'; // object: { score, total, submittedAt, reason }

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
let testQuestions = [];        // populated from math-test.json
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
  // Use fetch + await for clean async/await flow.
  // If the JSON file is missing or malformed, we want a clear error
  // message rather than a silent failure.
  const response = await fetch(TEST_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load test data: HTTP ${response.status}`);
  }
  const data = await response.json();
  // The JSON has a top-level `questions` array. We pull that out and
  // store it in our module-level state.
  testQuestions = data.questions;
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
  // Clear any previous content (defensive — in case render is called twice).
  questionsContainer.innerHTML = '';

  // Tell the sticky bar how many questions there are total.
  totalCountEl.textContent = String(testQuestions.length);

  // Loop through each question and build a card for it.
  testQuestions.forEach((question, index) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.dataset.questionIndex = String(index);

    // Note we use data-question-index (not innerHTML id) so the same
    // pattern as the existing app.js works here too.
    card.innerHTML = `
      <span class="question-number">Q${index + 1}</span>
      <span class="question-topic">${escapeHtml(question.topic || '')}</span>
      <p class="question-prompt">${escapeHtml(question.prompt)}</p>
      <textarea
        rows="2"
        data-question-index="${index}"
        placeholder="Type your answer here..."
        autocomplete="off"
        spellcheck="false"></textarea>
    `;

    questionsContainer.appendChild(card);
  });

  // After all the textareas exist in the DOM, wire up a single 'input'
  // listener that handles ALL of them (event delegation — more efficient
  // than attaching 50 individual listeners).
  questionsContainer.addEventListener('input', handleAnswerInput);
}

function handleAnswerInput(event) {
  // event.target is the textarea that the student is typing into.
  const textarea = event.target;
  if (textarea.tagName !== 'TEXTAREA') return; // ignore other elements

  const index = parseInt(textarea.dataset.questionIndex, 10);
  const value = textarea.value;

  // Update both our in-memory mirror and localStorage. We do this on
  // EVERY keystroke. localStorage is synchronous and fast for small
  // payloads, so debouncing isn't strictly necessary at this scale.
  answers[index] = value;
  saveAnswersToStorage();

  // Visual cue: green-tint the card if the student has typed anything.
  const card = textarea.closest('.question-card');
  if (value.trim().length > 0) {
    card.classList.add('answered');
  } else {
    card.classList.remove('answered');
  }

  // Update the "Answered: X / 50" counter in the sticky bar.
  updateAnsweredCount();
}

function restoreAnswersToTextareas() {
  // After a refresh / browser reopen, copy values from `answers` back
  // into each textarea so the student sees what they had typed.
  Object.keys(answers).forEach((indexStr) => {
    const textarea = questionsContainer.querySelector(
      `textarea[data-question-index="${indexStr}"]`
    );
    if (textarea) {
      textarea.value = answers[indexStr];
      // Mark the card as answered if the saved value is non-empty.
      if (answers[indexStr].trim().length > 0) {
        textarea.closest('.question-card').classList.add('answered');
      }
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

  // Disable every textarea so the student can't keep editing after submit.
  questionsContainer.querySelectorAll('textarea').forEach((ta) => {
    ta.disabled = true;
  });

  // Re-read answers from the textareas one more time, just in case the
  // last keystroke didn't fire 'input' (rare race condition with timer
  // expiry).
  questionsContainer.querySelectorAll('textarea').forEach((ta) => {
    answers[ta.dataset.questionIndex] = ta.value;
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
  // localStorage.setItem(STORAGE_KEY_RESULT,    JSON.stringify(resultPayload));
  // localStorage.setItem(STORAGE_KEY_SUBMITTED, 'true');

  // Send the email. We do this BEFORE removing the lock so that even if
  // the email pop-up takes focus, the page itself remains locked.
  sendEmail(info, result, reason);

  // Remove the page lock — the student can leave normally now.
  uninstallPageLock();

  // Wipe in-progress data (but keep the result + submitted flag).
  // clearTestStateExceptResult();

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
  // Build a human-readable plain-text version of all answers.
  const answersText = testQuestions.map((q, i) => {
    const a = (answers[i] || '').trim() || '(blank)';
    return `Q${i + 1} [${q.topic}]: ${q.prompt}\n  Answer: ${a}`;
  }).join('\n\n');

  // Different subject line if the test was force-submitted by the timer.
  const reasonLabel = reason === 'timeout'
    ? '(time expired)'
    : '(submitted by student)';

  const subject = `Math Final Test — ${info.name} ${reasonLabel}`;

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
  const submitted  = localStorage.getItem(STORAGE_KEY_SUBMITTED);
  const startTime  = localStorage.getItem(STORAGE_KEY_START);

  // Case A — the test has already been submitted. Show the locked screen
  // forever (or until the parent manually clears localStorage).
  // if (submitted === 'true') {
  //   const info   = loadStudentInfo()                                      || { name: '—', email: '—' };
  //   const result = JSON.parse(localStorage.getItem(STORAGE_KEY_RESULT) || '{}');
  //   showLockedScreen({
  //     name:        info.name,
  //     email:       info.email,
  //     score:       result.score   || 0,
  //     total:       result.total   || 0,
  //     submittedAt: result.submittedAt,
  //     reason:      result.reason
  //   });
  //   return;
  // }

  // Case B — a test is in progress (start time recorded but not submitted).
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
