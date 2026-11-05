# Plexus

A local-first investigation workbench. Enter one fact (an email, username, domain, name, phone, IP or wallet) and Plexus gathers what is publicly connected to it, **scores how likely each finding is to be true**, lets you confirm the ones that matter in seconds, and draws the result as a graph.

![Graph](docs/screenshots/dark-graph.png)

*(Screenshots show the fictional test world, which is not part of the app.)*

|  |  |
|---|---|
| ![Overview](docs/screenshots/overview.png) | ![Review](docs/screenshots/sheet.png) |
| ![Narrow window](docs/screenshots/narrow.png) | ![Triage](docs/screenshots/triage.png) |

Everything stays on your machine: cases and findings in SQLite, API keys in a private file, and a per-case audit log of every lookup and export.

---

## Run it

Requires **Node 22.13+** (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm run dev        # API on :4317, web UI on http://localhost:5173 (hot reload)
```

```bash
npm start          # production build, then serve everything on http://localhost:4317
npm test           # 674 unit/integration tests (they use a fictional test world that is not part of the app)
npm run typecheck
```

**There is no demo mode and no sample data.** The app starts empty and uses real sources. 35 of them need no setup. Add API keys any time in **Settings → Sources** (the welcome screen has an *Add API keys* button): a key unlocks the sources that need one and lifts rate limits on the rest, and Plexus starts using it immediately. Put an AI provider in **Settings → AI** if you want one (optional).

Upgrading from an earlier build that had demo data: on first start the old demo case, the saved demo switch and anything learned from the fictional sources are removed. A case is only removed if the demo flow made it or it holds nothing but demo evidence; real work is never touched.

**For developers:** the fictional world used by the tests and browser QA lives in `test/world/` and is never part of the app bundle. The app only loads it when `PLEXUS_TEST_WORLD` points at a bundle built with `npm run build:world`. `npm run qa:serve` does both.

### Install as a Mac app

```bash
git clone -b claude/wizardly-johnson-cwj8ub https://github.com/CJDavis30/Test.git ~/Plexus
cd ~/Plexus && ./scripts/mac/install.sh
```

Needs Node 22.13+ (`brew install node`) and git. The script builds **Plexus.app** into `/Applications` (or `~/Applications`), gives it the icon, signs it ad-hoc so it runs on Apple Silicon (no Apple Developer account needed), and opens it. Keep the `~/Plexus` folder: it is what updates are built from.

**Updating.** Either use **Plexus menu → Check for Updates…** (it also checks quietly once a day and only speaks up if something is new), or run `./scripts/mac/update.sh`. Both do `git pull`, rebuild, replace the app and reopen it. If a step fails the installed app is left untouched and you get an alert. Your cases live in `~/.plexus`, separate from the app, so updates never touch them. `./scripts/mac/uninstall.sh` removes the app (`--purge` also deletes your cases).

How it runs: the window talks to a local engine that the app starts with your system Node (found at install time, since GUI apps don't inherit your shell PATH), reusing one if it is already running. Logs: `~/Library/Logs/Plexus`. The icon source is `assets/icon/icon.svg`.

---

## How a lookup works

```
input ─► detect type ─► run sources (fallback chains) ─► merge by canonical key
                                                              │
         graph ◄─ you review & accept ◄─ score + conflicts ◄──┘
                                              │
                                  brief (rules, optionally AI with checked citations)
```

1. **Detect.** `jane@acme.com`, `@jdoe`, `acme.com`, `+1 415…`, `185.12.4.9`, `Doe, Jane`, `Austin, TX` are all typed automatically. Press `⇥` to correct a guess. Paste a whole list and each line is typed.
2. **Query sources.** Sources that answer the same question form a **fallback chain**: they are tried in priority order and the next one runs if the previous fails, returns nothing, or is rate-limited. Sources that return different data (e.g. username checks) all run. Results stream in as each source answers.
3. **Merge.** Claims from different sources about the same thing collapse into one finding by canonical key (`Jane.Doe+x@gmail.com` = `janedoe@gmail.com`, `Doe, Jane` = `Jane Doe`, tracking params stripped). Rejected findings are never resurrected by a re-run.
4. **Score.** See below.
5. **Review.** Four tabs: **Overview** (a two-line summary, the overall confidence, a map of how everything connects, what to dig into next), **To review**, **On your graph** and **Rejected**. *To review* is grouped by how sure Plexus is (Very likely / Likely / Possible / Long shot), with filter chips by type (emails, accounts, names…) and an *Accept all* for the top group. Each row shows the avatar, a one-line sentence, the confidence, and a green *Matches something you know* tag when it matches a fact you gave it. The panel beside it shows a **profile preview** (name, avatar, bio, created date, followers and so on, read from the evidence, no link-clicking), the verdict, the reasons in plain words, and **exactly what accepting will connect** to. The evidence and the maths behind the number are one click away.
6. **Accept means correct.** Accepting a finding puts it on the graph *immediately* and connects it to everything it touches: to what it was found from, and to every email, username, phone or other node whose value its own page shows (a Roblox profile whose display name is your username and whose bio lists your email ties to both nodes). Rejecting or marking *not sure* takes it back off again, unless you pinned it or wrote notes on it. There is no separate "add to graph" step. Undo (`⌘Z`) reverses a decision with its connections.
7. **Connect.** The graph uses an **organized layout** by default (see below). Deterministic link suggestions (same handle as an email, profile URL ↔ username, name variants → "possibly the same", people sharing an employer, subdomain families), shortest strongest-evidence path between any two nodes, optional AI hypotheses.

### The graph layout

Graphs get hairy because every finding links back to a hub and hubs share neighbours. Plexus avoids that structurally instead of hoping a physics simulation untangles it:

- **A tidy radial tree.** The strongest-evidence spanning tree of each connected group is the skeleton. The best-connected entity sits at the centre, its children on a ring grouped by type (emails together, accounts together…), deeper levels fanning out. Crowded rings split into two or three lanes so they stay compact, separate clusters are packed snugly around the biggest one instead of in a far-away row, and lone nodes share one tidy cluster. A relaxation pass guarantees a minimum gap between neighbours, and tests assert that nothing overlaps at 8, 30, 56, 120 and 300 nodes.
- **Cross-links are quiet.** Links that aren't part of the skeleton are drawn as faint arcs bundled toward the centre, and light up (with their label) only when you select or hover either end. Selecting a node dims everything unrelated.
- **Labels never collide.** They sit *outward* from their node, every node circle and earlier label is an obstacle, each label tries alternative positions, and the least important are dropped (they reappear as you zoom in).
- **Direct manipulation.** Drag a node and its whole branch comes with it (hold ⌥ to move just one); it stays pinned, and pins survive reloads. **Tidy up** (zoom controls, right-click, or ⌘K) releases every pin. A toggle switches to a free-form force layout if you prefer it.
- Line widths have a floor in screen pixels, so large graphs stay visible when zoomed out. 700 entities / 1,200 links render at 60 fps.

### How evidence is checked

A finding is not trusted because one source said so. Each one shows its trail, and then Plexus tries to break it:

- **Found directly.** For every source: *what was asked* ("Searched public TLS certificate logs for names under example.com"), *what came back* (the source's own record, quoted field by field: display name, public email, registrar, breach date…), and **a link**: the exact record page when the source gives one, otherwise a page where you can repeat the same lookup yourself. Simulated and offline sources say so instead of showing a dead link.
- **Cross-checks.** After the first answers arrive, Plexus asks *other* sources about what it found and compares. Three outcomes, each added as evidence quoting what the other source returned:
  - **Links back**: the account's profile lists the email you searched.
  - **Shared detail**: the same name, city, employer or photo appears on that profile, which corroborates *both* findings.
  - **Contradicts**: the profile shows a different name or place than the one we're now fairly sure of. That counts *against* the finding and lowers its score. Famous-person and namesake flags are never counted as corroboration.
  Sources that were asked and had nothing are listed as such, never as confirmation. Cross-checking uses a few extra requests per lookup (capped) and can be turned off in Settings.
- **The score** (e.g. 87%) is shown with its breakdown: found directly by N sources · N cross-checks confirm · N contradict · asked with no answer. Two views of the same dataset count once, so a second question to the same source is never a second opinion. Weak or disputed findings are worded as "Unconfirmed." / "Disputed." instead of being stated as fact.

### How confidence is calculated

No fake precision: the UI shows four levels (Weak / Fair / Good / Strong) and *why*.

- Each piece of evidence has a claim strength × the source's **reliability**. `belief = 1 − Π(1 − pᶠ)` over independent **families**: two scrapers of the same dataset count once, two unrelated sources compound.
- **Contradictions** (a cross-check found a different owner, name or place) cut a finding's score hard but cannot erase support from several strong, independent sources, so a disputed finding stays visible and labelled instead of vanishing.
- **Conflicts**: two competing single-valued claims (two home cities) are linked; the weaker is demoted and both are flagged.
- **Context re-ranks, it never inflates truth.** Typing "employer" lifts organizations in the *order* but leaves their confidence untouched.
- **It learns from you.** Every accept/reject nudges that source's reliability for that entity type (a Bayesian blend of the prior and your decisions, fully undoable). Settings → Sources shows each source's learned trust and how many decisions it rests on.

### Measured accuracy

`test/calibration.test.ts` runs five lookups across the fictional test world, which has known ground truth and deliberate false leads (a namesake, her handle, a holiday location), and scores the result: **precision 1.00 where Plexus says "likely", recall 1.00 on real findings, AUC 1.000** (every true finding outranks every false lead; the best false lead scores 37%, the weakest true finding 40%). It also checks that no confidence band overclaims and that bands are ordered. Absolute calibration is deliberately *not* asserted: the demo world is about 95% true, so it would only reflect that base rate. Tuning from this benchmark raised the contradiction penalty after it showed a handle owned by a namesake still scoring 43%. Run it with `npx vitest run test/calibration.test.ts`; the table prints in verbose mode.

### Reliability

- **Circuit breaker.** A source that fails three times in a row is paused (30 s, doubling to 15 min); lookups skip it and the next source in its fallback chain answers immediately instead of everyone waiting on a timeout. After the cooldown one trial call decides. Rate limits, missing keys and cancelled runs never count against a source. Settings → Sources shows *Paused until…* with a **Resume** button, and a passing **Test** resumes it too.
- **Retries** for transient network errors: two retries with exponential backoff and jitter. Cached answers never touch a paused source.

### Portability

- **Import** any Plexus export as a *new* case (nothing is overwritten; ids are re-issued so importing twice is safe). Evidence fingerprints are carried over, so tampering with the file shows up as "altered". Hostile files are validated and capped.
- **Exports:** Markdown, printable **HTML** (Print → Save as PDF, with the integrity section), **GraphML** (Gephi, yEd, Cytoscape), **CSV** (entities and relationships, spreadsheet-safe) and full JSON. Redacted exports mask names, notes, quotes and links.
- **Search across every case** from ⌘K, and a **shortcuts list** on `?`.

### Forensics: what identifiers, clocks and statistics can tell you

Everything here is computed on this Mac from public data and from the identifiers themselves. Each technique states its assumptions in the interface and is tested against simulations where the true answer is known.

| Technique | What it does | Measured |
|---|---|---|
| **Platform ID decoding** | Discord, Twitter/X and Instagram IDs are timestamps; Steam IDs name their account type; Minecraft UUIDs show whether Mojang or a cracked server issued them. A scanner finds every platform link and ID in pasted text and decodes it. | Exact: matches Discord's documented example, a known Steam ID, and platform MD5/SHA-256 on awkward lengths. |
| **Match Lab (same operator?)** | Fellegi–Sunter record linkage. Every signal (handle, creation time, shared contact, avatar, self-link, active hours, alternation) is a likelihood ratio in **bits**; prior odds plus the sum gives the probability. Drag the prior and watch the answer move. | Account-creation coincidence is a proper likelihood ratio: its average over unrelated pairs is 1. Calibrated against its own generative model. A copied handle is capped at 8 bits, because copying is easy. |
| **Circadian fingerprint** | Turns any timestamps (message links, commits, logs, public feeds) into a probability over timezones, with an Activity Clock. | Stated confidence tracks accuracy: 70% stated is right 68% of the time at 80 sittings; 97% vs 96% at 320. |
| **Daylight-saving fingerprint** | Whether the clocks change where this person lives, and in which hemisphere. | Calibrated; honest "not enough data" when only one season is present. |
| **Alternation test** | One person takes turns between accounts; two people overlap. | Flags one-operator pairs in at least 80% of simulations; false link rate at most 5%. |
| **Creation bursts** | A scan statistic over account creation times: three accounts in one minute is a pattern, with its p-value. | False alarms at most 1% on random data. |
| **Identities** | Groups accounts into operators, keeps namesakes and look-alikes apart, and lists "might be the same" for a human. | Property-tested: symmetric, monotone, every profile in exactly one group. |
| **Stress test** | Re-scores every conclusion with each source removed: what survives if one source is wrong? A *Stress map* on the graph rings the conclusions that hang on one source. | Tested: removing evidence never raises a score. |
| **Bits ledger** | For any finding, the chance every independent source is wrong at once; equals the score exactly (belief = 1 − 2^−bits). | Identity checked in tests. |
| **Next best move** | Expected information gain picks the check that would teach you the most and predicts what it would show. | Tested: gain peaks at 50/50, is never negative, and the expected posterior equals the prior. |
| **Email header forensics** | Route, hop timing, the sender's own timezone, SPF/DKIM/DMARC, forged-timeline checks. | Unit-tested on a realistic header and on forged ones. |
| **Chat export importer** | Open a Discord (JSON/CSV), Telegram (JSON) or WhatsApp (text) export in Decode: every speaker gets a message count, an activity clock and a timezone estimate, and the busy ones can be added to the case in one click. | Unit-tested on all four formats, including malformed and empty input. |
| **Self-calibrating ID clocks** | Roblox and GitHub IDs grow with time but not at a published rate. Plexus learns the ID→date curve from the accounts it has actually fetched (monotone fit) and dates a bare ID with an honest band. | Band is the 90th-percentile leave-one-out error ×1.6; refuses to guess with fewer than 6 anchors. |
| **Roblox depth + Discord invites** | Roblox: earlier usernames (real leads, weighted modestly because freed names get reused), friend and follower counts shown for context but never scored. Discord: a public invite link resolves to the server name, creation date (from its ID), size and who made the invite. | Fixture-tested (no live calls from this sandbox); a failing side endpoint never costs the main profile. |
| **Replay and confidence slider** | On the graph: *Replay* plays the investigation back in the order things were found (scrub, pause, exit; stored data and positions are never touched), and *Confidence* fades everything the evidence supports less than a chosen level. | Covered by end-to-end checks. |
| **Case health** | One score for how well-supported the case is: independent sources, how much hangs on a single source, unresolved conflicts, stale evidence. Opens to show each part and what would improve it. | Unit-tested. |
| **Staleness** | Old observations are flagged as such on the finding instead of silently looking current. | Unit-tested. |

**Autopilot** follows the strongest leads on its own and builds the graph while you watch. It accepts only what several independent sources agree on and nothing disputes, never follows guesses or bare names, logs everything, and can be **undone** in one click or run as a **dry run** first.

**Signed evidence package** (⌘K → *Save signed evidence package*): one HTML file containing the evidence, an Ed25519 signature, and code that recomputes every fingerprint and verifies the signature in the reader's own browser, with a built-in SHA-256 fallback. Verified in a real browser, including that changing one quote is detected. The signing key lives in a 0600 file on your Mac.

**Safeguards for young people.** Roblox and Discord are full of children. If a source shows what a subject says about their own age or school (never inferred from behaviour), Plexus flags the case, holds back from steps that point toward a real name, number, email or place, asks before you accept one, and points to reporting instead (platform safety forms, the police, NCMEC in the US). It can be wrong either way, so a person can override it and the override is logged. Live lookups also ask for a purpose once per case, written to the tamper-evident log; both can be turned off in Settings.

### Photos and files (⌘K → *Analyze a photo, video or file*, or just drop one on the window)

Reads what is inside a file, on this Mac, and puts the few facts that matter first: **where** (GPS with the direction the camera faced, and map, Street View and satellite links), **when** (with the timezone the device was set to, derived from the GPS clock when the camera did not record it), **who** (camera owner, author, last saver, tracked-change authors), **what with** (camera and serial number), and **what was done to it**. Works on JPEG, PNG, GIF, WebP, HEIC and TIFF photos, MP4/MOV video, PDF, Word/Excel/PowerPoint/OpenDocument, MP3/FLAC/WAV, Windows and Linux programs, and zip files.

| It notices | How |
|---|---|
| Impossible or contradictory dates | modified before taken; camera clock vs GPS clock; timezone that cannot fit the place; a date in the future; file name vs capture time |
| A picture edited after capture | the preview inside the file has a different shape from the picture (cropped), editing-software tags, Photoshop blocks, JPEG quality tables |
| Hidden data | bytes after the end of a JPEG/PNG/PDF (and what they look like: a zip, a program…), embedded files |
| AI-made images | Stable Diffusion, ComfyUI, NovelAI and similar settings in PNG text; declared AI source in XMP; Content Credentials (C2PA) detected |
| Leaks inside | the Windows user name in a build path (`C:\Users\jsmith\…`), emails, network shares and server names, MAC addresses, API keys and tokens (masked, with a warning not to use them) |
| A sky that does not fit | bright blue sky in a picture whose recorded place and time put the sun well below the horizon (NOAA solar position, measured in the browser) |
| Same camera, same place | across the files in a case: identical files, look-alike pictures (difference hash), same camera serial, same spot, taken minutes apart |

**Where was this picture taken, from the picture itself.** Uses your own AI model's vision (set a picture-reading model in Settings → AI). The picture is sent as pixels only (no metadata), three independent times, and the result is judged by how closely the three readings agree, never by what the model says about its own confidence: *city-level* needs 2+ readings within 25 km, *region* within 300 km, *country* within 1,500 km, and otherwise Plexus says there is no answer and lists candidates to check by hand. A cloud provider needs your confirmation every time. **When the photo also has real GPS, Plexus records how far the guess was, and shows you its measured accuracy on your own photos.** It is a strong lead on photos with distinctive signs and landmarks and weak on generic scenes; it has not been measured against a real model here, so run it on a few photos you know the answer to.

**Link forensics** (in Decode): a Discord file link is dated to the second from its attachment ID, with the time the link was issued and when it expires; avatar links give the account's creation date; TikTok, X, Instagram and Wayback links give their post or capture time; trackers are stripped, redirect wrappers followed to the real destination, and identifying parameters (including base64-hidden ones) shown.

### Integrity and safety (chain of custody)

- **Evidence fingerprints.** Every observation is sealed with a SHA-256 hash of exactly what Plexus recorded: the source, the question asked, the page, the quote, the record fields and the time. The fingerprint shows on each evidence row and in reports, and is re-checked on demand. The hash covers the *recorded* observation, not the raw network response, so it proves nothing was altered after capture, not that the source was truthful.
- **Tamper-evident activity log.** Each audit entry carries a hash that covers the entry before it. Editing or removing an entry breaks the chain, and **Settings → Audit log → Verify** names the first entry that no longer fits. Entries from before chaining are reported as legacy, never as tampering. (Removing the newest entries cannot be detected without an external anchor.)
- **Record check.** *Record intact* re-verifies the activity chain, every evidence fingerprint and the database itself (`PRAGMA integrity_check`) in one click. Reports and JSON exports include the result, plus a *Method and integrity* section describing how scores are produced.
- **Backups.** A full consistent copy is saved at start-up (at most every 6 hours) and before any case is deleted; the newest 10 are kept in `~/.plexus/backups`, with a *Back up now* button in Settings.
- **Spreadsheet-safe exports.** CSV cells that start with `=`, `+`, `-` or `@` are defanged so opening an export cannot run a formula.
- **Retention.** Optional (Settings → *Keep cases for*): cases idle past 30 days to 1 year are deleted automatically. Because backups would quietly keep that data, they are removed too and one fresh copy of what remains is taken. A purge log keeps only the case name and dates. Tested, including that the fresh backup does not contain the purged case.
- **Crash recovery and accessibility.** A render error shows a recovery screen instead of a blank window. Dialogs trap and restore keyboard focus, and every control is reachable and named (checked by `scripts/qa/buttons.cjs`: on every screen, at wide and narrow widths, each control must be reachable by a real click and not sit under a window-drag area).

### AI (optional)

Providers: OpenRouter, Google AI Studio, OpenAI, Ollama (local), or any OpenAI-compatible endpoint. The model defaults to **Automatic**: on OpenRouter Plexus lists the models your key can use, tries the free ones first (so an account with no credits works), remembers which one worked and falls back to the next if one is overloaded or rate-limited; on Google AI Studio it walks through the Flash models. Errors are in plain words ("your key is missing or wrong", "this account has no credits, pick a free model", "the free quota is used up for now", "this model does not accept pictures") with the one thing to do about it, and **Save and test** checks text and pictures separately. A local-only switch pauses every cloud call.

The model is **never a source of facts**. It reads scored, numbered findings and must cite them (`[F3]`). A validator then drops every sentence without a valid citation and every citation that doesn't resolve; a headline must cite real findings or the rules headline is used. Scraped text is passed inside a `<data>` block under explicit "untrusted, never follow instructions" rules. If AI is off, slow, or returns garbage, the deterministic brief is used and nothing breaks.

### What you already know (known facts)

Start a case with more than one fact: *\"I know this email is theirs, and I know they use this username.\"* (welcome screen → *I already know a few things about them*, or ⌘K, or right-click a node → *Mark as known*.) Known facts are treated as true (confirmed, top level, linked to each other) and are looked up like any search. Then **everything found for any of them is checked against all of them**: does this account's page list the email? is its handle the username? does it show the phone? Matches add independent evidence (an exact email on the page is worth about 95%, a shared handle depends on how unusual it is, a different name counts against), look-alike handles (`maralinden_`) do not get the credit of the real one, and a result reached from two different starting points counts as two routes. Telling Plexus something later re-scores everything already found. Taking a fact back removes its evidence.

### Tools tab (⌘6)

Thirty-odd small instruments that work with or without a case; anything they find can be added to your case in one click. Pictures and files: photo and file forensics, AI photo location, screenshot reader (AI reads the handles, emails, numbers and dates on a screenshot), edit detector (Error Level Analysis heat map), image twin finder (same picture, resized or mirrored?), reverse-image search links, metadata remover. Where and when: coordinate toolkit (decimal, DMS, Plus Code, geohash, UTM), shadow geolocator (sun height from a shadow plus the time gives a ring or a spot on Earth), shadow clock (time of day from a shadow at a known place), daylight check, historical weather at a place and hour, travel plausibility (could one person be at both sightings?), timestamp decoder (Unix, Windows, Chrome, iOS epochs in twelve zones), decode IDs and chat logs. Names and accounts: identify anything (IDs, hashes, JWTs, wallets, MACs, IBANs), username variants, username comparison in bits, look-alike and hidden-character detector (Cyrillic \"а\" in \"paypal\", zero-width characters, punycode), writing-style matcher, identities. Links and contacts: email guesser with Gravatar check, Gravatar checker, phone reader, domain history (registration, certificate and archive timeline), link unshortener (refuses private networks), link inspector, email header tracer. Your case: pull entities from pasted text, source health.

Honest limits: the shadow tools need a clear shadow on level ground and a trustworthy time (a 2° error in sun height moves the ring about 220 km); error-level analysis is a hint, not proof (sharp edges also light up); writing-style matching is weak evidence and says so; the AI tools need a vision model in Settings and ask before sending a picture to a cloud provider.

---

---

## Views and keys

| | |
|---|---|
| `⌘K` | Search / add anything · paste a list · run commands |
| Findings sheet | `↑↓` move · `A` accept · `R` reject · `U` unsure · `↵`/`Space` open details (narrow windows) · `T` one-by-one · `Esc` back · `⌘Z` undo · `⌘↵` add to graph |
| Graph | click · shift-click · drag-box · drag to pin · `↵` open · `R` run checks · `F` focus · `P` trace path · `L` link · `C` compare two accounts · `M` merge · `⌫` remove (undoable) · `0` fit |
| Anywhere | `⌘,` settings · `⌘B` sidebar · `⌘I` inspector · `⌘1–6` views · drop a file to extract entities · paste to start |

Views: **Graph**, **Table** (sortable/filterable), **Timeline** (every dated fact), **Identities**, **Report** (cited Markdown, redactable, print-to-PDF, JSON export) and **Tools**.

---

## Sources

**90 sources** ship in the box, plus a username sweep that reads the 600+ site WhatsMyName list. 68 need no key; 22 use a key you add in Settings → Sources (13 need one, 9 are better with one). Settings lets you toggle, reorder fallback priority, add keys and **Test** each one, and **Test all sources** runs every source against a known example and tells you which work from your Mac and why the others do not (blocked, address gone, format changed, unreachable, rate limited), with one click to turn off the dead ones.

| Question | Sources |
|---|---|
| DNS, registration, certificates | Cloudflare and Google DoH · RDAP (domain, IP) · crt.sh · Cert Spotter · SecurityTrails (key) · the site's own security.txt and humans.txt |
| Passive DNS, web history | AlienVault OTX · HackerTarget · Wayback Machine (availability and **first capture**) · urlscan.io |
| IP address | Shodan InternetDB · Shodan (key) · ipwho.is · ip-api · ipinfo · ipapi.co · BGPView · RIPEstat (abuse contact) · GreyNoise · AbuseIPDB (key) · VirusTotal (key) |
| Email | Gravatar · EmailRep · Hudson Rock infostealer exposure · HaveIBeenPwned (key) · XposedOrNot · LeakCheck |
| Developer and social profiles | GitHub · GitLab · Codeberg · Bitbucket · npm (with public emails) · crates.io · Docker Hub · Hugging Face · Launchpad · Stack Overflow · Codeforces · Codewars · Bluesky · Mastodon (tries the big servers, reads verified links) · Lobsters · Hacker News · DEV · Keybase · Reddit · Telegram public pages · YouTube channels · Linktree (every link someone published) · Gravatar by name · Last.fm (key) |
| Gaming | Roblox (profile, groups, earlier names) · Roblox similar names · Discord invites · Steam Community · Steam Web API (key) · Minecraft · Xbox · Lichess · Chess.com · speedrun.com · FACEIT (key) |
| Username sweep | 22 hand-picked sites plus **600+ more from WhatsMyName**, each guarded by a control check; adult and dating sites are skipped |
| People, research, records | OpenAlex · ORCID · US campaign donations (FEC) · US healthcare providers (NPI) · ICIJ Offshore Leaks · OpenSanctions (key) · GLEIF · Wikidata (deliberately weak) |
| Places | OpenStreetMap (address ⇄ coordinates) · Wikipedia places nearby |
| Blockchain | Blockstream · Blockchair (five chains) · ENS (the accounts and wallets an .eth name's owner published) |
| Phone | libphonenumber offline · Veriphone (key) |
| Web search | Brave Search (key) · Google through Serper (key) |
| Domain emails | Hunter (key) |

**Honest status.** These adapters are tested against recorded responses. From the build sandbox, a handful were also run against the real services: Bitbucket, crates.io, GitLab, npm and the security.txt reader worked; that run found and fixed a real bug (Docker Hub now answers with a different shape). The rest could not be reached from there, so use **Test all sources** on your Mac to see which of them work today.

**Check elsewhere.** Every item has a *Check elsewhere* button: about 200 hand-check links across usernames, emails, phones, domains, IPs, people, companies, places, wallets and images (profile pages, WHOIS and DNS tools, breach checkers, court and company records, reverse image search, WhatsApp/Telegram/Signal number checks). Plexus only builds the links. People-search data brokers are left out on purpose.

Design rules for sources: every response is parsed null-safely; 404 is "nothing", not an error; a total network failure is an **error**, never "no records"; and username sweeps only trust a site if a made-up username comes back *absent* (sites that answer 200 for everything are skipped, which removes the classic false-positive flood).

**Adding a source** is one object:

```ts
export const myThing = adapter({
  id: 'my-thing', name: 'My Thing', description: '…', accepts: ['domain'],
  capability: 'subdomains',      // joins that fallback chain (see CAPABILITY_MODE)
  family: 'my-thing',            // sources sharing a dataset share a family
  reliability: 0.8, priority: 3,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(entity, ctx) {
    const j = await getJson(ctx, `https://api.example/${entity.value}`);   // null on 404
    return arr(j?.items).map((i) => claim('domain', i.host, 'subdomain', 0.7, { url: i.link, snippet: '…' }));
  },
});
```
Register it in `server/adapters/live/index.ts` and it appears in Settings with a Test button.

---

## Privacy and security model

- **Local only.** The API binds to `127.0.0.1`, rejects foreign `Host`/`Origin` headers (DNS-rebinding and cross-site protection), and requires a custom header on every write.
- **Keys** live in `~/.plexus/secrets.json` (mode 0600), outside the database, so they never appear in exports or backups. The Keychain is the planned home for them in the packaged app.
- **Untrusted data stays untrusted.** Source URLs are reduced to http(s) before storage and again before rendering (no `javascript:` links); image sources are allow-listed; React renders everything as text.
- **Audit log** per case; report/JSON exports are themselves logged; the Report view can redact values for screenshots.
- No telemetry. The only outbound traffic is the lookups you run (and the AI provider you choose). The Tools tab adds, only when you press its button: Open-Meteo (weather: a place and an hour), gravatar.com (a one-way hash of an email, never the address), rdap.org, crt.sh and web.archive.org (a domain name), and the link you ask it to follow. Pictures stay on your computer for the edit detector, image comparison and metadata remover; the screenshot reader sends a picture to your AI provider only after you confirm. The link follower refuses anything that points at a private network.

Use Plexus for lawful, authorized work: security research, journalism, fraud and due-diligence checks. **Findings are leads, not proof**: a matching name can describe a different person, and the UI says so wherever that is the only link.

---

## Verification status

Built and tested in a sandbox whose network allowed **only the npm registry**. That determines what is and isn't proven:

**Verified here**
- 674 automated tests: entity detection (adversarial inputs), canonicalization, scoring (independence, conflicts, context, learning), the full pipeline over the fictional test world (streaming, fallback chains, rate limits, review → feedback → commit, undo, idempotence), API security, AI guardrails (citation validation, injection placement, malformed replies), link inference, URL sanitization, graph path-finding, evidence fingerprints, audit-chain tamper detection, backups, CSV defanging, the accuracy benchmark, the circuit breaker, import/export round trips and redaction leaks.
- Source adapters' **parsing**, against fixtures shaped like each API's documented response, including empty/garbage bodies (no unguarded property access anywhere).
- The UI in a real browser (Chromium): every view in light and dark; **230 end-to-end checks** (`scripts/qa/e2e.cjs`: cross-check confirmations and contradictions, score chips = stored score, connection-map nodes never overlap, details panel and sidebar drawer at narrow widths, a Check row on every source card, pivoting, review/undo/triage, merge, manual links and label editing, notes, palette, file-drop import, table sort/filter, timeline, report redaction + export, settings, case create/switch/rename/delete, theme, reload persistence) run three times in a row with zero failures and zero console errors; 11 scripted graph interactions (drag-to-pin with persistence, path tracing, focus, context menu, delete + undo…).
- A stress test (`scripts/qa/perf.cjs`): 700 nodes + 1,200 links at 60 fps, a 400-result sheet that paints in ~0.5 s and scrolls at 60 fps.
- The production server bundle runs standalone and serves the app; `npm run dev` works including streaming through the proxy.
- Behaviour when **every** source fails (this sandbox's reality): honest per-source errors, a "couldn't reach most sources" state, and no fake "nothing found".

**Not verified: please check on your machine**
1. **Live sources against the real APIs.** Response shapes come from the public docs, not live calls. Settings → Sources → **Test** on each one takes seconds and shows the exact error if a shape drifted. Expect to adjust a field or two. The null-safe parsing means a mismatch yields fewer findings, not a crash.
2. **AI providers.** Request/response handling is tested against stubs; no real OpenRouter/Google/Ollama call was made.
3. **The Mac packaging, on a Mac.** Tested here: the update-detection logic against real git repos, the version gate, the engine starting exactly as the app starts it, the installer's prerequisite checks, the icon file's structure. Not testable here (no macOS): `electron-builder` packaging, the ad-hoc signing step, the window itself, and the in-app update flow. If `./scripts/mac/install.sh` fails, `~/Library/Logs/Plexus/install.log` has the reason.
4. Developer-ID signing / notarization (the app is ad-hoc signed, fine for your own Mac), and Keychain storage for keys.

**Known gaps / next**
- No Map view yet (needs geocoding + tiles, which is a privacy decision worth making deliberately).
- Wikidata/Reddit/EmailRep are intentionally low-trust; a people-search or paid-intel source would slot in as one adapter each.
- Graph is tuned for hundreds of nodes (700 verified smooth); thousands will want WebGL.

---

## Layout

```
shared/    types, entity detection, canonicalization, scoring (pure, used by server + client)
server/    SQLite store · orchestrator (fallback chains, streaming) · AI layer · adapters · API
web/       React UI: design system, canvas graph engine, findings sheet, views, settings
desktop/   Electron shell + tested helpers
scripts/mac/ install / update / uninstall
assets/icon/ app icon (SVG source, PNGs, .iconset, .icns)
test/      674 tests (test/world/ holds the fictional world, test-only)
scripts/qa/  browser end-to-end + stress scripts
```
