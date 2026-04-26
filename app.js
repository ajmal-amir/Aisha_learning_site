// =====================================================================
// app.js — Learning Hub practice section logic
// ---------------------------------------------------------------------
// WHAT CHANGED IN THIS VERSION
// Every textarea answer and form field is now AUTO-SAVED to localStorage
// on every keystroke, per section. If the page is refreshed, the browser
// is closed, or the device crashes, the typed answers will still be there
// when the section is reopened. The saved data is only cleared after the
// user successfully submits (emails) the section, OR if the user manually
// erases their own typing (because erasing also auto-saves the empty
// value, which correctly reflects what they want stored).
// =====================================================================


// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

// Path to the JSON file containing all practice sections and their questions.
const CONTENT_URL = './content/sections.json';

// Email address that receives the formsubmit.co reports.
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

// localStorage key prefix. Each section gets a key like:
//   practice_section_math-day1
// Using a prefix keeps our data isolated from any other site state and
// makes it easy to find / clear in browser DevTools.
const STORAGE_PREFIX = 'practice_section_';


// ─────────────────────────────────────────────
// DOM REFERENCES
// We grab these once at script load. The DOM is already parsed by the
// time this script runs because the <script> tag is at the bottom of
// the page, after all referenced elements have been defined.
// ─────────────────────────────────────────────
const sectionGrid        = document.getElementById('section-grid');
const practiceArea       = document.getElementById('practice-area');
const activeSectionType  = document.getElementById('active-section-type');
const activeSectionTitle = document.getElementById('active-section-title');
const sectionDescription = document.getElementById('section-description');
const sectionContent     = document.getElementById('section-content');
const practiceForm       = document.getElementById('practice-form');
const scoreOutput        = document.getElementById('score-output');
const backButton         = document.getElementById('back-button');
const checkAnswersButton = document.getElementById('check-answers');
const submitBtn          = document.getElementById('send-results');


// ─────────────────────────────────────────────
// STATE
// In-memory state. The localStorage cache is the source of truth across
// page reloads, but reading from these in-memory variables during normal
// use is faster than re-parsing localStorage every time.
// ─────────────────────────────────────────────
let sections = [];          // populated from sections.json
let currentSection = null;  // the section currently open in the practice area
let currentScore = null;    // last grading result, or null if not graded yet


// ─────────────────────────────────────────────
// STORAGE HELPERS
// Three small functions wrap localStorage so the rest of the file does
// not have to think about JSON encoding or storage failures.
// ─────────────────────────────────────────────

// Build the localStorage key for a given section ID.
// Centralized here so if we ever change the prefix, only one place needs editing.
function storageKeyFor(sectionId) {
  return STORAGE_PREFIX + sectionId;
}

// Load the saved object for a section. Returns a fully-populated object
// even if there is nothing saved yet, so callers don't need to handle
// "no data" specially.
function loadSavedSection(sectionId) {
  // Default shape — what callers should expect even when nothing is saved.
  const blank = { answers: {}, studentName: '', parentEmail: '', parentNotes: '' };

  // Pull the raw JSON string out of localStorage.
  const raw = localStorage.getItem(storageKeyFor(sectionId));
  if (!raw) return blank; // nothing has been saved yet for this section

  // Parse it. If parsing fails (corrupt data), fall back to the blank shape.
  try {
    const parsed = JSON.parse(raw);
    // Defensive merging — if the saved object is missing fields (e.g.
    // because it was written by an older app version), the blank values
    // fill the gaps.
    return {
      answers      : parsed.answers      || {},
      studentName  : parsed.studentName  || '',
      parentEmail  : parsed.parentEmail  || '',
      parentNotes  : parsed.parentNotes  || ''
    };
  } catch (err) {
    // A corrupt entry should not break the whole page. Log and continue.
    console.warn('Saved section data was corrupt; starting fresh:', err);
    return blank;
  }
}

