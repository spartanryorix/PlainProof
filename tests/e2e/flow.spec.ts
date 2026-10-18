import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixtures = path.resolve(__dirname, '../fixtures');

// Headless Chromium ships without speech voices, so install a small speech engine that behaves
// like the browser's: it lets the VoiceSync controls be tested for real.
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const voices = [{ name: 'Test English', lang: 'en-US', default: true, localService: true, voiceURI: 'test-en' }];
    const spoken: string[] = [];
    let current: { onstart?: () => void; onend?: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let paused = false;
    const synth = {
      speaking: false,
      paused: false,
      pending: false,
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
      speak(u: { text: string; onstart?: () => void; onend?: () => void }) {
        current = u;
        spoken.push(u.text);
        u.onstart?.();
        timer = setTimeout(() => !paused && u.onend?.(), 250);
      },
      cancel() {
        if (timer) clearTimeout(timer);
        current = null;
      },
      pause() {
        paused = true;
        if (timer) clearTimeout(timer);
      },
      resume() {
        paused = false;
        const u = current;
        timer = setTimeout(() => u?.onend?.(), 250);
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      lang = '';
      voice: unknown = null;
      rate = 1;
      pitch = 1;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    };
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
  });
}

test.describe.configure({ mode: 'serial' });

test('full flow: upload, personalize, understand, verify, listen, export', async ({ page }) => {
  await fakeSpeech(page);
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'Add a document' })).toBeVisible();

  // Upload a real PDF.
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'insurance.pdf'));
  await expect(page.getByText('Text extracted: PDF text layer')).toBeVisible();
  await expect(page.getByText(/25 October 2026/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Personalize: Teen and Senior are preselected; add the demo fault.
  await expect(page.getByRole('heading', { name: 'Personalize' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Teen/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /Senior/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('option[value="ar"]')).toBeDisabled();
  await page.getByText('Advanced: protected terms').click();
  await page.getByLabel('Demo: inject a test error into the first draft').check();
  await page.getByRole('button', { name: 'Generate 2 explanations' }).click();

  // Understand: the studio streams, verifies and finishes both audiences.
  await expect(page).toHaveURL(/\/d\//);
  await expect(page.getByRole('tab', { name: 'Teen' })).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText(/No issues found|Needs review|Issues found/, { timeout: 60_000 });
  await expect(page.locator('[role=tab] .animate-spin')).toHaveCount(0, { timeout: 90_000 });
  const explanation = page.locator('[data-pane=explanation]');
  await expect(explanation.getByText('What you need to do', { exact: true })).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText('lexical check');

  // The injected error was caught in the first draft and the repair round is recorded.
  await expect(page.getByRole('button', { name: 'Draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Repair 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Draft' }).click();
  await expect(page.getByText('Test error injected.')).toBeVisible();
  await expect(page.getByTestId('outcome')).toContainText('Issues found');
  await page.getByRole('button', { name: /Repair/ }).last().click();

  // Clicking a fact in the explanation highlights its passage in the original.
  await explanation.locator('.mark[data-claims]').first().click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.locator('[data-pane=original] .mark.is-selected').first()).toBeVisible();

  // MeaningLock: evidence and review.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'MeaningLock' }).click();
  await expect(page.getByRole('heading', { name: 'MeaningLock' })).toBeVisible();
  await page.locator('ul[aria-label=Facts] li button').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Extracted fact');
  await expect(page.getByTestId('inspector')).toContainText('In the explanation');

  // ActionLens: real deadline, linked evidence, completion persists.
  await page.getByRole('button', { name: 'ActionLens' }).click();
  await expect(page.getByRole('heading', { name: 'ActionLens' })).toBeVisible();
  await expect(page.getByText('25 October 2026').first()).toBeVisible();
  const first = page.getByRole('checkbox', { name: /Mark ".*" as done/ }).first();
  await first.check();
  await expect(page.getByText(/1 of \d+ done/)).toBeVisible();
  await page.getByRole('radio', { name: 'Outstanding' }).click();
  await page.getByRole('radio', { name: 'All' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export checklist' }).click();
  expect(fs.readFileSync(await (await download).path(), 'utf8')).toMatch(/\[x\] /);
  await page.reload();
  await page.getByRole('button', { name: 'ActionLens' }).click();
  await expect(page.getByText(/1 of \d+ done/)).toBeVisible();

  // VoiceSync: play, pause, resume, stop, with the current sentence highlighted.
  await page.getByRole('button', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Listen with VoiceSync' }).click();
  const player = page.getByRole('region', { name: 'VoiceSync player' });
  await expect(player).toContainText('Browser voice · Test English');
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('[data-pane=explanation] .is-speaking').first()).toBeVisible();
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await player.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(player).toContainText(/[2-9] \/ \d+/);
  await player.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken[0]).toMatch(/explained/);

  // Compare: the same facts linked in both audiences.
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByText(/\d+ facts linked in both versions/)).toBeVisible();
  await page.locator('button[aria-pressed]').filter({ hasText: 'deadline' }).first().click();
  await expect(page.locator('[data-pane=compare-0] .mark.is-selected').first()).toBeVisible();
  await expect(page.locator('[data-pane=compare-1] .mark.is-selected').first()).toBeVisible();

  // ProofPass: receipt in PDF and JSON.
  await page.getByRole('button', { name: 'ProofPass' }).click();
  await expect(page.getByText('ProofPass · Fidelity Receipt')).toBeVisible();
  await expect(page.getByText('Semantic verification not performed', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Not reviewed by a person').first()).toBeVisible();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF receipt' }).click();
  const pdf = fs.readFileSync(await (await pdfDownload).path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON' }).click();
  const receipt = JSON.parse(fs.readFileSync(await (await jsonDownload).path(), 'utf8'));
  expect(receipt.document.filename).toBe('insurance.pdf');
  expect(receipt.faultInjection).not.toBeNull();
  expect(receipt.repairAttempts).toBeGreaterThanOrEqual(1);
});

test('a reviewer edit that changes an amount is flagged', async ({ page }) => {
  await page.goto('/library');
  await page.locator('ul li a').first().click();
  await expect(page.locator('[role=tab] .animate-spin')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit and re-verify' }).click();
  const box = page.getByLabel('Explanation text');
  const text = await box.inputValue();
  await box.fill(text.replaceAll('EUR 92.40', 'EUR 29.40').replaceAll('25 October 2026', '25 November 2026'));
  await page.getByRole('button', { name: 'Verify my edit' }).click();
  await expect(page.getByTestId('outcome')).toContainText('Issues found');
  await expect(page.getByRole('button', { name: 'Your edit' })).toBeVisible();
  await page.getByRole('button', { name: 'MeaningLock' }).click();
  await page.getByRole('radio', { name: /Issues/ }).click();
  await expect(page.getByText('Potential mismatch').first()).toBeVisible();
  await page.locator('ul[aria-label=Facts] li button').first().click();
  await page.getByTestId('inspector').getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByTestId('inspector')).toContainText('Reviewed');
});

test('invalid files are rejected and the user can recover', async ({ page }) => {
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'program.exe'));
  await expect(page.getByRole('alert').filter({ hasText: 'could not be used' })).toContainText('not supported');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'empty.txt'));
  await expect(page.getByRole('alert').filter({ hasText: 'could not be used' })).toContainText('empty');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'insurance.docx'));
  await expect(page.getByText('Text extracted: Word document (.docx)')).toBeVisible();
});

