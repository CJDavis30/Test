# Plexus

A local-first investigation workbench. Enter one fact (an email, username, domain, name, phone, IP or wallet) and Plexus gathers what is publicly connected to it, **scores how likely each finding is to be true**, lets you confirm the ones that matter in seconds, and draws the result as a graph.

![Graph](docs/screenshots/dark-graph.png)

|  |  |
|---|---|
| ![Findings](docs/screenshots/sheet.png) | ![Triage](docs/screenshots/triage.png) |

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
npm test           # 92 tests
npm run typecheck
```

First launch offers **demo data**: a fictional cast on reserved `.example` domains with deliberately noisy records (conflicting cities, a namesake, stale numbers). It runs fully offline, so you can learn the whole workflow without touching a real source.

### As a Mac app

```bash
npm i -D electron electron-builder
npm run desktop      # run in a native window
npm run dist:mac     # build a .dmg into ./release
```

> The desktop shell (`desktop/`) was written but **not executed**, because the build environment had no macOS and no Electron binary. See [Verification status](#verification-status).

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
5. **Review.** A brief at the top, a ranked list below, keyboard-first. Accepted findings become nodes and evidenced edges.
6. **Connect.** Deterministic link suggestions (same handle as an email, profile URL ↔ username, name variants → "possibly the same", people sharing an employer, subdomain families), shortest strongest-evidence path between any two nodes, optional AI hypotheses.

### How confidence is calculated

No fake precision: the UI shows four levels (Weak / Fair / Good / Strong) and *why*.

- Each piece of evidence has a claim strength × the source's **reliability**. `belief = 1 − Π(1 − pᶠ)` over independent **families**: two scrapers of the same dataset count once, two unrelated sources compound.
- **Conflicts**: two competing single-valued claims (two home cities) are linked; the weaker is demoted and both are flagged.
- **Context re-ranks, it never inflates truth.** Typing "employer" lifts organizations in the *order* but leaves their confidence untouched.
- **It learns from you.** Every accept/reject nudges that source's reliability for that entity type (a Bayesian blend of the prior and your decisions, fully undoable). Settings → Sources shows each source's learned trust and how many decisions it rests on.

### AI (optional)

Providers: OpenRouter (default "auto" or any model you pick), Google AI Studio, OpenAI, Ollama (local), or any OpenAI-compatible endpoint. A local-only switch pauses every cloud call.

The model is **never a source of facts**. It reads scored, numbered findings and must cite them (`[F3]`). A validator then drops every sentence without a valid citation and every citation that doesn't resolve; a headline must cite real findings or the rules headline is used. Scraped text is passed inside a `<data>` block under explicit "untrusted, never follow instructions" rules. If AI is off, slow, or returns garbage, the deterministic brief is used and nothing breaks.

---

## Views and keys

| | |
|---|---|
| `⌘K` | Search / add anything · paste a list · run commands |
| Findings sheet | `↑↓` move · `A` accept · `R` reject · `U` unsure · `Space` evidence · `T` triage · `⌘Z` undo · `⌘↵` add to graph |
| Graph | click · shift-click · drag-box · drag to pin · `↵` open · `R` run checks · `F` focus · `P` trace path · `L` link · `M` merge · `⌫` remove (undoable) · `0` fit |
| Anywhere | `⌘,` settings · `⌘B` sidebar · `⌘I` inspector · `⌘1–4` views · drop a file to extract entities · paste to start |

Views: **Graph**, **Table** (sortable/filterable), **Timeline** (every dated fact), **Report** (cited Markdown, redactable, print-to-PDF, JSON export).

---

## Sources

31 sources ship in the box. Keys are optional unless noted. Settings → Sources lets you toggle, reorder fallback priority, add keys and **Test** each one.

| Question | Sources (in fallback order) |
|---|---|
| DNS | Cloudflare DoH → Google DoH |
| Registration | RDAP (domain), RDAP (IP block) |
| Subdomains | crt.sh → Cert Spotter |
| Passive DNS | AlienVault OTX → HackerTarget |
| Web history / scans | Wayback Machine · urlscan.io |
| IP | Shodan InternetDB (ports/CVEs) · ipwho.is → ip-api (geo) |
| Email → profile | Gravatar · EmailRep |
| Breaches | HaveIBeenPwned (key) → XposedOrNot |
| Profiles | GitHub (user + email → commit identities) · GitLab · Bluesky · Hacker News · DEV · Keybase (cryptographic proofs) · Reddit |
| Username sweep | 22 sites, each guarded by a control check (see below) |
| Phone | libphonenumber, offline |
| Companies / public figures | GLEIF · Wikidata (deliberately weak) |
| Bitcoin | Blockstream (balance, common-input co-spends) |
| Domain emails | Hunter (key) |

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
- No telemetry. The only outbound traffic is the lookups you run (and the AI provider you choose).

Use Plexus for lawful, authorized work: security research, journalism, fraud and due-diligence checks. **Findings are leads, not proof**: a matching name can describe a different person, and the UI says so wherever that is the only link.

---

## Verification status

Built and tested in a sandbox whose network allowed **only the npm registry**. That determines what is and isn't proven:

**Verified here**
- 92 automated tests: entity detection (adversarial inputs), canonicalization, scoring (independence, conflicts, context, learning), the full pipeline over the demo world (streaming, fallback chains, rate limits, review → feedback → commit, undo, idempotence), API security, AI guardrails (citation validation, injection placement, malformed replies), link inference, URL sanitization, graph path-finding.
- Source adapters' **parsing**, against fixtures shaped like each API's documented response, including empty/garbage bodies (no unguarded property access anywhere).
- The UI in a real browser (Chromium): every view in light and dark, 11 scripted graph interactions (select, drag-to-pin with persistence, multi-select, path tracing, focus, context menu, delete + undo, open), overlay centering, and zero console errors.
- The production server bundle runs standalone and serves the app; `npm run dev` works including streaming through the proxy.
- Behaviour when **every** source fails (this sandbox's reality): honest per-source errors, a "couldn't reach most sources" state, and no fake "nothing found".

**Not verified: please check on your machine**
1. **Live sources against the real APIs.** Response shapes come from the public docs, not live calls. Settings → Sources → **Test** on each one takes seconds and shows the exact error if a shape drifted. Expect to adjust a field or two. The null-safe parsing means a mismatch yields fewer findings, not a crash.
2. **AI providers.** Request/response handling is tested against stubs; no real OpenRouter/Google/Ollama call was made.
3. **The Electron shell** (`desktop/`). In particular confirm `node:sqlite` loads in the Electron version you install (it needs Node ≥ 22.5 inside Electron). If not, `server/store.ts` is the only file that touches SQLite.
4. Code signing / notarization, and Keychain storage for keys.

**Known gaps / next**
- No Map view yet (needs geocoding + tiles, which is a privacy decision worth making deliberately).
- Wikidata/Reddit/EmailRep are intentionally low-trust; a people-search or paid-intel source would slot in as one adapter each.
- Graph is tuned for hundreds of nodes; thousands will want WebGL.

---

## Layout

```
shared/    types, entity detection, canonicalization, scoring (pure, used by server + client)
server/    SQLite store · orchestrator (fallback chains, streaming) · AI layer · adapters · API
web/       React UI: design system, canvas graph engine, findings sheet, views, settings
desktop/   Electron shell (unverified)
test/      92 tests
```