// Save the section data to localStorage.
function saveCurrentSectionData() {
  if (!currentSection) return; // nothing open, nothing to save

  // Collect every textarea inside the question area into one flat object
  // keyed by the question index. We do this on every keystroke; for a
  // few dozen short answers this is cheap and lets us avoid diffing.
  const answers = {};
  sectionContent.querySelectorAll('textarea[data-question-index]').forEach((ta) => {
    const idx = ta.dataset.questionIndex;
    answers[idx] = ta.value;
  });

  // Read the three header form fields. We use optional chaining (?.) so
  // a missing field never throws an error.
  const studentName = practiceForm.querySelector('[name="studentName"]')?.value || '';
  const parentEmail = practiceForm.querySelector('[name="parentEmail"]')?.value || '';
  const parentNotes = practiceForm.querySelector('[name="parentNotes"]')?.value || '';

  // Persist as a single JSON string. Wrapped in try/catch in case
  // localStorage is full or disabled (e.g. in private browsing modes).
  try {
    localStorage.setItem(
      storageKeyFor(currentSection.id),
      JSON.stringify({ answers, studentName, parentEmail, parentNotes })
    );
  } catch (err) {
    console.warn('Could not save section data:', err);
  }
}

// Wipe the saved data for a section. Called after a successful submission
// (the answers have been emailed and the test is "done", so they should
// not auto-fill next time).
function clearSavedSection(sectionId) {
  localStorage.removeItem(storageKeyFor(sectionId));
}


// ─────────────────────────────────────────────
// LOAD & RENDER
// ─────────────────────────────────────────────

// Fetch the JSON file once when the page loads, then build the cards.
async function loadSections() {
  const response = await fetch(CONTENT_URL);
  sections = await response.json();
  renderSectionCards();
}

// Map a section type string to the right emoji icon for its card.
// The map could grow over time — keeping it in one helper makes that easy.
function getCardIcon(type) {
  if (type.includes('Reading'))  return '📖';
  if (type.includes('Vocab'))    return '📝';
  if (type.includes('Writing'))  return '✏️';
  if (type.includes('Grammar'))  return '🔤';
  if (type.includes('Speaking')) return '🗣️';
  if (type.includes('Math'))     return '🔢';
  if (type.includes('Quran'))    return '☪️';
  return '📚';
}

// Build the grid of cards on the home page. Each card opens a section.
function renderSectionCards() {
  sectionGrid.innerHTML = '';
  sections.forEach((section) => {
    const icon = getCardIcon(section.type);
    const card = document.createElement('article');
    card.className = 'practice-card';
    card.setAttribute('data-type', section.type);

    card.innerHTML = `
      <span class="card-icon">${icon}</span>
      <p class="eyebrow">${section.type}</p>
      <h3>${section.title}</h3>
      <p>${section.description.slice(0, 80)}${section.description.length > 80 ? '…' : ''}</p>
      <button class="btn primary open-btn" type="button">Open Section ▶</button>
    `;
    card.querySelector('button').addEventListener('click', () => openSection(section.id));
    sectionGrid.appendChild(card);
  });
}


// ─────────────────────────────────────────────
// OPEN SECTION
// Renders the chosen section into the practice area, then restores
// any previously-typed answers from localStorage.
// ─────────────────────────────────────────────

