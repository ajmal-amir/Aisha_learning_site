// === CONFIGURATION ===
// Replace with the parent's real email address to receive practice reports.
const CONTENT_URL = './content/sections.json';
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

// === DOM REFERENCES ===
// All elements are grabbed once at startup. If any ID changes in index.html, update here too.
const sectionGrid       = document.getElementById('section-grid');
const practiceArea      = document.getElementById('practice-area');
const activeSectionType = document.getElementById('active-section-type');
const activeSectionTitle= document.getElementById('active-section-title');
const sectionDescription= document.getElementById('section-description');
const sectionContent    = document.getElementById('section-content');
const practiceForm      = document.getElementById('practice-form');
const scoreOutput       = document.getElementById('score-output');
const backButton        = document.getElementById('back-button');
const checkAnswersButton= document.getElementById('check-answers');
const submitBtn         = document.getElementById('send-results');

// === STATE ===
let sections = [];       // All loaded section objects from JSON
let currentSection = null; // The section the student currently has open
let currentScore = null;   // { correct, total } set after grading, used in email

// ─────────────────────────────────────────────
// LOAD & RENDER SECTIONS
// ─────────────────────────────────────────────

// loadSections: fetches sections.json and builds the card grid.
// Algorithm: fetch → parse JSON → call renderSectionCards()
async function loadSections() {
  const response = await fetch(CONTENT_URL);
  sections = await response.json();
  renderSectionCards();
}

// renderSectionCards: clears the grid and rebuilds one <article> card per section.
// Each card's button is wired to openSection() with that section's id.
function renderSectionCards() {
  sectionGrid.innerHTML = '';
  sections.forEach((section) => {
    const card = document.createElement('article');
    card.className = 'practice-card';
    card.innerHTML = `
      <p class="eyebrow">${section.type}</p>
      <h3>${section.title}</h3>
      <p>${section.description}</p>
      <button class="btn primary" type="button">Open Section</button>
    `;
    card.querySelector('button').addEventListener('click', () => openSection(section.id));
    sectionGrid.appendChild(card);
  });
}

// ─────────────────────────────────────────────
// OPEN A SECTION
// ─────────────────────────────────────────────

