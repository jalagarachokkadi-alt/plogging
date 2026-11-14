# ಜಲಗಾರ · Jalagara

*Named after Kuvempu's play ಜಲಗಾರ, in which the village street-sweeper is revealed as Shiva and the work of cleaning is honoured as worship.*

A web app for a daily plogging journal, made for phones. It's in Kannada and English, and ready for other Indian languages.

- **The app** is a set of static files. Host them free on GitHub Pages (or Cloudflare Pages / Netlify).
- **The data** goes into a Google Sheet, through a small Google Apps Script. That Sheet is the master copy and the backup.
- **Pickups** record when the panchayat or municipality takes the collected trash away, and mark those days' items as collected.
- **A Library** of related files (letters, newspaper cuttings, posters, PDFs, videos), filed under topics within topics.
- **Photos and videos** go into a Google Drive folder. People just pick the day's media in the app; uploading and linking happen by themselves. Photos are shrunk on the phone to about 1600 px. Videos go up in small pieces that resume where they stopped if the signal drops or the app is closed.
- **AI counting suggestions (optional).** A button in the entry form sends the day's photos (and a few frames from its videos) to Claude through your Apps Script, then shows suggested counts per category for the volunteer to tick and confirm. Your Claude API key stays in the script.
- **It works offline.** Every entry, photo and video is saved on the phone first, then uploaded automatically when there's a connection. The indicator at the top shows what's still waiting, with a percentage while a video uploads.

```
plogging-app/
├── index.html, app.js, config.js, sw.js, manifest.webmanifest, icons/, i18n/   ← upload these to GitHub Pages
│     i18n/en.json, kn.json        all labels, one file per language
│     i18n/languages.json          languages the app knows (name, font, date format)
│     i18n/_context.json           where each label appears (for reviewers)
│     icons/logo.svg               the ಜಲಗಾರ logo (app icon); logo-art.svg is the plain line drawing, for print
├── apps-script/Code.gs, apps-script/appsscript.json                     ← paste these into Google Apps Script
├── notebook-seed.json                                                   ← days transcribed from the notebook
└── README.md
```

---

## 1. Choose the Google account

Use one Google account to own the Sheet and the photo/video folder. A **new Gmail account just for the project** (e.g. `ourvillage.plogging@gmail.com`) works best:
- photos and videos don't eat into anyone's personal 15 GB,
- it's easy to hand over later,
- you and your cousin can both know its password.

## 2. Set up the backend (Google Apps Script) — about 10 minutes

1. Signed in as that account, open <https://script.google.com> → **New project**. Name it "Plogging Journal".
2. Delete the sample code in `Code.gs` and paste the contents of `apps-script/Code.gs`.
3. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file in editor**. Go back to the Editor, open `appsscript.json` and replace its contents with `apps-script/appsscript.json`. Save (Ctrl/Cmd-S).
4. In the toolbar, pick the function **`setup`** and click **Run**.
   - Google asks for permission. Click **Review permissions** → choose the account → **Advanced** → **Go to Plogging Journal (unsafe)** → **Allow**. The warning appears because you wrote the script yourself and Google hasn't reviewed it; that's normal. The script asks for access to Sheets and Drive, and to "connect to an external service", which is how it opens video uploads with Drive.
5. Open the **Execution log**. It shows three things — note them down:
   - `Spreadsheet:` link to the new Google Sheet,
   - `Photo folder:` link to the Drive folder,
   - `PASSCODE:` an 8-character code everyone will type into the app once.
6. **Deploy → New deployment** → gear icon → **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

**Updating to the version with sharing:** paste the new `Code.gs` and publish a new version; sharing photos that aren't on the phone needs it.

**Updating to the version with translated notes and item names:** paste the new `Code.gs` and publish a new version, as below. A *Translations* tab appears in the Sheet the first time something is translated.

**Updating to the version with pickups and the Library:** paste the new `Code.gs` over the old one and publish a new version (next paragraph). The *Topics* and *Library* tabs, the *Library* Drive folder and the new pickup columns are created by themselves on first use; your data, folder and passcode stay as they are. Then upload the new app files to GitHub Pages.

**If you're updating from the first version of this script:** paste the new `Code.gs`, run `setup` once more (it asks for the extra permission and keeps your existing Sheet, folder and passcode), then publish a new version as described next.