function openSection(sectionId) {
  // Look up the section object from our in-memory array.
  currentSection = sections.find((s) => s.id === sectionId);
  if (!currentSection) return; // unknown id — should not happen

  // Header text: type label and title.
  activeSectionType.textContent  = currentSection.type;
  activeSectionTitle.textContent = currentSection.title;

  // Build the description block, which optionally includes a story /
  // key vocabulary box. The <pre> tag preserves the formatting from
  // the JSON's "story" field (line breaks, indentation, etc.).
  let storyHTML = '';
  if (currentSection.story) {
    storyHTML = `<div class="question-block">
      <h4>📖 Reading Passage / Key Vocabulary</h4>
      <pre class="story-pre">${currentSection.story}</pre>
    </div>`;
  }
  sectionDescription.innerHTML = `<p>${currentSection.description}</p>${storyHTML}`;

  // Build the question blocks. Each one has a textarea with a
  // data-question-index attribute so we can find it later.
  sectionContent.innerHTML = '';
  currentSection.questions.forEach((question, index) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.innerHTML = `
      <h4>Question ${index + 1} of ${currentSection.questions.length}</h4>
      <p>${question.prompt}</p>
      <textarea rows="3" data-question-index="${index}" placeholder="Type your answer here…"></textarea>
      <div class="feedback" id="feedback-${index}"></div>
    `;
    sectionContent.appendChild(block);
  });

  // Reset the score display and form state for a fresh open.
  scoreOutput.textContent = 'Not checked yet';
  currentScore = null;
  practiceForm.reset(); // clears form fields — we restore from storage right after

  // If the form's email box was replaced by a "report sent" banner during
  // a previous submission, rebuild the original button so the user can
  // submit again on a different section.
  const emailBox = submitBtn ? submitBtn.closest('.email-box') : document.querySelector('.email-box');
  if (emailBox && !emailBox.contains(submitBtn)) {
    emailBox.innerHTML = `
      <div class="email-info">
        <span class="email-icon">📬</span>
        <p>When you click <strong>Submit</strong>, your answers and score are automatically emailed to your parent!</p>
      </div>
      <button id="send-results" class="btn primary send-btn" type="submit">📤 Submit & Email Results</button>
    `;
    // Note: we don't need to re-attach a listener here — the submit
    // event is handled at the form level (see practiceForm.addEventListener
    // 'submit' below), so any new button inside the form will trigger it.
  }

  // ── RESTORE SAVED ANSWERS ──────────────────────
  // Pull whatever was saved last time the user worked on this section.
  // Then copy each value back into its matching textarea/input.
  const saved = loadSavedSection(currentSection.id);

  // Restore textarea answers, indexed by question number.
  Object.keys(saved.answers).forEach((idxStr) => {
    const ta = sectionContent.querySelector(`textarea[data-question-index="${idxStr}"]`);
    if (ta) ta.value = saved.answers[idxStr];
  });

  // Restore the three form fields. Optional chaining avoids errors if
  // the form structure ever changes and a field disappears.
  const nameInput  = practiceForm.querySelector('[name="studentName"]');
  const emailInput = practiceForm.querySelector('[name="parentEmail"]');
  const notesInput = practiceForm.querySelector('[name="parentNotes"]');
  if (nameInput)  nameInput.value  = saved.studentName;
  if (emailInput) emailInput.value = saved.parentEmail;
  if (notesInput) notesInput.value = saved.parentNotes;

  // Reveal the practice area and scroll it into view.
  practiceArea.classList.remove('hidden');
  practiceArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ─────────────────────────────────────────────
// AUTO-SAVE ON EVERY KEYSTROKE
// We attach a SINGLE 'input' listener to the practice area at script
// startup. Any keystroke inside any textarea or input within the
// practice area will fire it, and saveCurrentSectionData() handles
// gathering the latest values and writing them to localStorage.
// This is event delegation — much simpler and faster than attaching
// a listener to every textarea individually each time we render.
// ─────────────────────────────────────────────
practiceArea.addEventListener('input', () => {
  // Only save if a section is actually open. Defensive: this listener
  // is wired before the user opens a section, so currentSection might
  // still be null.
  if (currentSection) saveCurrentSectionData();
});


// ─────────────────────────────────────────────
// GRADING
// Same algorithm as before. Case-insensitive bidirectional substring
// match — generous to typos and partial answers, which is appropriate
// for a Grade-3 audience.
// ─────────────────────────────────────────────

// Lowercase, strip non-alphanumerics, collapse whitespace.
function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function checkAnswers() {
  if (!currentSection) return null;

  let total   = 0;
  let correct = 0;

  currentSection.questions.forEach((question, index) => {
    const textarea   = sectionContent.querySelector(`[data-question-index="${index}"]`);
    const feedback   = document.getElementById(`feedback-${index}`);
    const value      = textarea.value.trim();
    const acceptable = question.acceptableAnswers || [];

    // Open-ended questions have no acceptableAnswers — these are flagged
    // for parent review rather than auto-graded.
    if (!acceptable.length) {
      feedback.innerHTML = '<span>👀 Parent review needed for this answer.</span>';
      return;
    }

    total += 1;
    const isCorrect = acceptable.some(
      (a) => normalize(value).includes(normalize(a)) || normalize(a).includes(normalize(value))
    );

    if (isCorrect) {
      correct += 1;
      feedback.innerHTML = '<span class="correct">✅ Correct!</span>';
    } else {
      feedback.innerHTML = `<span class="incorrect">❌ Try again</span><div>Suggested: ${acceptable.join(', ')}</div>`;
    }
  });

  currentScore = { correct, total };
  scoreOutput.textContent = total ? `${correct} / ${total}` : '👀 Parent review';
  return currentScore;
}


// ─────────────────────────────────────────────
// EMAIL SENDING
// Same approach as before: build a hidden HTML form and submit it to
// formsubmit.co, which forwards the contents as an email.
// ─────────────────────────────────────────────

