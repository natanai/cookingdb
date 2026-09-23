import { expect } from '@playwright/test';

function normalizeLabel(text) {
  return String(text || '')
    .replace(/[▾▸›⌄]+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function closedDisclosureName(locator) {
  await expect(locator).toBeAttached({ timeout: 2500 });
  return locator.evaluate((element) => {
    let child = element;
    let ancestor = element.parentElement;

    while (ancestor) {
      if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
        const summary = Array.from(ancestor.children).find((candidate) => candidate.tagName === 'SUMMARY');
        const targetIsItsSummary = summary && (summary === child || summary.contains(child));
        if (!targetIsItsSummary) {
          return (summary?.textContent || 'unnamed disclosure').replace(/\s+/g, ' ').trim();
        }
      }
      child = ancestor;
      ancestor = ancestor.parentElement;
    }

    return null;
  });
}

export async function userClick(locator, label = 'control') {
  const blockedBy = await closedDisclosureName(locator);
  if (blockedBy) {
    throw new Error(
      `${label} is not user-reachable because it is inside the closed disclosure “${blockedBy}”. ` +
        'Open the disclosure explicitly in the journey before interacting with this control.'
    );
  }

  await expect(locator, `${label} must be visible before a user click`).toBeVisible({ timeout: 2500 });
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, `${label} must be inside the viewport before a user click`).toBeInViewport({ timeout: 2500 });
  await locator.click();
}

export async function openDetails(page, summaryText) {
  const wanted = normalizeLabel(summaryText);
  const summaries = page.locator('summary');
  const count = await summaries.count();
  const matches = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = summaries.nth(index);
    if (normalizeLabel(await candidate.textContent()) === wanted) matches.push(candidate);
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one disclosure summary named “${summaryText}”, but found ${matches.length}. ` +
        'Use a more specific user-facing summary label before continuing.'
    );
  }

  const summary = matches[0];
  const details = summary.locator('..');
  const alreadyOpen = await details.evaluate((element) => Boolean(element.open));

  if (!alreadyOpen) {
    await userClick(summary, `disclosure “${summaryText}”`);
  }

  await expect(details, `disclosure “${summaryText}” should be open after the user action`).toHaveAttribute('open', '');
  return details;
}
