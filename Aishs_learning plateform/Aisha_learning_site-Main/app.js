// === CONFIGURATION ===
const CONTENT_URL = './content/sections.json';
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

// === DOM REFERENCES ===
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

// === STATE ===
let sections = [];
let currentSection = null;
let currentScore = null;

// ─────────────────────────────────────────────
// LOAD & RENDER
// ─────────────────────────────────────────────

async function loadSections() {
  const response = await fetch(CONTENT_URL);
  sections = await response.json();
  renderSectionCards();
}

// Map section type string to a friendly background icon for cards
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
// ─────────────────────────────────────────────

function openSection(sectionId) {
  currentSection = sections.find((s) => s.id === sectionId);
  if (!currentSection) return;

  activeSectionType.textContent  = currentSection.type;
  activeSectionTitle.textContent = currentSection.title;

  // Build description + optional reading passage
  let storyHTML = '';
  if (currentSection.story) {
    // Use <pre> style rendering to preserve whitespace/formatting
    storyHTML = `<div class="question-block">
      <h4>📖 Reading Passage / Key Vocabulary</h4>
      <pre class="story-pre">${currentSection.story}</pre>
    </div>`;
  }

  sectionDescription.innerHTML = `<p>${currentSection.description}</p>${storyHTML}`;

  // Build question blocks
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

  scoreOutput.textContent = 'Not checked yet';
  currentScore = null;
  practiceForm.reset();

  // Restore submit button if it was replaced by confirmation banner
  const emailBox = submitBtn ? submitBtn.closest('.email-box') : document.querySelector('.email-box');
  if (emailBox && !emailBox.contains(submitBtn)) {
    emailBox.innerHTML = `
      <div class="email-info">
        <span class="email-icon">📬</span>
        <p>When you click <strong>Submit</strong>, your answers and score are automatically emailed to your parent!</p>
      </div>
      <button id="send-results" class="btn primary send-btn" type="submit">📤 Submit & Email Results</button>
    `;
    // Re-attach submit listener is handled by form submit event
  }

  practiceArea.classList.remove('hidden');
  practiceArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────
// GRADING
// ─────────────────────────────────────────────

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
// EMAIL
// ─────────────────────────────────────────────

function buildEmailPayload(formData) {
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

checkAnswersButton.addEventListener('click', checkAnswers);

practiceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentSection) return;

  const raw      = new FormData(practiceForm);
  const formData = Object.fromEntries(raw.entries());

  if (!formData.studentName || !formData.parentEmail) {
    alert('Please enter the student name and parent email before submitting!');
    return;
  }

  checkAnswers();
  const payload = buildEmailPayload(formData);
  sendEmail(formData, payload);
  showConfirmationBanner(formData.studentName, formData.parentEmail);
});

backButton.addEventListener('click', () => {
  practiceArea.classList.add('hidden');
  window.scrollTo({
    top: document.getElementById('sections').offsetTop - 20,
    behavior: 'smooth'
  });
});

// ─────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────

loadSections().catch((err) => {
  console.error('Failed to load sections:', err);
  sectionGrid.innerHTML = '<p>Could not load sections. Please check content/sections.json.</p>';
});