function buildEmailPayload(formData) {
  // Build a plain-text rendering of every question and its answer.
  const answers = currentSection.questions.map((q, i) => {
    const ta = sectionContent.querySelector(`[data-question-index="${i}"]`);
    return `Q${i + 1}: ${q.prompt}\nAnswer: ${ta.value.trim() || '(blank)'}`;
  }).join('\n\n');

  const scoreText = currentScore
    ? `${currentScore.correct} / ${currentScore.total}`
    : 'Not auto-graded (open-ended)';

  const subject = `📚 ${formData.studentName} completed: ${currentSection.title}`;
  const body = [
    `Student Name : ${formData.studentName}`,
    `Parent Email : ${formData.parentEmail}`,
    `Section      : ${currentSection.type} — ${currentSection.title}`,
    `Score        : ${scoreText}`,
    '',
    '── Answers ──────────────────────',
    answers,
    '',
    '── Parent Notes ──────────────────',
    formData.parentNotes || '(none)'
  ].join('\n');

  return { subject, body };
}

function sendEmail(formData, payload) {
  const url  = `https://formsubmit.co/${encodeURIComponent(FORM_SUBMIT_TARGET)}`;
  const form = document.createElement('form');
  form.method  = 'POST';
  form.action  = url;
  form.target  = '_blank';
  form.style.display = 'none';

  const fields = {
    _subject     : payload.subject,
    _captcha     : 'false',
    _template    : 'table',
    student_name : formData.studentName,
    parent_email : formData.parentEmail,
    section      : `${currentSection.type} — ${currentSection.title}`,
    score        : currentScore ? `${currentScore.correct} / ${currentScore.total}` : 'Not auto-graded',
    full_report  : payload.body,
    parent_notes : formData.parentNotes || ''
  };

  Object.entries(fields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type  = 'hidden';
    input.name  = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function showConfirmationBanner(studentName, parentEmail) {
  const emailBox = document.querySelector('.email-box');
  if (emailBox) {
    emailBox.innerHTML = `
      <div class="confirmation-banner">
        <span class="confirm-icon">✅</span>
        <div>
          <strong>Report sent! 🎉</strong>
          <p>${studentName}'s results have been emailed to <em>${parentEmail}</em>.</p>
          <p class="muted-note">Check your inbox (and spam folder) in a few minutes.</p>
        </div>
      </div>
    `;
  }
}


// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

// Check Answers button — grades but does not submit. Does not clear
// localStorage, because the user might still want to fix some answers
// after seeing what was wrong.
checkAnswersButton.addEventListener('click', checkAnswers);

// Form submission — grades, emails, then CLEARS the saved data.
// We clear after a successful submission because the section is "done",
// and re-opening it should give a clean slate rather than the answers
// that were just emailed.
practiceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentSection) return;

  // Pull all form fields as a plain object (studentName, parentEmail, parentNotes).
  const raw      = new FormData(practiceForm);
  const formData = Object.fromEntries(raw.entries());

  // Defensive validation — also enforced by HTML 'required' attributes,
  // but a friendly alert is better than relying on the browser's native
  // tooltip alone.
  if (!formData.studentName || !formData.parentEmail) {
    alert('Please enter the student name and parent email before submitting!');
    return;
  }

  // Grade, build the email payload, send it, then show the confirmation.
  checkAnswers();
  const payload = buildEmailPayload(formData);
  sendEmail(formData, payload);
  showConfirmationBanner(formData.studentName, formData.parentEmail);

  // Now that the section has been emailed, clear the saved draft for it.
  // If the same section is opened again, the textareas will be blank
  // (correct behavior — the previous attempt is already submitted).
  clearSavedSection(currentSection.id);
});

// Back button — closes the practice area. Note: this DOES NOT clear
// localStorage. The whole point of the auto-save feature is that
// reopening the section later (even after a refresh) restores the
// answers exactly as they were left.
backButton.addEventListener('click', () => {
  practiceArea.classList.add('hidden');
  window.scrollTo({
    top: document.getElementById('sections').offsetTop - 20,
    behavior: 'smooth'
  });
});


// ─────────────────────────────────────────────
// BOOTSTRAP
// Kick everything off. If the JSON fails to load (network error, bad
// path, malformed file), show a friendly error in the section grid.
// ─────────────────────────────────────────────
loadSections().catch((err) => {
  console.error('Failed to load sections:', err);
  sectionGrid.innerHTML = '<p>Could not load sections. Please check content/sections.json.</p>';
});
