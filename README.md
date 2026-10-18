# PlainProof

**Understanding, with receipts.** PlainProof turns complicated documents into clear, personalized explanations, then checks every important fact against the original and shows you the evidence.

Built for the **AMD Developer Hackathon ACT III**, track *Create a New Kind of Experience*. All language-model work (fact extraction, adaptation, translation, verification, repair, and optionally photo reading) runs on an open model served by **vLLM on AMD Developer Cloud** (Instinct MI300X, ROCm).

> PlainProof never claims perfect accuracy. Findings are an automated assessment that can be wrong. Sensitive documents need human review, and the original document always remains the official source.

## What works, and what needs credentials

| Works out of the box (Preview Mode) | Needs the AI endpoint on AMD |
| --- | --- |
| Upload and real text extraction: PDF, scanned PDF and photos (OCR), DOCX, TXT, pasted text | Real AI explanations, written for each audience |
| Library, Studio, MeaningLock, ActionLens, Compare, ProofPass, VoiceSync with browser voices | Semantic verification by an independent verifier model |
| Rule-based explanations per audience, lexical and numeric checks, repair loop | Arabic and Tamil output |
| PDF and JSON receipts, exports, share links, review, edits | Photo reading by the model (`LLM_VISION=true`) |
| | Neural voices (`TTS_BASE_URL`, optional) |

Preview Mode is labelled everywhere it appears. Its receipts state **"Semantic verification not performed"**, and it refuses Arabic and Tamil rather than mislabel English text.

## Run it

Requires Node 20.18 or newer.

```bash
npm install
```

```bash
npx playwright install chromium
```

Chromium renders the PDF receipts. Then:

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000. For development, use `npm run dev` instead of `build` and `start`.

### Connect the model on AMD Developer Cloud

1. Create an MI300X GPU droplet. On the droplet, run:

   ```bash
   VLLM_API_KEY=$(openssl rand -hex 24) ./deploy/amd-vllm.sh
   ```

   This serves `Qwen/Qwen2.5-32B-Instruct` with vLLM on ROCm. Use `MODEL=...` to change the model. A multimodal model such as `google/gemma-3-27b-it` (needs `HF_TOKEN`) also lets the model read photos. Check the image tag and vLLM version on your droplet, because both change between releases.
2. Copy `.env.example` to `.env`, then set `LLM_BASE_URL=http://<droplet-ip>:8000/v1` and set `LLM_API_KEY` to the same key.
3. Restart. The sidebar badge switches from *Preview Mode* to the AMD hardware label.

Restrict port 8000 with the droplet firewall. The key never reaches the browser.

### Optional: neural voice

Point `TTS_BASE_URL` at any OpenAI-compatible `/v1/audio/speech` service, for example Kokoro-FastAPI on the same droplet. Set `TTS_LANGUAGES` to the languages it really speaks. Everything else falls back to the browser's voices, labelled "Browser voice". When no voice exists for a language, the player says so.

### Docker

```bash
docker compose up --build
```

The image is based on the Playwright image, so Chromium is included, and it adds Noto fonts for Arabic and Tamil in PDF receipts. Data persists in the `plainproof-data` volume.

## How it works

```
Upload → text extraction (PDF text layer / OCR / DOCX / TXT) → normalisation
  → Extractor: atomic claims, each with type, criticality, values, exact source quote, paragraph
  → Writer: audience-aware explanation (and translation), every list item tagged with its claim ids
  → Verifier (independent agent) + Invention Detector, in parallel batches on the GPU
  → Guards: quotes, numbers and dates matched mechanically; protected terms enforced
  → Repairer: fixes only the flagged problems → verify again (configurable limit)
  → best round issued with a ProofPass receipt
```

| Layer | Where |
| --- | --- |
| Engine: prompts, client, guards, assessment, receipts | `src/lib/engine/` |
| Server: storage (SQLite), parsing, OCR, exports, rate limiting | `src/lib/server/` |
| API routes | `src/app/api/` |
| Screens | `src/app/`, `src/components/` |

Model answers must match strict JSON schemas (vLLM structured outputs, validated again with zod). The client retries 429 and 5xx responses, honours `Retry-After`, times out, and asks once for valid JSON before failing. Document text is always passed to the models as tagged, untrusted data: every system prompt tells the agent to ignore instructions found inside it, and delimiter tags in the document are neutralised.

### Findings, not percentages

Each fact gets one of five findings: **Matched**, **Needs review**, **Potential mismatch**, **Missing** or **Not verified**. A "preserved" verdict is only trusted if the verifier's quote exists in the text and every number and date of the fact is present. Otherwise the finding becomes *Needs review*.

