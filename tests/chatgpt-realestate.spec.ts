import { test, expect } from '@playwright/test';

const CONNECTOR_URL =
  'https://chatgpt.com/#settings/Connectors?connector=connector_699dc10d76dc819193da8a6d9538da9e';

async function ensureLoggedIn(page: any) {
  // Heuristic: if we can see a message box, we're good.
  const box = page.getByRole('textbox');
  await expect(box.first()).toBeVisible({ timeout: 60_000 });
}

async function clickRefreshOnConnectorPage(page: any) {
  await page.goto(CONNECTOR_URL, { waitUntil: 'domcontentloaded' });

  const refreshBtn = page.getByRole('button', { name: /새로\s*고침|새로고침|Refresh/i });
  await expect(refreshBtn).toBeVisible({ timeout: 60_000 });
  await refreshBtn.click();

  // Best-effort: wait for any toast/spinner to settle.
  await page.waitForTimeout(1500);
}

async function startNewChat(page: any) {
  // ChatGPT UI changes often; we try a few common patterns.
  const candidates = [
    page.getByRole('link', { name: /새\s*채팅|New chat/i }),
    page.getByRole('button', { name: /새\s*채팅|New chat/i }),
  ];
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await c.first().click();
      await page.waitForTimeout(800);
      return;
    }
  }
  // If no button found, just proceed; typing in the box often works.
}

async function addGptAppBySlashCommand(page: any, appCommand = '/realestate') {
  const box = page.getByRole('textbox').first();
  await box.click();
  await box.fill(appCommand);
  await page.keyboard.press('Enter');

  // Some UIs show a picker after pressing enter; try selecting the app if it appears.
  const option = page.getByRole('option', { name: /realestate|부동산/i });
  if (await option.first().isVisible().catch(() => false)) {
    await option.first().click();
  }

  await page.waitForTimeout(800);
}

async function sendPrompt(page: any, prompt: string) {
  const box = page.getByRole('textbox').first();
  await box.click();
  await box.fill(prompt);
  await page.keyboard.press('Enter');
}

async function waitForAssistantAnswer(page: any) {
  // Wait for at least one assistant message to appear after sending.
  const assistant = page.locator('[data-message-author-role="assistant"]');
  await expect(assistant.first()).toBeVisible({ timeout: 120_000 });

  // Then wait for streaming to stop (best-effort).
  await page.waitForTimeout(2000);
  const last = assistant.last();
  await expect(last).toBeVisible();
  return (await last.innerText()).trim();
}

test('ChatGPT: realestate GPT app end-to-end sanity check', async ({ page }) => {
  // 3) https://chatgpt.com 접속
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page);

  // 4) Connector settings -> 새로 고침
  await clickRefreshOnConnectorPage(page);

  // Back to main chat
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await ensureLoggedIn(page);
  await startNewChat(page);

  // 5) /realestate 입력하여 앱 추가
  await addGptAppBySlashCommand(page, '/realestate');

  // 6) 사용자 명령 입력
  const userQuery = '신분당선 라인에서 보도 10분 거리에 있는 30평 15억 이하 매물 찾아줘';
  await sendPrompt(page, userQuery);
  const answer = await waitForAssistantAnswer(page);

  // 7) 결과가 잘 나오는지 LLM이 판단 (self-critique prompt)
  const judgePrompt =
    '방금 답변이 다음 조건을 충족하는지 판단해줘.\n' +
    '- 신분당선 라인\n- 보도 10분 이내\n- 30평\n- 15억 이하\n\n' +
    '체크리스트로 간단히 확인하고 마지막 줄에 PASS 또는 FAIL만 적어줘.';
  await sendPrompt(page, judgePrompt);
  const judge = await waitForAssistantAnswer(page);

  // Keep artifacts readable in CI logs
  console.log('\n=== Model answer ===\n', answer);
  console.log('\n=== Judge ===\n', judge);

  expect(judge.toUpperCase()).toContain('PASS');
});
