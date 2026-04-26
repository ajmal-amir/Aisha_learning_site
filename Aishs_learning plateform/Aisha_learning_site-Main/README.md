# ELA Practice Hub

A static website you can deploy on GitHub Pages.

## What it includes
- Separate reading, writing, vocabulary, grammar, and speaking practice sections
- Auto-checking for sections with answer keys
- Email submission flow after practice using FormSubmit
- Easy content updates through `content/sections.json`

## Deploy on GitHub Pages
1. Create a GitHub repository.
2. Upload all files from this folder.
3. Go to **Settings → Pages**.
4. Set the source to your main branch root.
5. Save.

## Set your email notifications
Open `app.js` and change this line:

```js
const FORM_SUBMIT_TARGET = 'replace-with-your-email@example.com';
```

Put your real email there.

Then publish the site once and submit a test form. FormSubmit will send a confirmation email to activate submissions.

## Add new practice content
Edit `content/sections.json`.

Each section has:
- `id`
- `type`
- `title`
- `description`
- optional `story`
- `questions`
- `acceptableAnswers`

If you leave `acceptableAnswers` empty, the site will treat the answer as parent-reviewed.

## Best upgrade path later
If you want a friendlier content editor later, add a Git-based CMS like Decap CMS.