Each version gets an outcome:
- **Issues found**: any critical fact not confirmed, any potential mismatch or missing fact, an unsupported statement that could change what the reader does, or a changed protected term.
- **Needs review**: anything uncertain.
- **No issues found**: none of the above.

No accuracy percentage is shown anywhere.

## The five signature features

| Feature | What it does |
| --- | --- |
| **MeaningLock** | Facts extracted before rewriting. Click any fact in the explanation and its passage lights up in the original (¶ numbers), with the extracted fact, the adapted statement, the finding and the reason. Reviewers can mark findings as reviewed, with a note. The repair loop is visible round by round. |
| **AudienceDNA** | Six profiles: Everyday reader, Teen, Senior, Child, Dyslexia-friendly and Language learner. Each changes vocabulary, sentence length, structure and depth. |
| **ActionLens** | Tasks, payments, deadlines and warnings, each linked to claims and source paragraphs. Items the explanation lists but that cannot be linked to the original are not shown as actions. Completion is saved, and the list can be filtered, copied and exported. |
| **VoiceSync** | Plays the actual explanation: play, pause, resume and stop, speed, voice choice, sentence highlighting with auto-scroll, and progress you can click to jump. Uses a neural voice where configured, otherwise the browser's voices. |
| **ProofPass** | Receipt as PDF or JSON. Includes document ID, timestamp, filename, audience, language, fact counts, findings, unresolved issues, repair attempts, models and hardware, human-review status, hashes, cost and limitations. |

Plus **Understanding Compare**, which shows two audiences side by side with the same facts linked in both and in the original. Also included:
- reader view (Lexend or Atkinson Hyperlegible, size, spacing, line focus)
- light and dark themes
- reduced motion
- keyboard shortcuts (press `?`)
- human edit and re-verify
- share links
- an accessible HTML package and plain-text export
- a print view

## Testing

```bash
npm test
```

49 unit and API tests (Vitest), covering:
- PDF, DOCX, TXT and pasted text
- OCR of a photo and of a scanned PDF
- invalid, renamed, empty, oversized and over-long files
- unsafe filenames
- changed dates and amounts, missing warnings, unsupported statements
- the repair-loop limit, action extraction, and receipt generation (JSON and PDF)
- review, human edits, share links, search and delete
- rate limiting and prompt-injection handling
- the HTTP model client against a mock server: structured-output fallback, retries, timeouts and streaming

```bash
npm run test:e2e
```

9 Playwright tests against a production build, covering:
- the full flow from PDF upload to ProofPass download, including the injected error being caught and repaired, MeaningLock, ActionLens persistence, VoiceSync controls and Compare
- reviewer edits being flagged
- error recovery
- OCR
- all six audiences
- theme persistence
- phone layout without horizontal scrolling
- share pages
- security headers

**Not covered by automated tests:**
- **Real model output and semantic verification.** These need the AMD endpoint. The HTTP client is tested against a mock server.
- **Arabic and Tamil quality.** These also need the model.
- **Real audio and the neural voice path.** Headless Chromium has no voices, so the test installs a stand-in speech engine.
- **The Docker image.** It was not built during development.

## Security and privacy

- Uploaded files are checked by their content (magic bytes), not their extension. They are parsed in memory and never stored. Only the extracted text is kept.
- File names are sanitised. Size and length limits return clear errors.
- Documents are deleted automatically after `RETENTION_HOURS`. Users can delete one document or everything.
- Document text is never logged.
- Every API route is rate-limited per client.
- Security headers are sent: CSP with `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
- React escapes all document text. Exports escape HTML.
- No compliance certification (HIPAA, GDPR or other) is claimed.

## API

`POST /api/v1/adapt` runs the whole pipeline in one stateless call:

```bash
curl -s http://localhost:3000/api/v1/adapt -H "content-type: application/json" -d '{"text":"Your premium will increase from EUR 84.00 to EUR 92.40 from 1 January 2027. You must reply by 25 October 2026.","profiles":[{"id":"senior"}],"language":"en"}'
```

Other endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/documents` | multipart upload, `{text}` or `{sample}` |
| `POST /api/documents/:id/run` | server-sent events for a run |
| `GET /api/versions/:id/receipt?format=json\|pdf\|html` | the ProofPass receipt |
| `GET /api/versions/:id/export?format=txt\|html` | the explanation |
| `POST /api/versions/:id/verify` | verify a human edit |
| `POST /api/versions/:id/share` | create a share link |
| `GET /api/health` | engine and configuration status |

## Samples

`samples/` holds four fictional documents in TXT, PDF and DOCX, plus a photo and a scanned PDF of the insurance letter. Regenerate them with `npm run samples`. The insurance policy update contains a deadline, amounts, percentages, an exception, a warning and required actions, which makes it the demo document. The insurer, the municipality, the medicine and the school are invented.

MIT licensed.
