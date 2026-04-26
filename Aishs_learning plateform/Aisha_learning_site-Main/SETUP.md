# Math Final Test - Setup Guide

## Files in this drop

| File | Where it goes | What it does |
|---|---|---|
| `math-test.html` | Root of your repo (next to `index.html`) | The test page itself |
| `math-test.css` | Root of your repo (next to `styles.css`) | Test-specific styles |
| `math-test.js` | Root of your repo (next to `app.js`) | All test logic |
| `content/math-test.json` | Inside the existing `content/` folder | The 50 questions |

The test page reuses your existing `styles.css`, so it will automatically match the rest of the site.

---

## Step 1: Drop the files in

Copy the four files into your repo so the structure looks like:

```
your-repo/
├── index.html
├── styles.css
├── app.js
├── math-test.html      <- NEW
├── math-test.css       <- NEW
├── math-test.js        <- NEW
└── content/
    ├── sections.json
    └── math-test.json  <- NEW
```

---

## Step 2: Add the test entry button to `index.html`

You need a way for the student to GET to the test from the main page. Find this block in your existing `index.html`:

```html
    <!-- SUBJECT ICON STRIP -->
    <section class="subject-strip panel">
```

Just **before** that section, paste in this new block:

```html
    <!-- ============================================================ -->
    <!-- MATH FINAL TEST ENTRY POINT                                  -->
    <!-- This is a separate locked-down test page, not a regular      -->
    <!-- section card. We give it its own panel so it stands out.     -->
    <!-- ============================================================ -->
    <section class="panel test-entry-panel" style="background: linear-gradient(135deg, #fff8e1 0%, #ffe8e8 100%); border: 3px solid #FF9F1C;">
      <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
        <div style="font-size: 64px;">📝</div>
        <div style="flex: 1; min-width: 240px;">
          <h2 style="margin: 0 0 6px;">Math Final Test</h2>
          <p style="margin: 0 0 4px; color: #555;">
            <strong>50 questions</strong> covering all 12 days of math practice.
            <strong>Timed: 1 hour 30 minutes.</strong>
          </p>
          <p style="margin: 0; color: #888; font-size: 14px;">
            Once you start, the page locks until you submit or time runs out.
            Your answers save automatically.
          </p>
        </div>
        <a href="math-test.html" class="btn primary big-btn" style="white-space: nowrap;">
          Start Test ▶
        </a>
      </div>
    </section>
```

That's the only change needed in `index.html`. Everything else (the styles for `.btn`, `.primary`, `.big-btn`, `.panel`) is already in your existing `styles.css`.

---

## Step 3: Test it locally

You can't open the test page by double-clicking it because it uses `fetch()` to load the JSON, and browsers block `fetch()` from `file://` URLs. Run a quick local server:

```bash
# from inside your repo folder
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

---

## What happens when the student takes the test

### Before starting
Student lands on `math-test.html`, sees the rules and three info tiles (50 questions / 1h 30m / 12 days). They type their name and parent's email, then press **Start Test**.

### During the test
- The test screen replaces the start screen
- A sticky bar at the top shows the timer (`90:00 → 00:00`), how many questions are answered (`0 / 50`), and the student's name
- All 50 questions appear in order with a textarea under each
- The **back button is disabled** (history.pushState trick)
- The browser shows a **"Are you sure?" warning** if they try to close the tab (beforeunload)
- **Every keystroke** is saved to `localStorage` immediately. If the page is refreshed, the browser is closed, or even if the device crashes, the answers come back when the page reopens.
- The timer is computed from a stored timestamp, not a counter — so closing the browser does NOT pause the timer. Time keeps running.
- When the timer drops below **10 minutes**, it turns yellow. Below **5 minutes**, it turns red and pulses.

### When the test ends
Either the student presses **Submit** OR the timer hits `00:00`. Either way:
1. All textareas are disabled so no further edits are possible
2. The test is auto-graded using the same algorithm as your existing `app.js`
3. The full report (questions + answers + score) is emailed via formsubmit.co to `qasim.aimal@gmail.com`
4. The locked screen replaces the test screen, showing the final score, student name, parent email, and date
5. `localStorage` is updated with `mathTest_submitted = true`, so re-opening the page just shows the locked screen — the test cannot be retaken

### Edge case: browser closed for an hour, reopened
If the student closes the browser at the 30-minute mark and reopens it 60 minutes later (so 90 minutes have now passed total), the page detects on load that time has expired and **immediately auto-submits** with whatever was typed. The student sees the locked screen with the "Time's Up!" message.

---

## How to reset the test (for a parent / for testing)

The test is intentionally hard to retake — that's the point of a final. If you (the parent or developer) need to clear it:

**Option 1 — From the browser DevTools console:**
```js
localStorage.removeItem('mathTest_answers');
localStorage.removeItem('mathTest_startTime');
localStorage.removeItem('mathTest_submitted');
localStorage.removeItem('mathTest_finalResult');
localStorage.removeItem('mathTest_studentInfo');
location.reload();
```

**Option 2 — From the DevTools Application tab:**
Application → Local Storage → your domain → delete the five `mathTest_*` keys.

---

## Where to change things later

| Want to change... | Edit this file | Edit this constant |
|---|---|---|
| Test duration (1h 30m → something else) | `math-test.js` | `TEST_DURATION_MINUTES` |
| Email recipient | `math-test.js` | `FORM_SUBMIT_TARGET` |
| Number of questions | `content/math-test.json` | Add/remove items in the `questions` array |
| Warning thresholds (yellow/red timer) | `math-test.js` | `WARN_THRESHOLD_MS`, `DANGER_THRESHOLD_MS` |
| Test page styling | `math-test.css` | (whichever block matches what you want to change) |

---

## Quick architecture summary (for reference)

```
┌─────────────────────────────────────────────────────────────────┐
│ math-test.html                                                  │
│   ├─ #start-screen   <- visible first                           │
│   ├─ #test-screen    <- hidden until "Start Test"               │
│   └─ #locked-screen  <- hidden until submit / timeout           │
└─────────────────────────────────────────────────────────────────┘
              │
              │ DOMContentLoaded fires
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ math-test.js: decideInitialScreen()                             │
│                                                                 │
│   if (mathTest_submitted)         → showLockedScreen()          │
│   else if (mathTest_startTime)                                  │
│      if (90 min already elapsed)  → submitTest('timeout')       │
│      else                          → resumeTest(startTime)      │
│   else                             → showStartScreen()          │
└─────────────────────────────────────────────────────────────────┘
```

---

That's it. Drop the files in, add the snippet, and you're done.
