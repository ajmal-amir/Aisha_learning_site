const CONTENT_URL = './content/sections.json';
const FORM_SUBMIT_TARGET = 'qasim.aimal@gmail.com';

const sectionGrid = document.getElementById('section-grid');
const practiceArea = document.getElementById('practice-area');
const activeSectionType = document.getElementById('active-section-type');
const activeSectionTitle = document.getElementById('active-section-title');
const sectionDescription = document.getElementById('section-description');
const sectionContent = document.getElementById('section-content');
const practiceForm = document.getElementById('practice-form');
const scoreOutput = document.getElementById('score-output');
const backButton = document.getElementById('back-button');
const checkAnswersButton = document.getElementById('check-answers');

let sections = [];
let currentSection = null;
let currentScore = null;

async function loadSections() {
  const response = await fetch(CONTENT_URL);
  sections = await response.json();
  renderSectionCards();
}

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

function openSection(sectionId) {
  currentSection = sections.find((item) => item.id === sectionId);
  if (!currentSection) return;

  activeSectionType.textContent = currentSection.type;
  activeSectionTitle.textContent = currentSection.title;
  sectionDescription.innerHTML = `
    <p>${currentSection.description}</p>
    ${currentSection.story ? `<div class="question-block"><h4>Reading Passage</h4><p>${currentSection.story.replace(/\n\n/g, '</p><p>')}</p></div>` : ''}
  `;

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

  scoreOutput.textContent = 'Not checked yet';
  currentScore = null;
  practiceForm.reset();
  practiceArea.classList.remove('hidden');
  practiceArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function checkAnswers() {
  if (!currentSection) return;

  let total = 0;
  let correct = 0;

  currentSection.questions.forEach((question, index) => {
    const textarea = sectionContent.querySelector(`[data-question-index="${index}"]`);
    const feedback = document.getElementById(`feedback-${index}`);
    const value = textarea.value.trim();
    const acceptable = question.acceptableAnswers || [];

    if (!acceptable.length) {
      feedback.innerHTML = '<span>This response needs parent review.</span>';
      return;
    }

    total += 1;
    const isCorrect = acceptable.some((answer) => normalize(value).includes(normalize(answer)) || normalize(answer).includes(normalize(value)));

    if (isCorrect) {
      correct += 1;
      feedback.innerHTML = '<span class="correct">Correct</span>';
    } else {
      feedback.innerHTML = `<span class="incorrect">Try again</span> <div>Suggested answer: ${acceptable.join(', ')}</div>`;
    }
  });

  currentScore = { correct, total };
  scoreOutput.textContent = total ? `${correct} / ${total}` : 'Reviewed by parent';
}

function buildEmailPayload(formData) {
  const answers = currentSection.questions.map((question, index) => {
    const textarea = sectionContent.querySelector(`[data-question-index="${index}"]`);
    return `Question ${index + 1}: ${question.prompt}\nAnswer: ${textarea.value.trim() || '(blank)'}`;
  }).join('\n\n');

  const subject = `${formData.studentName} completed ${currentSection.title}`;
  const body = `Student Name: ${formData.studentName}\nParent Email: ${formData.parentEmail}\nSection: ${currentSection.type} - ${currentSection.title}\nScore: ${currentScore ? `${currentScore.correct} / ${currentScore.total}` : 'Not auto-graded'}\n\nAnswers:\n${answers}\n\nParent Notes:\n${formData.parentNotes || '(none)'}`;

  return { subject, body };
}

checkAnswersButton.addEventListener('click', checkAnswers);

practiceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!currentSection) return;

  const raw = new FormData(practiceForm);
  const formData = Object.fromEntries(raw.entries());

  if (!formData.studentName || !formData.parentEmail) {
    alert('Please fill in the student name and parent email first.');
    return;
  }

  const payload = buildEmailPayload(formData);

  const submissionUrl = `https://formsubmit.co/${encodeURIComponent(FORM_SUBMIT_TARGET)}`;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = submissionUrl;
  form.target = '_blank';
  form.style.display = 'none';

  const hiddenFields = {
    _subject: payload.subject,
    _captcha: 'false',
    _template: 'table',
    student_name: formData.studentName,
    parent_email: formData.parentEmail,
    section: `${currentSection.type} - ${currentSection.title}`,
    score: currentScore ? `${currentScore.correct} / ${currentScore.total}` : 'Not auto-graded',
    answers: payload.body,
    parent_notes: formData.parentNotes || ''
  };

  Object.entries(hiddenFields).forEach(([key, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  form.remove();
});

backButton.addEventListener('click', () => {
  practiceArea.classList.add('hidden');
  window.scrollTo({ top: document.getElementById('practice-sections').offsetTop - 20, behavior: 'smooth' });
});

loadSections().catch((error) => {
  console.error(error);
  sectionGrid.innerHTML = '<p>Could not load sections. Please check content/sections.json.</p>';
});
