# Submission notes: AMD Developer Hackathon ACT III

## Form copy

**Title:** PlainProof

**Short description:** Complex information, clear understanding, every important detail accounted for. PlainProof explains documents to each reader and shows the evidence that nothing important was lost.

**Long description:**
Healthcare notices, insurance updates, tax letters and school forms are hard to read. Summaries make them shorter, but they silently drop deadlines, change amounts and lose exceptions.

PlainProof is an intelligent document experience platform. It reads a PDF, Word file, scan or photo, then:
- extracts every important fact: dates, amounts, percentages, warnings, exceptions and required actions
- explains the document for the person reading it, in English, Arabic or Tamil
- has an independent verifier check every fact against the original

Problems go back to a repair step until they are fixed or flagged for a person. Readers get:
- **MeaningLock:** click any fact to see its source passage
- **ActionLens:** a checklist of tasks and deadlines linked to the original
- **VoiceSync:** narration with sentence highlighting
- **Understanding Compare:** two audiences side by side, with the same facts linked in both
- **ProofPass:** a receipt that records what was checked, what was flagged and whether a person has reviewed it

All AI work runs on an open model served by vLLM on AMD Developer Cloud (Instinct MI300X, ROCm). Every model call is metered, so each explanation carries its token and GPU-time cost.

**Tags:** AMD Developer Cloud, ROCm, vLLM, MI300X, accessibility, multi-agent, verification, document AI, Arabic, Tamil

## Demo script (about 3 minutes)

1. Open the landing page. Upload `samples/insurance.pdf`. Point out the extraction status and the text preview.
2. Keep Teen and Senior selected. Under Advanced, tick *Demo: inject a test error*. Generate.
3. While it streams: facts are extracted, the Teen explanation writes itself in, and the checks run.
4. Click the **Draft** round chip. The injected amount or date shows as a red *Potential mismatch*, with original and adapted values quoted. Click the repair round: fixed.
5. Switch to **Senior**. Point out the numbered steps, headings and warnings first, then click a deadline to show it lit up in the original paragraph.
6. Open **MeaningLock**, select a fact, and mark a finding as reviewed.
7. Open **ActionLens**: deadline chips, paragraph links, tick a task.
8. Press **Space** for VoiceSync and show sentence highlighting.
9. Open **Compare**, click a deadline chip, and show it highlighted in both versions.
10. Open **ProofPass** and download the PDF receipt. Close with: "Different explanations. Shared evidence."

Record the video with the AMD endpoint connected, so the badge shows the hardware and receipts show semantic verification.

## Before submitting

- [ ] Run the demo once with the real model and note real cost per explanation from ProofPass.
- [ ] Try Arabic and Tamil with the model and check RTL and Tamil rendering.
- [ ] Set `GPU_HOURLY_USD` to your actual rate.
- [ ] Public GitHub repo, with `.env` not committed. Host the app and add the URL.
- [ ] Cover image, slides, video.
