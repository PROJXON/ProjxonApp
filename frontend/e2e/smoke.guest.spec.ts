import { test, expect } from '@playwright/test';

test('guest loads and can open sign-in modal', async ({ page }) => {
  await page.goto('/');

  // Dismiss onboarding/about if present.
  // Note: these buttons use `aria-label`, so the accessible name is NOT the inner text.
  const dismissAbout = page.getByLabel('Dismiss about', { exact: true });

  // The about modal may appear a moment after first paint; wait briefly for it, then dismiss.
  const aboutVisible = await dismissAbout
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (aboutVisible) {
    await dismissAbout.click();
    await dismissAbout.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  // Use the primary CTA after onboarding.
  const signInToChat = page.getByLabel('Sign in to chat', { exact: true });
  await expect(signInToChat).toBeVisible();
  await signInToChat.click();

  // Assert the modal opened by checking for a known label.
  await expect(page.getByText('Sign In to Start the Conversation!', { exact: true })).toBeVisible();
});