test('a photo of a letter is read with OCR', async ({ page }) => {
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(path.join(fixtures, 'insurance-scan.png'));
  await expect(page.getByText(/Text extracted: Image, read with OCR/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/recognition errors/).first()).toBeVisible();
});

test('pasted text works, and every audience profile can be generated', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('radio', { name: 'Paste text' }).click();
  await page.getByLabel('Document text').fill(fs.readFileSync(path.join(fixtures, 'insurance.txt'), 'utf8'));
  await page.getByRole('button', { name: 'Use this text' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  for (const name of ['Everyday reader', 'Child', 'Dyslexia-friendly', 'Language learner']) await page.getByRole('checkbox', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Generate 6 explanations' }).click();
  await expect(page.getByRole('tab')).toHaveCount(6);
  await expect(page.locator('[role=tab] .animate-spin')).toHaveCount(0, { timeout: 90_000 });
  const texts = new Set<string>();
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    texts.add(await page.locator('[data-pane=explanation]').innerText());
  }
  expect(texts.size).toBe(6);
});

test('theme switching persists', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('t');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('layouts fit a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ['/', '/new', '/library', '/settings']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
  await page.goto('/library');
  await page.locator('ul li a').first().click();
  await expect(page.getByRole('radio', { name: 'Explanation' })).toBeVisible();
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.locator('[data-pane=original]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('share link opens a clean reader page', async ({ page, request }) => {
  await page.goto('/library');
  await page.locator('ul li a').first().click();
  await page.getByRole('button', { name: 'ProofPass' }).click();
  await page.getByRole('button', { name: 'Create share link' }).click();
  await expect(page.getByText(/Share link (copied|created)/)).toBeVisible();
  const url = (await page.getByText(/Share link (copied|created)/).innerText()).match(/https?:\/\/\S+/)![0];
  await page.goto(url);
  await expect(page.getByText(/facts from the original matched/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen' })).toBeVisible();
  expect((await request.get('/s/doesnotexist123')).status()).toBe(404);
});

test('security headers are sent', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