// openSection: switches from the section grid view to the practice area for one section.
// Builds a textarea input for each question and resets any previous score.
function openSection(sectionId) {
  currentSection = sections.find((item) => item.id === sectionId);
  if (!currentSection) return;

  // Populate the header labels
  activeSectionType.textContent  = currentSection.type;
  activeSectionTitle.textContent = currentSection.title;

  // Render the description and optional reading passage
  sectionDescription.innerHTML = `
    <p>${currentSection.description}</p>
    ${currentSection.story
      ? `<div class="question-block"><h4>Reading Passage</h4><p>${currentSection.story.replace(/\n\n/g, '</p><p>')}</p></div>`
      : ''}
  `;

  // Build one question block per question in the section
  sectionContent.innerHTML = '';
  currentSection.questions.forEach((question, index) => {
    const block = document.createElement('div');
    block.className = 'question-block';
    block.innerHTML = `
      <h4>Question ${index + 1}</h4>
      <p>${question.prompt}</p>
      <textarea rows="3" data-question-index="${index}" placeholder="Type your answer here"></textarea>
      <div class="feedback" id="feedback-${index}"></div>
    `;
    sectionContent.appendChild(block);
  });

  // Reset score state and form fields
  scoreOutput.textContent = 'Not checked yet';
  currentScore = null;
  practiceForm.reset();

  // Show the practice area and scroll to it
  practiceArea.classList.remove('hidden');
  practiceArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────
// ANSWER GRADING
// ─────────────────────────────────────────────

// normalize: strips punctuation, collapses whitespace, lowercases — so
// "Teach!" matches "teach" and "A puppy" matches "a puppy".
function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

// checkAnswers: grades every question in the current section and updates
// feedback elements + scoreOutput.  Returns { correct, total } for use by the
// email builder so the auto-submit path can call this before sending.
function checkAnswers() {
  if (!currentSection) return null;

  let total   = 0;
  let correct = 0;

  currentSection.questions.forEach((question, index) => {
    const textarea  = sectionContent.querySelector(`[data-question-index="${index}"]`);
    const feedback  = document.getElementById(`feedback-${index}`);
    const value     = textarea.value.trim();
    const acceptable = question.acceptableAnswers || [];

    // Open-ended questions (empty acceptableAnswers) are flagged for parent review
    if (!acceptable.length) {
      feedback.innerHTML = '<span>This response needs parent review.</span>';
      return;
    }

    // A correct answer: the student's input contains an acceptable answer OR
    // an acceptable answer contains the student's input (handles short answers).
    total += 1;
    const isCorrect = acceptable.some(
      (answer) =>
        normalize(value).includes(normalize(answer)) ||
        normalize(answer).includes(normalize(value))
    );

    if (isCorrect) {
      correct += 1;
      feedback.innerHTML = '<span class="correct">✓ Correct</span>';
    } else {
      feedback.innerHTML = `<span class="incorrect">✗ Try again</span> <div>Suggested answer: ${acceptable.join(', ')}</div>`;
    }
  });

  // Store and display the score
  currentScore = { correct, total };
  scoreOutput.textContent = total ? `${correct} / ${total}` : 'Reviewed by parent';
  return currentScore;
}

// ─────────────────────────────────────────────
// EMAIL PAYLOAD BUILDER
// ─────────────────────────────────────────────

// buildEmailPayload: assembles the subject line and plain-text body
// that will be POSTed to FormSubmit and forwarded to the parent's inbox.
function buildEmailPayload(formData) {
  const answers = currentSection.questions.map((question, index) => {
    const textarea = sectionContent.querySelector(`[data-question-index="${index}"]`);
    return `Q${index + 1}: ${question.prompt}\nAnswer: ${textarea.value.trim() || '(blank)'}`;
  }).join('\n\n');

  const scoreText = currentScore
    ? `${currentScore.correct} / ${currentScore.total}`
    : 'Not auto-graded (open-ended)';

  const subject = `📚 ${formData.studentName} completed: ${currentSection.title}`;
  const body    = [
    `Student Name : ${formData.studentName}`,
    `Parent Email : ${formData.parentEmail}`,
    `Section      : ${currentSection.type} — ${currentSection.title}`,
    `Score        : ${scoreText}`,
    '',
    '── Answers ──────────────────────────',
    answers,
    '',
    '── Parent Notes ─────────────────────',
    formData.parentNotes || '(none)'
  ].join('\n');

  return { subject, body };
}

// ─────────────────────────────────────────────
// EMAIL SUBMISSION
// ─────────────────────────────────────────────

// sendEmail: programmatically creates a hidden <form> pointing at FormSubmit,
// appends it to the body, submits it (opens in new tab), then removes it.
// Why a hidden form? FormSubmit requires a real multipart POST — fetch() alone
// cannot trigger their email pipeline without their JS library.
function sendEmail(formData, payload) {
  const submissionUrl = `https://formsubmit.co/${encodeURIComponent(FORM_SUBMIT_TARGET)}`;

  const form = document.createElement('form');
  form.method  = 'POST';
  form.action  = submissionUrl;
  form.target  = '_blank';         // Open confirmation in new tab, don't navigate away
  form.style.display = 'none';

  const hiddenFields = {
    _subject  : payload.subject,
    _captcha  : 'false',           // Disable CAPTCHA (trusted educational use)
    _template : 'table',           // FormSubmit's table layout for email readability
    student_name  : formData.studentName,
    parent_email  : formData.parentEmail,
    section       : `${currentSection.type} — ${currentSection.title}`,
    score         : currentScore
                      ? `${currentScore.correct} / ${currentScore.total}`
                      : 'Not auto-graded',
    full_report   : payload.body,
    parent_notes  : formData.parentNotes || ''
  };

  // Attach each field as a hidden input
  Object.entries(hiddenFields).forEach(([key, value]) => {
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

// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

// "Check Answers" button: grade in place without sending email.
// Useful for mid-practice review before a final submission.
checkAnswersButton.addEventListener('click', checkAnswers);

// Form submit: triggered by "Submit & Email Results" button.
// Flow:
//   1. Validate name + email fields
//   2. Auto-run checkAnswers() so the score is computed even if the student
//      never clicked "Check Answers" manually
//   3. Build the email payload
//   4. Fire sendEmail() — parent receives the report automatically
//   5. Show a confirmation banner to the student
practiceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentSection) return;

  const raw      = new FormData(practiceForm);
  const formData = Object.fromEntries(raw.entries());

  if (!formData.studentName || !formData.parentEmail) {
    alert('Please fill in the student name and parent email before submitting.');
    return;
  }

  // Step 2: auto-check answers so the score is always included in the email
  checkAnswers();

  // Step 3–4: build payload and send
  const payload = buildEmailPayload(formData);
  sendEmail(formData, payload);

  // Step 5: show a friendly confirmation banner
  showConfirmationBanner(formData.studentName, formData.parentEmail);
});

// showConfirmationBanner: replaces the submit button area with a success message
// so the student/parent knows the report was fired off.
function showConfirmationBanner(studentName, parentEmail) {
  const emailBox = submitBtn.closest('.email-box');
  emailBox.innerHTML = `
    <div class="confirmation-banner">
      <span class="confirm-icon">✅</span>
      <div>
        <strong>Report sent!</strong>
        <p>${studentName}'s practice results have been emailed to <em>${parentEmail}</em>.</p>
        <p class="muted-note">Check your inbox (and spam folder) in a few minutes.</p>
      </div>
    </div>
  `;
}

// Back button: hide the practice area and scroll back up to the section grid.
backButton.addEventListener('click', () => {
  practiceArea.classList.add('hidden');
  window.scrollTo({
    top: document.getElementById('practice-sections').offsetTop - 20,
    behavior: 'smooth'
  });
});

// ─────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────

loadSections().catch((error) => {
  console.error('Failed to load sections:', error);
  sectionGrid.innerHTML = '<p>Could not load sections. Please check content/sections.json.</p>';
});