**Changing the script later:** after editing, use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. Creating a *new* deployment gives a new URL, which every phone would then need.

**Changing the passcode:** run `changePasscode` and read the new code in the log. Each phone must then enter it under Settings.

## 3. Put the app on GitHub Pages — about 10 minutes

1. Open `config.js` and paste the `/exec` URL:
   ```js
   window.PLOG_CONFIG = { apiUrl: "https://script.google.com/macros/s/XXXX/exec" };
   ```
   With the URL in place, phones only need the passcode. The passcode is **not** in any file, so the repository can be public.
2. On GitHub, create a new **public** repository, e.g. `plogging`.
3. **Add file → Upload files** and upload `index.html`, `app.js`, `config.js`, `sw.js`, `manifest.webmanifest` and the `icons/` and `i18n/` folders. (Leave out `apps-script/` and `notebook-seed.json`; they aren't needed on the site.)
4. Repository **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: `main`, folder `/ (root)` → **Save**.
5. After a minute the app is live at `https://<your-username>.github.io/plogging/`.

**Optional — your own address:** to serve it at e.g. `plogging.vidyasvam.in`, add that name under Settings → Pages → *Custom domain*, and create a DNS `CNAME` record pointing `plogging` to `<your-username>.github.io`.

**When you change any app file:** bump `VERSION` in `sw.js` (`"v1"` → `"v2"`) and upload it too. Otherwise phones keep showing the cached old version. Phones pick up the new version the next time the app is opened.

## 4. On each phone

1. Open the app's address in **Chrome** (Android) or **Safari** (iPhone).
2. Go to the **ಸೆಟ್ಟಿಂಗ್ಸ್ / Settings** tab → type the **passcode** → **ಸಂಪರ್ಕಿಸಿ / Connect**. You should see "ಸಂಪರ್ಕ ಯಶಸ್ವಿ / Connected".
3. Install it as an app:
   - Android Chrome: ⋮ menu → **Add to Home screen / Install app** (or use the button in Settings).
   - iPhone Safari: Share → **Add to Home Screen**.
4. Once it's on the home screen, it opens even without signal.

## 5. Load the notebook days (once)

On one phone or laptop: **Settings → ಬ್ಯಾಕಪ್‌ನಿಂದ ಸೇರಿಸಿ / Add from backup → choose `notebook-seed.json`**. This adds Days 2, 3, 4, 5, 8 and 9 and the 31 Oct rest day, using the numbers from the notebook photos. Before or after importing, it's worth fixing three things:
- Days 1, 6, 7 and 10 weren't in the photos, so add them by hand.
- The Kannada lines in the notebook weren't transcribed.
- "Cans" from the notebook were recorded as **beer cans**. Correct that if some were other cans.

The notebook's "10 Day Progress" page (plastic 714, bottles 109, cans 148, syringes 5, footwear 2 pairs, broken glass 3, CFL bulb 1, PVC fitting 1) is a good check once the missing days are in.

## 6. Photos and videos

In the day's entry, tap **📷 🎥 ಇಂದಿನ ಫೋಟೋ, ವಿಡಿಯೋ ಆರಿಸಿ / Choose today's photos and videos**, select everything from the gallery in one go, and save. Nothing else is needed.

What happens behind the scenes:
- **Photos** are shrunk to about 1600 px (roughly 300–500 KB each) and uploaded one by one.
- **Videos** are uploaded as they are, straight from the phone to Drive, in 2 MB pieces. If the signal drops or the app is closed, the next sync asks Drive how much arrived and continues from there, so nothing is sent twice. Some browsers won't send directly to Drive; the app notices this and sends the pieces through the Apps Script instead, which is slower but works the same way.
- While a video uploads, the indicator shows **⬆ 45%** and the screen is kept on. Uploads only run while the app is open. A phone that's locked or switched to another app pauses the upload, and it picks up again next time the app is opened.
- In the journal, tapping a day shows its photos full size and plays its videos with Drive's player. Drive needs a few minutes after an upload to prepare a video for playback; until then its tile shows a plain ▶.
- **Settings → "Upload videos only on Wi-Fi"** holds videos back while the phone is on mobile data (Android Chrome only). Photos and entries still upload straight away.
- A single video can be up to 500 MB.

**Storage:** the project account has 15 GB, shared by Gmail, Drive and Photos. Videos are what fill it. The four sample clips in the notebook folder were 37 MB together (WhatsApp-compressed); straight from the phone camera, a minute of 1080p video is often 100 MB or more. To make the space last, record at 720p, or pick clips that have already been through WhatsApp. When space runs low, either buy Google One storage for the project account or move older months' video folders elsewhere.

**Why not YouTube?** Videos uploaded through YouTube's API from a project that hasn't passed Google's compliance audit are locked to *Private*. That means only the account owner could watch them, and they can't be switched to Unlisted. Uploading by hand in the YouTube app avoids that lock but costs your cousin extra steps every day. If you later want a few videos on YouTube publicly, download them from the Drive folder and upload them yourself.

**Taking photos, videos and voice notes in the app.** Under *Collected trash* there are four buttons:
- **📷 Photo** and **🎥 Video** open the phone's camera directly. The picture or clip comes straight back into the entry.
- **🎙 Voice note** records inside the app: tap the red button, speak, and tap again to stop. Listen to it, then **Attach** it or record again. Recordings stop by themselves at 10 minutes. The first time, the browser asks for permission to use the microphone.
- **🖼️ From phone** chooses photos, videos or audio files already on the phone, as before.

Voice notes upload the same way as videos and are saved in the same Drive folder (e.g. `2026-11-07_x1y2z3.m4a`). They aren't held back by "Wi-Fi only", since they're small. In the journal, a voice note shows as 🎙 with its length; open the day to play it.

## 7. AI counting suggestions (Claude)

### Turning it on
1. Create an API key in the Claude Console (console.anthropic.com → API keys) for the account that holds your credits.
2. In the Apps Script editor: **Project Settings → Script properties → Add script property**
   - Property `ANTHROPIC_API_KEY`, value: your key.
   - Optional: `CLAUDE_MODEL` (default `claude-sonnet-5-5`) and `CLAUDE_EFFORT` (default `low`).
3. In the editor, run **`testClaude`** once and check that the log shows `200` and a short reply.
4. No redeploy is needed for script properties. If you just pasted a new `Code.gs`, publish a new version as in section 2.

The button appears in the app after its next sync, about a minute or a pull-to-refresh later. Phones that aren't connected to the server never see it.

### How it's used
In the day's entry, the volunteer adds the photos and videos, then taps **✨ ಫೋಟೋಗಳಿಂದ ಎಣಿಕೆ ಸಲಹೆ (AI)**. After roughly half a minute a green panel lists:
- **a suggested count for each category**, with how sure it is (ಖಚಿತ / ಸುಮಾರು / ಅಂದಾಜು). "ಕಾಣುವಷ್ಟು ಮಾತ್ರ" means only the visible items were counted;
- **new items** that fit no category, such as a CFL bulb, added as "other items";
- **hazards** (syringes, broken glass, CFL bulbs, batteries);
- **a short note in Kannada**, often a tip for photographing more countably next time.

Categories the volunteer has already counted are left **unticked**, so the AI never overwrites a hand count unless someone ticks it. **ಆರಿಸಿದವನ್ನು ಸೇರಿಸಿ / Add selected** copies the ticked numbers into the form; the volunteer checks them and saves as usual. Each entry keeps a record of what the AI suggested (in the Sheet's `json` column), so you can later compare its suggestions with the final counts.

### Getting good counts
- **Counts are only as good as the photos.** Items inside full bags or under a heap can't be seen, so the AI reports what's visible and says when the real number is probably higher.
- **The one habit that makes counts accurate:** before bagging, spread each type of trash in a single layer on the tarp (bottles in rows, cans side by side) and take one photo from above per type. The app shows this tip under the button.
- **Wrappers and chip packets** can't be counted one by one. The AI describes the amount instead ("about two buckets"). If you want a number for them, weigh them; the entry has a weight field.
- **Photos count better than video.** The app takes up to six images per request: photos first, then two frames from each video. Frames only work for videos still on that phone; once a video has uploaded and the app has been reopened, only its photos are used.

### Cost and limits (estimate)
- **Per tap:** six images is roughly 10,000–30,000 input tokens, depending on how Claude sizes the images, plus a small answer. On Sonnet 5.5 (listed at $2 per million input tokens and $10 per million output) that's about **US$0.03–0.08 per tap**, a few rupees. Once a day comes to a dollar or two a month.
- **Cheaper option:** set `CLAUDE_MODEL` to `claude-haiku-5-5` for a much cheaper, somewhat less careful count.
- **Time limit:** Apps Script waits about a minute for an answer. If you see a timeout, use fewer photos, keep `CLAUDE_EFFORT` at `low`, or switch to Haiku.
- **Privacy:** the photos are sent to Anthropic's API for analysis. Avoid pictures of people where you can; a top-down shot of the trash on the tarp works best anyway.

**Sharing a day.** Open a day in the journal and tap **↗ ಹಂಚಿಕೊಳ್ಳಿ / Share**. The app prepares a short post in the reader's language: the date and day number, the place, the counts, the people and the impression. You can edit the post before sending, and choose whether to include people's names and whether to attach the day's photos (up to six). **Share** then opens the phone's share sheet for WhatsApp, Instagram, Facebook and so on. Photos that aren't on that phone are fetched from Drive first. Videos aren't attached; they stay in Drive. On a computer, the buttons are **Copy text** and **WhatsApp** (text only).

## 8. Pickups (ವಿಲೇವಾರಿ)

The bags the team fills wait somewhere until the gram panchayat or municipality takes them away. A **pickup** records that hand-over, and marks the items on those days as collected.

- **Recording one.** When anything is waiting, the journal shows a banner at the top: *"{n} items from {d} days are waiting for pickup"* with a **🚛 Record a pickup** button. (Or: ＋ Add → **🚛 Pickup** at the top of the form.)
- **The form:** date and time, who collected it (Gram Panchayat / Municipality / Scrap dealer / Other, plus an optional name or vehicle number), **which days' trash** (every day still waiting up to the pickup date is ticked), **which categories** (untick anything they didn't take — e.g. glass bottles kept aside for the scrap dealer), bags, weight, notes, and photos or a video of the collection. Media upload the same way as a day's media.
- **What changes:** each plogging day gets a badge — **ವಿಲೇವಾರಿ ಬಾಕಿ / Awaiting pickup**, **ಭಾಗಶಃ / Partly collected** (some categories still waiting, with the count), or **ವಿಲೇವಾರಿ ಆಗಿದೆ / Collected**. A later pickup — the scrap dealer taking the glass, say — completes the partly collected days.
- **Stats** gains pickups, items handed over, items still waiting, average days waited, and a table by collector. The CSV export has the same columns.
- **In the Sheet:** pickups are rows in *Entries* with type `pickup`. Each plogging row gets `collected_on`, `collected_by`, and, on pickup rows, `pickup_days` and `pickup_items`. These columns are filled in by the script; edit pickups in the app.
- Editing or deleting a pickup recalculates every day's status.

## 9. Library (ಭಂಡಾರ)

A place for everything around the effort that isn't a day's entry: newspaper cuttings, panchayat letters, posters, certificates, talks, old photos. It's the folder tab in the bottom bar.

- **Topics within topics**, as deep as you like (*Panchayat › Letters › 2026*). A breadcrumb trail at the top shows where you are; tap any part of it to go back up. Each topic shows how many subtopics and files it holds.
- **＋ ವಿಷಯ / ＋ Topic** creates a topic inside the current one. It asks for the name in each language the app has switched on; one is enough, and the others fall back to it.
- **＋ ಕಡತಗಳು / ＋ Files** adds photos, videos, PDFs, Word/Excel/PowerPoint files, and so on — several at once, up to 500 MB each, **at full quality** (unlike a day's photos, nothing is shrunk). They're kept on the phone and upload in the background, resuming after interruptions just like videos. A ⏳ marks those still waiting.
- **Tap a file** to see it: images and videos play in the app (Drive's viewer once uploaded), PDFs open in Drive's viewer, other kinds show an icon and a **Drive ↗** link. Here you can give it a title and a note, **link it to a day in the journal** (it then appears as a 📎 chip on that day), move it to another topic, or delete it.
- **⋯ on a topic:** rename, move (with its whole subtree), move up in the list, delete. Only an empty topic can be deleted.
- **Search** looks through topic names (in every language), file titles, notes and file names.
- **In Drive:** a *Library* folder inside the project folder, with a subfolder per topic mirroring the tree (named `ಕನ್ನಡ · English`). Renaming or moving a topic in the app renames or moves its folder. Deleted files go to Drive's trash, so they can be restored there for 30 days.
- **In the Sheet:** two tabs, *Topics* and *Library*, one row each. As with *Entries*, the app reads only the `json` column, so make changes in the app.
- Files are shared *Anyone with the link can view*, like the day's media (see *Things to know*).

## 10. Languages and labels

**Switching language:** the button at the top right switches between the languages offered. With two languages it's a toggle; with more it opens a list. Each phone remembers its own choice. Which languages are offered is set once for everyone, in **Settings → ಆ್ಯಪ್ ಭಾಷೆಗಳು / App languages**. English is always available as the fallback.

**How the labels are organised:** every word on screen has a key, such as `save` or `item.plastic_bottle`, and its text comes from `i18n/<language>.json`. When a label is missing in a language, the app shows the English one, so a half-translated language still works. Dates and numbers follow the language's own format, and each script loads its Noto font only when needed.

**Three ways to change a label:**
1. **The review page.** It's the published artifact *ಜಲಗಾರ — ಲೇಬಲ್ ಪರಿಶೀಲನೆ · Label review*, and it lists every label with where it appears, English beside the translation, and warnings for labels too long for their space. Edits save on the page; ask Claude to apply them, or use *Export…* to download `kn.json` and replace `i18n/kn.json` in the GitHub repository (then bump `VERSION` in `sw.js`).
2. **The Google Sheet, with no republishing.** Use **Settings → ಲೇಬಲ್‌ಗಳು → Copy labels to the spreadsheet** once. This creates a **Strings** tab (`key · where · en · kn · …`). Anything typed there wins over the app's files on every phone at its next sync. Copying again only adds new keys; it never overwrites what was edited in the sheet.
3. **Editing `i18n/<language>.json` directly**, for whole-file changes.

**Adding another language (for example Hindi or Tulu):**
- `languages.json` already lists Kannada, English, Tulu and Konkani (both in Kannada script), Hindi, Marathi, Tamil, Telugu, Malayalam, Bengali, Gujarati, Punjabi and Odia. For any other language, add a line with its code, name, Intl locale and Noto font.
- Tick the language in Settings → App languages. It works straight away, with English for everything not yet translated.
- Translate, by any of: the review page (pick the language at the top, then export `<code>.json` into `i18n/`), a new column headed with the language code in the **Strings** tab, or a copy of `en.json` saved as `i18n/<code>.json`.
- The starting trash categories get their names from the label files (`item.*` keys).
- AI suggestions write their notes in the language being used, or in the first non-English language offered.

**Names of trash items typed by volunteers.** These aren't labels; they're data, typed in whatever language the person was using:
- **One-off items** added on a day with *＋ another item* (CFL bulb, PVC pipe…).
- **New categories** added in Settings, where filling just one language's box is enough.

When `ANTHROPIC_API_KEY` is set (section 7), the next sync asks Claude to translate these names into every language offered, and stores the translations with the entry or category. Everyone then sees them in their own language. Machine translations carry a small **AI** mark until someone corrects them:
- For a one-off item, open the day, tap **Edit**, and retype the name in your language.
- For a category, tap its name in Settings.

A correction replaces only that language. Changing the original text clears the old machine translations, and they are redone at the next sync. Without an API key nothing is translated: names show as typed, and a new category's first name fills the other languages. Each translation request costs a fraction of a paisa.

**Notes, places and titles in the reader's language.** With the API key set, text people type is shown to others in their own language. This covers impressions, places, pickup notes, Library titles, and topic names missing a translation. A Kannada note appears in English on an English phone, and the other way round.
- Translated text carries a small globe. Tap it to see the original, and tap again to go back.
- Each text is translated once per language. The result is saved in a **Translations** tab in the Google Sheet, shared by every phone, and kept on each phone too.
- Opening the app again, or another person reading the same note, costs nothing. Text already in the reader's script is never sent.
- Each phone can switch this off in Settings, next to "Wi-Fi only".
- Editing a note makes it a new text, translated once more the next time someone reads it in another language.
- Typical cost: a few paise for a month of notes.

**Repeated "other items".** When the same one-off item turns up on two or more days, even spelt in different languages, Settings lists it under *Repeated 'other items'* with the number of days and items. **Make a category** asks for the name in each language, pre-filled with what's known. It then creates the category and moves the past days' counts into it, so stats show it separately from then on. Pickups that had taken "other items" from those days are updated to include it.

## 11. Backups and the spreadsheet

- **The Google Sheet is the master copy.** It has one row per day, with readable columns: date, place, people, a column per trash category, totals, notes, photo links and video links. Use **File → Version history** to recover anything, and **File → Download → .xlsx** whenever you want an offline copy (e.g. monthly).
- The app reads back **only the `json` column**. Edits made directly in the other columns aren't picked up by the app and get overwritten the next time that day is saved in the app. Make corrections in the app.
- **Photos and videos** are in the Drive folder, in one subfolder per month (`2026-11`, …). Deleting a day in the app removes its row but **keeps** its photos and videos. The Sheet's `photos` and `videos` columns link to each file.
- **The app's own export:** Settings → *CSV* (opens in Excel/Sheets) or *Full backup (JSON)*. The JSON file can be re-imported with "Add from backup".
- For a complete off-Google copy, use Google Takeout (<https://takeout.google.com>) on the project account now and then.

## 12. Things to know

**Which version is a phone on?** Settings → *About this app* (at the bottom) shows the app version (e.g. `v37`) and its date. Next to it the app checks the website: **✓ Up to date**, or **vNN is available. Update now**, which updates that phone on the spot. Phones also update by themselves when opened. The same card shows the date of the deployed **server script**; if it's older than the `SCRIPT_VERSION` line in your newest `Code.gs`, the script still needs pasting and publishing (section 2).

*For whoever changes the code:* every release needs a new version number, or phones keep the old files. Run `tools/bump.sh v38` (next number) before uploading; it updates both `app.js` and `sw.js`.


- **Access:** anyone with the app address **and** the passcode can add, edit and delete entries. Share the passcode only with the people doing the plogging. If it leaks, run `changePasscode`.
- **Sharing:** photos and videos are set to *Anyone with the link can view*, so they can show inside the app. The links are long random IDs and aren't listed anywhere public, but anyone who is given a link can open it. Avoid uploading anything you wouldn't want to circulate.
- **Speed:** each save goes through Apps Script and takes a second or two; media queue up and upload one by one. Because everything is saved on the phone first, nobody has to wait for that.
- **Clearing browser data** on a phone deletes anything not yet uploaded. Check that the pill says **ಉಳಿದಿದೆ / Saved** before clearing data or changing phones.
- **Google Workspace (company/school) accounts** sometimes block "anyone with the link" sharing. If photos or videos don't appear in the app, use a regular Gmail account as the owner.

## 13. Troubleshooting

| What you see | What it means / what to do |
|---|---|
| **ಸರ್ವರ್ ಇಲ್ಲ / No server** | No URL or passcode yet. Enter them under Settings. |
| **ಪಾಸ್‌ಕೋಡ್? / Passcode?** | The passcode is wrong or was changed. Enter the current one under Settings. |
| **ಆಫ್‌ಲೈನ್ · 3 / Offline · 3** | No signal; 3 changes are waiting. They'll upload by themselves when the signal returns. |
| **ವಿಫಲ / Failed** | The server didn't answer properly. The app retries every minute. If it persists, open the `/exec` URL in a browser: it should show `{"ok":true,...}`. If it doesn't, redeploy (section 2). |
| Error `not_set_up` | `setup` was never run in Apps Script. Run it. |
| A video sits at the same % for a long time | The signal is too weak for even a 2 MB piece, or the screen locked. It resumes by itself; keeping the app open on Wi-Fi speeds it up. |
| No ✨ AI button | `ANTHROPIC_API_KEY` isn't set, or the phone hasn't synced since. Tap the sync indicator. |
| "AI ಸಲಹೆ ಸಿಗಲಿಲ್ಲ: ai_error: …" | The message is from the Claude API: an invalid key, no credits left, or overloaded. Run `testClaude` to see the full error. |
| A video tile shows only ▶ | Drive is still preparing the video (a few minutes after upload). |
| A label still shows English | It isn't translated yet in that language. Add it on the review page or in the Strings tab. |
| A Strings-tab edit doesn't appear | The phone hasn't synced since. Tap the sync indicator. Check that the column header is exactly the language code (`kn`, `hi`, …). |
| Old version keeps showing | You forgot to bump `VERSION` in `sw.js`. Bump it, upload, then close and reopen the app. |

---

## ಬಳಕೆ — ತ್ವರಿತ ಮಾರ್ಗದರ್ಶಿ (for the plogging team)

**ಭಾಷೆ:** ಮೇಲಿನ ಬಲ ಮೂಲೆಯ ಬಟನ್‌ನಿಂದ ಕನ್ನಡ / English (ಮತ್ತು ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಸೇರಿಸಿದ ಇತರ ಭಾಷೆಗಳು) ಬದಲಾಯಿಸಬಹುದು.

**ಮೊದಲ ಬಾರಿ**
1. ಫೋನ್‌ನ Chrome‌ನಲ್ಲಿ ಆ್ಯಪ್‌ನ ವಿಳಾಸ ತೆರೆಯಿರಿ.
2. ಕೆಳಗಿನ **ಸೆಟ್ಟಿಂಗ್ಸ್** → **ಪಾಸ್‌ಕೋಡ್** ಬರೆಯಿರಿ → **ಸಂಪರ್ಕಿಸಿ**.
3. Chrome ಮೆನು (⋮) → **Add to Home screen**. ಇನ್ನು ಮುಂದೆ ಹೋಮ್ ಸ್ಕ್ರೀನ್‌ನ ಐಕಾನ್‌ನಿಂದಲೇ ತೆರೆಯಿರಿ.

**ಪ್ರತಿದಿನ**
1. ಕೆಳಗಿನ **＋ ದಾಖಲಿಸಿ** ಒತ್ತಿ.
2. ದಿನಾಂಕ, ಸಮಯ, ದೂರ, ಜಾಗ ತುಂಬಿ. ಬಂದವರ ಹೆಸರು ಸೇರಿಸಿ.
3. ಪ್ರತಿ ಕಸದ ವಿಧಕ್ಕೆ **＋ / −** ಒತ್ತಿ ಅಥವಾ ಸಂಖ್ಯೆ ಬರೆಯಿರಿ. ಪಟ್ಟಿಯಲ್ಲಿಲ್ಲದ ವಸ್ತುಗಳಿಗೆ (CFL ಬಲ್ಬ್, PVC ಪೈಪ್…) **＋ ಇನ್ನೊಂದು ವಸ್ತು**.
4. **ಅನಿಸಿಕೆ** ಬರೆಯಿರಿ.
5. **📷 🎥 ಇಂದಿನ ಫೋಟೋ, ವಿಡಿಯೋ ಆರಿಸಿ** ಒತ್ತಿ, ಗ್ಯಾಲರಿಯಿಂದ ಎಲ್ಲವನ್ನೂ ಒಟ್ಟಿಗೆ ಆರಿಸಿ. ಅಪ್‌ಲೋಡ್ ತಾನಾಗಿ ಆಗುತ್ತದೆ.
6. **ಉಳಿಸಿ**. ಪ್ಲಾಗಿಂಗ್ ಮಾಡದ ದಿನ ಮೇಲಿನ **ಪ್ಲಾಗಿಂಗ್ ಇಲ್ಲ** ಆರಿಸಿ, ಕಾರಣ ಬರೆದು ಉಳಿಸಿ.

**ಸಿಗ್ನಲ್ ಇಲ್ಲದಿದ್ದರೆ?** ಚಿಂತೆ ಬೇಡ — ಎಲ್ಲವೂ ಫೋನ್‌ನಲ್ಲಿ ಉಳಿಯುತ್ತದೆ. ಮೇಲಿನ ಬಟನ್ "ಆಫ್‌ಲೈನ್ · 2" ಎಂದು ತೋರಿಸುತ್ತದೆ; ಸಿಗ್ನಲ್ ಬಂದಾಗ ತಾನಾಗಿ ಅಪ್‌ಲೋಡ್ ಆಗಿ "ಉಳಿದಿದೆ" ಎಂದಾಗುತ್ತದೆ. ಅಲ್ಲಿಯವರೆಗೆ ಬ್ರೌಸರ್ ಡೇಟಾ ಅಳಿಸಬೇಡಿ.

**AI ಸಲಹೆ:** ಫೋಟೋ ಸೇರಿಸಿದ ನಂತರ **✨ ಫೋಟೋಗಳಿಂದ ಎಣಿಕೆ ಸಲಹೆ (AI)** ಒತ್ತಿ. ಅರ್ಧ ನಿಮಿಷದಲ್ಲಿ ಸಲಹೆ ಬರುತ್ತದೆ — ಬೇಕಾದವನ್ನು ಟಿಕ್ ಮಾಡಿ **ಆರಿಸಿದವನ್ನು ಸೇರಿಸಿ**, ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ **ಉಳಿಸಿ**. ನಿಖರ ಎಣಿಕೆಗೆ: ಚೀಲಕ್ಕೆ ತುಂಬುವ ಮೊದಲು ಪ್ರತಿ ವಿಧದ ಕಸವನ್ನು ತಾರ್ಪಾಲಿನ ಮೇಲೆ ಒಂದೇ ಪದರದಲ್ಲಿ ಹರಡಿ, ಮೇಲಿನಿಂದ ಒಂದು ಫೋಟೋ ತೆಗೆಯಿರಿ.

**ವಿಡಿಯೋ ಅಪ್‌ಲೋಡ್** ಆಗುವಾಗ ಮೇಲೆ "⬆ 45%" ಎಂದು ಕಾಣುತ್ತದೆ. ಆಗ ಆ್ಯಪ್ ತೆರೆದೇ ಇರಲಿ. ಮುಚ್ಚಿದರೂ ತೊಂದರೆ ಇಲ್ಲ — ಮುಂದಿನ ಬಾರಿ ತೆರೆದಾಗ ನಿಂತಲ್ಲಿಂದಲೇ ಮುಂದುವರಿಯುತ್ತದೆ. ಮೊಬೈಲ್ ಡೇಟಾ ಉಳಿಸಬೇಕಿದ್ದರೆ ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ "ವಿಡಿಯೋಗಳನ್ನು Wi-Fi ಇದ್ದಾಗ ಮಾತ್ರ" ಆರಿಸಿ.

**ವಿಲೇವಾರಿ:** ಪಂಚಾಯಿತಿ / ನಗರಸಭೆಯವರು ಕಸ ತೆಗೆದುಕೊಂಡು ಹೋದ ದಿನ, ದಿನಚರಿಯ ಮೇಲಿನ **🚛 ವಿಲೇವಾರಿ ದಾಖಲಿಸಿ** ಒತ್ತಿ. ಯಾರು ಸಂಗ್ರಹಿಸಿದರು, ಯಾವ ದಿನಗಳ ಕಸ, ಯಾವ ವಿಧಗಳು (ಕೊಂಡೊಯ್ಯದ್ದನ್ನು ತೆಗೆಯಿರಿ) ಆರಿಸಿ, ಫೋಟೋ/ವಿಡಿಯೋ ಸೇರಿಸಿ **ಉಳಿಸಿ**. ಆ ದಿನಗಳು "ವಿಲೇವಾರಿ ಆಗಿದೆ" ಎಂದಾಗುತ್ತವೆ.

**ಭಂಡಾರ:** ಪತ್ರಿಕಾ ವರದಿ, ಪಂಚಾಯತ್ ಪತ್ರ, ಪೋಸ್ಟರ್, PDF, ವಿಡಿಯೋ ಮುಂತಾದವನ್ನು ವಿಷಯವಾರು ಇಡಲು. **＋ ವಿಷಯ** ಒತ್ತಿ ವಿಷಯ (ಅದರೊಳಗೆ ಉಪವಿಷಯ) ಮಾಡಿ; ಅದರೊಳಗೆ ಹೋಗಿ **＋ ಕಡತಗಳು** ಒತ್ತಿ ಕಡತಗಳನ್ನು ಆರಿಸಿ. ಕಡತವನ್ನು ಒತ್ತಿದರೆ ಶೀರ್ಷಿಕೆ, ಟಿಪ್ಪಣಿ, ಸಂಬಂಧಿಸಿದ ದಿನ ಬರೆಯಬಹುದು.

**ಅಂಕಿಅಂಶ** ಟ್ಯಾಬ್‌ನಲ್ಲಿ ಕಳೆದ 7 ದಿನ / 30 ದಿನ / ಈ ತಿಂಗಳು / ಎಲ್ಲಾ — ಒಟ್ಟು ವಸ್ತುಗಳು, ದೂರ, ಸಮಯ, ಭಾಗವಹಿಸಿದವರು, ವಸ್ತುವಾರು ಮತ್ತು ದಿನವಾರು ಲೆಕ್ಕ ನೋಡಬಹುದು.
