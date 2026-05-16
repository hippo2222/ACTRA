const path = require("path");
const { chromium } = require("playwright");

const {
  FIXTURE,
  parseArgs,
  pingBaseUrl,
  ensureSmokeFixture,
  ensureComplexImportArchiveFixture,
  ensureEditorArchiveTaskFixture,
  cancelActiveSessionsForComplex,
  selectUser,
  createUser,
  deleteUser,
  deleteComplex,
  deleteEditorTask,
  getEditorTask,
  createRunArtifacts,
  writeRunSummary,
  resolveUrl,
} = require("./browser_smoke_helpers");

async function waitForVisible(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { state: "visible", timeout });
}

async function waitForEnabled(page, selector, timeout = 20000) {
  await page.waitForFunction(
    (targetSelector) => {
      const element = document.querySelector(targetSelector);
      return !!element && !element.disabled;
    },
    selector,
    { timeout }
  );
}

async function answerSingleSmokeQuestion(page) {
  const answerOption = page
    .locator("label")
    .filter({ hasText: FIXTURE.correctAnswerText })
    .first();
  await answerOption.waitFor({ state: "visible", timeout: 20000 });
  await answerOption.click();
  await waitForEnabled(page, "#check-answer-btn", 10000);
}

async function finishSmokeSessionFromS1(page) {
  await answerSingleSmokeQuestion(page);
  await page.click("#check-answer-btn");
  await waitForVisible(page, "#result-box", 20000);
  await waitForEnabled(page, "#next-task-btn", 20000);
  await page.click("#next-task-btn");
  await page.waitForURL(/\/ui\/session\/[^/]+\/results(?:[?#]|$)/, {
    timeout: 30000,
  });
  await waitForVisible(page, "#results-title", 20000);
}

async function goToComplexesFromMain(page, baseUrl) {
  await page.goto(resolveUrl(baseUrl, "/main"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, "#app-content", 20000);
  await page.locator('[data-nav="/complexes"]').first().click();
  await page.waitForURL(/\/ui\/complexes(?:[?#]|$)/, { timeout: 30000 });
  await waitForVisible(page, `button.start-btn[data-complex-id="${FIXTURE.complexId}"]`, 20000);
}

function assertTextIncludes(actual, expected, context) {
  if (!String(actual || "").includes(expected)) {
    throw new Error(`${context}: expected to include "${expected}", got "${actual || ""}"`);
  }
}

function extractSessionIdFromUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.length ? String(segments[segments.length - 1] || "").trim() : "";
}

async function waitForComplexesTheoryFilter(page, theoryId, timeout = 30000) {
  await page.waitForFunction(
    (expectedTheoryId) => {
      const url = new URL(window.location.href);
      return (
        url.pathname.startsWith("/complexes") &&
        url.searchParams.get("theory_id") === expectedTheoryId
      );
    },
    theoryId,
    { timeout }
  );
}

async function waitForTheoryEditorUrl(page, theoryId, timeout = 30000) {
  await page.waitForFunction(
    (expectedTheoryId) => {
      const url = new URL(window.location.href);
      return (
        url.pathname === "/editor/Theory_Editor.html" &&
        url.searchParams.get("theory_id") === expectedTheoryId
      );
    },
    theoryId,
    { timeout }
  );
}

async function waitForTheme(page, themeId, timeout = 15000) {
  await page.waitForFunction(
    (expectedThemeId) => {
      const root = document.documentElement;
      const localTheme = window.localStorage.getItem("app-theme");
      return (
        root &&
        root.getAttribute("data-theme") === expectedThemeId &&
        localTheme === expectedThemeId
      );
    },
    themeId,
    { timeout }
  );
}

async function waitForCalendarRecommendations(page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const dailyMixCard = document.getElementById("daily-mix-card");
      const mainFocusCard = document.getElementById("main-focus-card");
      const dailyMixCountText = (document.getElementById("daily-mix-count") || {})
        .textContent;
      const mainFocusCountText = (document.getElementById("main-focus-count") || {})
        .textContent;
      const dailyMixCount = Number.parseInt(String(dailyMixCountText || "0"), 10) || 0;
      const mainFocusCount = Number.parseInt(String(mainFocusCountText || "0"), 10) || 0;
      const dailyMixResolved =
        dailyMixCount > 0 ||
        Boolean(dailyMixCard && dailyMixCard.classList.contains("cursor-default"));
      const mainFocusResolved =
        mainFocusCount > 0 ||
        Boolean(mainFocusCard && mainFocusCard.classList.contains("cursor-default"));
      return dailyMixResolved && mainFocusResolved;
    },
    null,
    { timeout }
  );
}

async function setTheme(page, themeId, timeout = 20000) {
  await waitForVisible(page, "#theme-switcher-container", timeout);
  await page.click("#theme-switcher-container > button");
  await waitForVisible(page, "#theme-switcher-menu", timeout);
  await page.click(`#theme-switcher-menu button[data-theme-id="${themeId}"]`);
  await waitForTheme(page, themeId, timeout);
}

async function openTopicTheoryModal(page, baseUrl, fixture) {
  await page.goto(resolveUrl(baseUrl, "/editor"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const moduleSelector = `[data-module-button="${fixture.moduleId}"]`;
  const topicSelector = `[data-topic-button="${fixture.topicId}"][data-topic-module="${fixture.moduleId}"]`;
  const actionSelector = `[data-role="topic-theory-open"][data-module-id="${fixture.moduleId}"][data-topic-id="${fixture.topicId}"]`;

  await waitForVisible(page, moduleSelector, 30000);
  const topicVisible = await page
    .locator(topicSelector)
    .first()
    .isVisible()
    .catch(() => false);
  if (!topicVisible) {
    await page.click(moduleSelector);
  }

  await waitForVisible(page, topicSelector, 20000);
  const topicButton = page.locator(topicSelector).first();
  await topicButton.hover();

  const theoryAction = page.locator(actionSelector).first();
  await theoryAction.waitFor({ state: "visible", timeout: 10000 });
  await theoryAction.click();

  await waitForVisible(page, "#topic-theory-modal", 20000);
  await page.waitForFunction(
    (expectedTheoryId) => {
      const picker = document.getElementById("topic-theory-picker");
      return !!picker && String(picker.value || "").trim() === expectedTheoryId;
    },
    fixture.theoryId,
    { timeout: 20000 }
  );
  await waitForVisible(page, "#topic-theory-open-complexes-btn", 10000);
  await waitForVisible(page, "#topic-theory-edit-content-btn", 10000);
}

async function waitForEditorTaskCard(page, uniqueId, timeout = 30000) {
  await page.waitForFunction(
    (expectedUniqueId) => {
      const card = document.querySelector(`article[data-task-id="${expectedUniqueId}"]`);
      return !!card && !card.hidden;
    },
    uniqueId,
    { timeout }
  );
}

async function openComplexTheoryModal(page, baseUrl, fixture, options = {}) {
  const initialPath = options.filtered
    ? `/complexes?theory_id=${encodeURIComponent(fixture.theoryId)}`
    : "/complexes";
  await page.goto(resolveUrl(baseUrl, initialPath), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  const cardSelector = `[data-complex-card-id="${fixture.complexId}"]`;
  await waitForVisible(page, cardSelector, 30000);
  const theoryButton = page
    .locator(
      `${cardSelector} button.theory-btn[data-theory-id="${fixture.theoryId}"]`
    )
    .first();
  await theoryButton.waitFor({ state: "visible", timeout: 20000 });
  await theoryButton.click();

  await waitForVisible(page, "#tm-open-complexes", 20000);
  await waitForVisible(page, "#tm-open-hub", 20000);
  await page.waitForFunction(
    ({ theoryTitle, theoryId }) => {
      const modalButton = document.querySelector(".theory-modal-open-complexes");
      if (!modalButton) return false;
      const modalRoot = modalButton.closest(".bg-surface-1");
      const text = modalRoot ? modalRoot.textContent || "" : "";
      return text.includes(theoryTitle) || text.includes(theoryId);
    },
    {
      theoryTitle: fixture.theoryTitle,
      theoryId: fixture.theoryId,
    },
    { timeout: 10000 }
  );
}

async function waitForBuilderTheoryContext(page, fixture, timeout = 30000) {
  await waitForVisible(page, "#save-btn", timeout);
  await page.waitForFunction(
    ({ theoryId, theoryTitle }) => {
      const row = document.getElementById("theory-context-actions-row");
      const meta = document.getElementById("theory-context-actions-meta");
      const openHubBtn = document.getElementById("theory-open-hub-btn");
      const openComplexesBtn = document.getElementById("theory-open-complexes-btn");
      if (!row || row.classList.contains("hidden")) return false;
      if (!meta || !openHubBtn || !openComplexesBtn) return false;
      if (openHubBtn.disabled || openComplexesBtn.disabled) return false;
      const text = meta.textContent || "";
      return text.includes(theoryTitle) || text.includes(theoryId);
    },
    {
      theoryId: fixture.theoryId,
      theoryTitle: fixture.theoryTitle,
    },
    { timeout }
  );
}

async function scenarioWelcomeToMain({ page, baseUrl, fixture }) {
  await page.goto(resolveUrl(baseUrl, "/welcome"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(2000);
  try {
    await page.waitForURL(/\/ui(?:\/main)?(?:[?#]|$)/, { timeout: 15000 });
  } catch (error) {
    const currentUrl = page.url();
    if (/\/ui(?:\/main)?(?:[?#]|$)/.test(currentUrl)) {
      // The transition completed after the explicit wait timed out.
    } else {
      const profileCard = page
        .locator("button.profile-card-v3")
        .filter({ hasText: fixture.userName })
        .first();

      if (await profileCard.isVisible().catch(() => false)) {
        await profileCard.click();
      } else {
        await page.waitForFunction(
          (userId) =>
            typeof window.welcomeSelectProfile === "function" &&
            !!userId,
          fixture.userId,
          { timeout: 20000 }
        );
        await page.evaluate((userId) => {
          window.welcomeSelectProfile(userId);
        }, fixture.userId);
      }

      await page.waitForURL(/\/ui\/main(?:[?#]|$)/, { timeout: 30000 });
    }
  }

  await waitForVisible(page, "#headerUserName", 20000);
  const headerName = await page.locator("#headerUserName").textContent();
  assertTextIncludes(headerName, fixture.userName, "welcome_to_main.header_user_name");
}

async function scenarioMainToComplexesToS1({ page, baseUrl, fixture }) {
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);
  await goToComplexesFromMain(page, baseUrl);

  const card = page.locator(`[data-complex-card-id="${fixture.complexId}"]`).first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  const cardText = await card.textContent();
  assertTextIncludes(cardText, fixture.complexName, "main_to_complexes_to_s1.complex_card");

  await page.click(`button.start-btn[data-complex-id="${fixture.complexId}"]`);
  await page.waitForURL(/\/ui\/session\/[^/]+(?:[?#]|$)/, { timeout: 30000 });
  await waitForVisible(page, "#check-answer-btn", 20000);
  await waitForVisible(page, "#theory-session-banner", 20000);
  const bannerText = await page.locator("#theory-session-banner").textContent();
  if (
    !String(bannerText || "").includes(fixture.theoryTitle) &&
    !String(bannerText || "").includes(fixture.theoryId)
  ) {
    throw new Error(
      `main_to_complexes_to_s1.theory_banner_missing: ${bannerText || "empty"}`
    );
  }
}

async function scenarioS1CoreSession({ page, baseUrl, fixture }) {
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);
  await page.goto(resolveUrl(baseUrl, "/complexes"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(
    page,
    `button.start-btn[data-complex-id="${fixture.complexId}"]`,
    20000
  );
  await page.click(`button.start-btn[data-complex-id="${fixture.complexId}"]`);
  await page.waitForURL(/\/ui\/session\/[^/]+(?:[?#]|$)/, { timeout: 30000 });

  await waitForVisible(page, "#progress-label", 20000);
  await waitForVisible(page, "#check-answer-btn", 20000);
  await waitForVisible(page, "#task-content", 20000);
  await waitForVisible(page, "#theory-session-banner", 20000);

  await page.waitForFunction(
    () => {
      const taskContent = document.getElementById("task-content");
      if (!taskContent) return false;
      const text = String(taskContent.textContent || "").toLowerCase();
      return (
        taskContent.children.length > 0 &&
        !text.includes("ошибка отображения задания") &&
        !text.includes("не поддерживается")
      );
    },
    null,
    { timeout: 20000 }
  );

  await answerSingleSmokeQuestion(page);
  await page.click("#check-answer-btn");
  await waitForVisible(page, "#result-box", 20000);
  await waitForEnabled(page, "#next-task-btn", 20000);
}

async function scenarioS3BasicResults({ page, baseUrl, fixture }) {
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);
  await page.goto(resolveUrl(baseUrl, "/complexes"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, `button.start-btn[data-complex-id="${fixture.complexId}"]`, 20000);
  await page.click(`button.start-btn[data-complex-id="${fixture.complexId}"]`);
  await page.waitForURL(/\/ui\/session\/[^/]+(?:[?#]|$)/, { timeout: 30000 });
  await waitForVisible(page, "#check-answer-btn", 20000);

  await finishSmokeSessionFromS1(page);

  await waitForVisible(page, "#to-main-btn", 10000);

}



async function scenarioTopicTheoryModalNavigation({ page, baseUrl, fixture }) {
  await openTopicTheoryModal(page, baseUrl, fixture);

  const modalText = await page.locator("#topic-theory-modal").textContent();
  if (
    !String(modalText || "").includes(fixture.theoryTitle) &&
    !String(modalText || "").includes(fixture.theoryId)
  ) {
    throw new Error("topic_theory_modal_navigation.modal_missing_theory_context");
  }

  await page.click("#topic-theory-open-complexes-btn");
  await waitForComplexesTheoryFilter(page, fixture.theoryId, 30000);
  await waitForVisible(page, "#complex-theory-banner", 20000);
  await waitForVisible(
    page,
    `[data-complex-card-id="${fixture.complexId}"]`,
    20000
  );

  await openTopicTheoryModal(page, baseUrl, fixture);
  await page.click("#topic-theory-edit-content-btn");
  await waitForTheoryEditorUrl(page, fixture.theoryId, 30000);
  await waitForVisible(page, "#theory-editor", 20000);
}

async function scenarioComplexesTheoryModalBuilderContext({
  page,
  baseUrl,
  fixture,
}) {
  await openComplexTheoryModal(page, baseUrl, fixture, { filtered: false });
  await page.click(".theory-modal-open-complexes");
  await waitForComplexesTheoryFilter(page, fixture.theoryId, 30000);
  await waitForVisible(page, "#complex-theory-banner", 20000);
  await waitForVisible(
    page,
    '.complex-filter-chip[data-filter="mine"]',
    10000
  );
  await waitForVisible(
    page,
    '.complex-filter-chip[data-filter="shared"]',
    10000
  );
  await waitForVisible(
    page,
    '.complex-filter-chip[data-filter="imported"]',
    10000
  );
  const complexCard = page.locator(`[data-complex-card-id="${fixture.complexId}"]`).first();
  const ownershipFilter = await complexCard.evaluate((node) => {
    if (node.getAttribute("data-complex-owned") === "true") return "mine";
    if (node.getAttribute("data-complex-imported") === "true") return "imported";
    return "shared";
  });
  await page.click(`.complex-filter-chip[data-filter="${ownershipFilter}"]`);
  await waitForVisible(
    page,
    `[data-complex-card-id="${fixture.complexId}"]`,
    10000
  );

  await openComplexTheoryModal(page, baseUrl, fixture, { filtered: false });
  await page.click("#tm-open-hub");
  await waitForTheoryEditorUrl(page, fixture.theoryId, 30000);
  await waitForVisible(page, "#theory-editor", 20000);

  await page.goto(
    resolveUrl(
      baseUrl,
      `/complexes/create?id=${encodeURIComponent(fixture.complexId)}`
    ),
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }
  );
  await waitForBuilderTheoryContext(page, fixture, 30000);
}

async function scenarioStatisticsTheoryFlow({ page, baseUrl, fixture }) {
  await page.goto(resolveUrl(baseUrl, "/statistics"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, "#theory-analytics-list", 30000);

  const theoryButton = page
    .locator(
      `[data-action="open-theory-hub"][data-theory-id="${fixture.theoryId}"]`
    )
    .first();
  await theoryButton.waitFor({ state: "visible", timeout: 30000 });

  const theoryListText = await page.locator("#theory-analytics-list").textContent();
  if (
    !String(theoryListText || "").includes(fixture.theoryTitle) &&
    !String(theoryListText || "").includes(fixture.theoryId)
  ) {
    throw new Error("statistics_theory_flow.theory_card_missing");
  }

  await theoryButton.click();
  await waitForTheoryEditorUrl(page, fixture.theoryId, 30000);
  await waitForVisible(page, "#theory-editor", 20000);
}

async function scenarioCalendarRecommendedAction({ page, baseUrl, fixture }) {
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);
  await page.goto(resolveUrl(baseUrl, "/calendar"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await waitForVisible(page, "#daily-mix-card", 30000);
  await waitForVisible(page, "#main-focus-card", 30000);
  await waitForVisible(page, "#schedule-strip", 30000);
  await waitForCalendarRecommendations(page, 20000);

  const dailyMixCountText = await page.locator("#daily-mix-count").textContent();
  const dailyMixCount = Number.parseInt(String(dailyMixCountText || "0"), 10) || 0;
  const mainFocusCardIsEmpty = await page.evaluate(() => {
    const card = document.getElementById("main-focus-card");
    return Boolean(card && card.classList.contains("cursor-default"));
  });
  const actionSelector =
    dailyMixCount > 0 || mainFocusCardIsEmpty
      ? "#daily-mix-card"
      : "#main-focus-card";
  await page.click(actionSelector);

  await page.waitForURL(/\/ui\/session\/[^/]+(?:[?#]|$)/, { timeout: 30000 });
  await waitForVisible(page, "#check-answer-btn", 20000);
  await waitForVisible(page, "#progress-label", 20000);
}

async function startFixtureSessionFromComplexes(page, baseUrl, fixture) {
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);
  await page.goto(resolveUrl(baseUrl, "/complexes"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(
    page,
    `button.start-btn[data-complex-id="${fixture.complexId}"]`,
    20000
  );
  await page.click(`button.start-btn[data-complex-id="${fixture.complexId}"]`);
  await page.waitForURL(/\/ui\/session\/[^/]+(?:[?#]|$)/, { timeout: 30000 });
  await waitForVisible(page, "#check-answer-btn", 20000);
  const sessionId = extractSessionIdFromUrl(page.url());
  if (!sessionId) {
    throw new Error("start_fixture_session.missing_session_id");
  }
  return sessionId;
}

async function scenarioMicrocardsBasicReview({ page, baseUrl, fixture }) {
  if (!fixture.microcards || !fixture.microcards.deckId) {
    throw new Error("microcards_basic_review.missing_fixture_deck");
  }

  await page.goto(resolveUrl(baseUrl, "/microcards"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await waitForVisible(page, "#mcViewDeckList", 30000);
  await waitForVisible(page, "#mcDeckGrid", 30000);
  await waitForVisible(
    page,
    '.mc-deck-ownership-chip[data-ownership-filter="mine"]',
    20000
  );

  const deckCard = page
    .locator("#mcDeckGrid > div")
    .filter({ hasText: fixture.microcardsDeckName })
    .first();
  await deckCard.waitFor({ state: "visible", timeout: 30000 });
  const ownershipFilter = await deckCard.evaluate((node) => {
    const text = String(node.textContent || "");
    if (text.includes("моё")) return "mine";
    if (text.includes("Импорт")) return "imported";
    return "shared";
  });
  await page.click(`.mc-deck-ownership-chip[data-ownership-filter="${ownershipFilter}"]`);
  await deckCard.waitFor({ state: "visible", timeout: 10000 });
  await deckCard.click();

  await waitForVisible(page, "#mcViewReview", 20000);
  await page.waitForFunction(
    () => {
      const revealBtn = document.getElementById("mcBtnReveal");
      const emptyState = document.getElementById("mcCardEmpty");
      return (
        (revealBtn && !revealBtn.classList.contains("hidden")) ||
        (emptyState && !emptyState.classList.contains("hidden"))
      );
    },
    null,
    { timeout: 20000 }
  );
  const revealVisible = await page.locator("#mcBtnReveal").isVisible().catch(() => false);
  if (!revealVisible) {
    const restartBtn = page
      .locator('#mcViewReview button[onclick="mcApp.restartSession()"]')
      .first();
    await restartBtn.waitFor({ state: "visible", timeout: 10000 });
    await restartBtn.click();
    await waitForVisible(page, "#mcBtnReveal", 20000);
  }
  await waitForVisible(page, "#mcCardContent", 20000);
  const frontText = await page.locator("#mcCardFront").textContent();
  assertTextIncludes(
    frontText,
    fixture.microcardsFrontText,
    "microcards_basic_review.front_text"
  );

  await page.click("#mcBtnReveal");
  await waitForVisible(page, "#mcActionsPostReveal", 10000);
  await waitForVisible(page, "#mcBtnGood", 10000);
  await page.click("#mcBtnGood");

  await waitForVisible(page, "#mcViewSummary", 20000);
  const summaryDeckName = await page.locator("#mcSummaryDeckName").textContent();
  assertTextIncludes(
    summaryDeckName,
    fixture.microcardsDeckName,
    "microcards_basic_review.summary_deck_name"
  );
}

async function scenarioMicrocardsEditorImportFlow({ page, baseUrl, fixture }) {
  if (!fixture.microcards || !fixture.microcards.deckId) {
    throw new Error("microcards_editor_import_flow.missing_fixture_deck");
  }

  const importFront = "Smoke import front";
  const importBack = "Smoke import back";

  await page.goto(resolveUrl(baseUrl, "/editor"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, "#editor-search-input", 30000);

  await page.evaluate(() => {
    window.dashboard.showTheoryAnalysisModal();
  });
  await page.waitForFunction(
    () =>
      !!window.dashboard?.importManager &&
      window.dashboard.importManager.modalPurpose === "theory_analysis" &&
      !document.getElementById("import-modal")?.classList.contains("hidden"),
    null,
    { timeout: 30000 }
  );

  await page.evaluate(async () => {
    await window.dashboard.importManager.openManualMicrocardsEditor();
  });
  await waitForVisible(page, "#m11DeckNameInput", 30000);
  await waitForVisible(page, "#m11WorkspaceNote", 20000);

  const workspaceNote = await page.locator("#m11WorkspaceNote").textContent();
  assertTextIncludes(
    workspaceNote,
    "общей библиотеке",
    "microcards_editor_import_flow.workspace_note"
  );

  const deckRow = page
    .locator(`[data-m11-deck-row="${fixture.microcards.deckId}"]`)
    .first();
  await deckRow.waitFor({ state: "visible", timeout: 30000 });
  await deckRow.click();

  await page.waitForFunction(
    (deckName) => {
      const modal = document.getElementById("import-modal");
      return (
        !!modal &&
        String(modal.textContent || "").includes(deckName) &&
        !!document.getElementById("m11WorkspaceNote")
      );
    },
    fixture.microcardsDeckName,
    { timeout: 30000 }
  );

  await page.evaluate(async () => {
    await window.dashboard.importManager.openMicrocardsTextImport();
  });
  await waitForVisible(page, "#mcImportTextArea", 30000);

  await page.fill(
    "#mcImportTextArea",
    `@MICROCARD\n# ${importFront}\n= ${importBack}\n`
  );
  await page.locator('button').filter({ hasText: 'Распарсить' }).click();

  await waitForVisible(page, "#mcImportModeSelect", 30000);
  await page.selectOption("#mcImportModeSelect", "append_to_deck");
  await waitForVisible(page, "#mcImportTargetDeck", 10000);
  await page.selectOption("#mcImportTargetDeck", fixture.microcards.deckId);
  await waitForVisible(page, "#mcImportTargetDeckNote", 10000);

  const targetDeckNote = await page.locator("#mcImportTargetDeckNote").textContent();
  assertTextIncludes(
    targetDeckNote,
    fixture.microcardsDeckName,
    "microcards_editor_import_flow.target_deck_note"
  );

  await page.getByRole("button", { name: /Импортировать/ }).click();

  await page.waitForFunction(
    () => String(document.getElementById("import-modal")?.textContent || "").includes("Импорт завершён"),
    null,
    { timeout: 30000 }
  );

  await page.locator("button").filter({ hasText: "Открыть в редакторе" }).click();
  await waitForVisible(page, "#m11WorkspaceNote", 30000);
  await page.waitForFunction(
    ({ deckName, expectedFront }) => {
      const modal = document.getElementById("import-modal");
      return (
        !!modal &&
        String(modal.textContent || "").includes(deckName) &&
        String(modal.textContent || "").includes(expectedFront)
      );
    },
    { deckName: fixture.microcardsDeckName, expectedFront: importFront },
    { timeout: 30000 }
  );
}

async function scenarioEditorArchiveExportImportFlow({
  page,
  baseUrl,
  artifacts,
}) {
  const taskFixture = await ensureEditorArchiveTaskFixture(baseUrl);
  const archivePath = path.join(
    artifacts.runDir,
    `${taskFixture.taskId}_editor_archive.zip`
  );

  try {
    await page.goto(
      resolveUrl(
        baseUrl,
        `/editor?module=${encodeURIComponent(taskFixture.moduleId)}&topic=${encodeURIComponent(
          taskFixture.topicId
        )}`
      ),
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    await waitForVisible(page, '[data-role="open-import-modal"]', 30000);
    await waitForEditorTaskCard(page, taskFixture.uniqueId, 30000);

    const selectionToggle = page.locator('[data-role="selection-toggle"]').first();
    const selectionToggleVisible = await selectionToggle.isVisible().catch(() => false);
    if (selectionToggleVisible) {
      await selectionToggle.click();
    }

    const taskCard = page.locator(`article[data-task-id="${taskFixture.uniqueId}"]`).first();
    await taskCard.hover();
    const taskCheckbox = taskCard.locator('input[type="checkbox"]').first();
    const checkboxVisible = await taskCheckbox.isVisible().catch(() => false);
    if (checkboxVisible) {
      await taskCheckbox.click();
    } else {
      await taskCard.click();
    }
    await waitForVisible(page, '[data-role="selection-export"]', 20000);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click('[data-role="selection-export"]'),
    ]);
    await download.saveAs(archivePath);

    await deleteEditorTask(
      baseUrl,
      taskFixture.moduleId,
      taskFixture.topicId,
      taskFixture.taskId
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVisible(page, '[data-role="open-import-modal"]', 30000);
    await page.waitForFunction(
      (expectedUniqueId) =>
        !document.querySelector(`article[data-task-id="${expectedUniqueId}"]`),
      taskFixture.uniqueId,
      { timeout: 30000 }
    );

    await page.click('[data-role="open-import-modal"]');
    await waitForVisible(page, '[data-role="import-mode-archive"]', 20000);
    await page.click('[data-role="import-mode-archive"]');
    await page.setInputFiles('#import-file-input', archivePath);
    await waitForEnabled(page, '[data-role="import-next"]', 10000);
    await page.click('[data-role="import-next"]');

    await waitForVisible(page, '[data-role="archive-import-preview"]', 30000);
    await waitForVisible(page, '[data-role="archive-import-task-card"]', 30000);
    const previewText = await page.locator('[data-role="archive-import-preview"]').textContent();
    assertTextIncludes(
      previewText,
      taskFixture.taskId,
      "editor_archive_export_import_flow.preview_task_id"
    );

    await page.click('[data-role="import-next"]');
    await waitForEnabled(page, '[data-role="import-next"]', 10000);
    await page.click('[data-role="import-next"]');

    await page.waitForFunction(
      (expectedUniqueId) => {
        const modal = document.getElementById("import-modal");
        const card = document.querySelector(`article[data-task-id="${expectedUniqueId}"]`);
        return (
          modal &&
          modal.classList.contains("hidden") &&
          !!card &&
          !card.hidden
        );
      },
      taskFixture.uniqueId,
      { timeout: 45000 }
    );

    const importedTask = await getEditorTask(
      baseUrl,
      taskFixture.moduleId,
      taskFixture.topicId,
      taskFixture.taskId
    );
    if (!importedTask) {
      throw new Error("editor_archive_export_import_flow.task_not_restored");
    }
  } finally {
    try {
      await deleteEditorTask(
        baseUrl,
        taskFixture.moduleId,
        taskFixture.topicId,
        taskFixture.taskId
      );
    } catch (_) {
      // Best-effort cleanup for temporary archive roundtrip task.
    }
  }
}

async function scenarioComplexArchiveImportFlow({
  page,
  baseUrl,
  artifacts,
}) {
  const importFixture = await ensureComplexImportArchiveFixture(
    baseUrl,
    artifacts.runDir
  );

  try {
    await page.goto(resolveUrl(baseUrl, "/complexes"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVisible(page, "#import-complexes", 30000);
    await waitForVisible(
      page,
      '.complex-filter-chip[data-filter="imported"]',
      30000
    );

    await page.click("#import-complexes");
    await waitForVisible(page, '[data-role="dialog"] [data-role="confirm"]', 10000);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click('[data-role="dialog"] [data-role="confirm"]'),
    ]);
    await fileChooser.setFiles(importFixture.archivePath);

    await waitForVisible(
      page,
      '[data-role="confirm-card"] [data-role="confirm"]',
      20000
    );
    await page.click('[data-role="confirm-card"] [data-role="confirm"]');

    await page.waitForFunction(
      ({ complexId, complexName }) => {
        const cards = Array.from(
          document.querySelectorAll("[data-complex-card-id]")
        );
        return cards.some((card) => {
          const cardId = String(card.getAttribute("data-complex-card-id") || "");
          const imported = String(card.getAttribute("data-complex-imported") || "");
          const text = String(card.textContent || "");
          return (
            cardId === complexId &&
            imported === "true" &&
            text.includes(complexName)
          );
        });
      },
      {
        complexId: importFixture.complexId,
        complexName: importFixture.complexName,
      },
      { timeout: 45000 }
    );

    await page.click('.complex-filter-chip[data-filter="imported"]');
    await page.waitForFunction(
      (complexId) => {
        const cards = Array.from(
          document.querySelectorAll("[data-complex-card-id]")
        ).filter((card) => !card.hidden);
        return (
          cards.length > 0 &&
          cards.every(
            (card) => String(card.getAttribute("data-complex-imported") || "") === "true"
          ) &&
          cards.some(
            (card) => String(card.getAttribute("data-complex-card-id") || "") === complexId
          )
        );
      },
      importFixture.complexId,
      { timeout: 30000 }
    );

    const importedCardText = await page
      .locator(`[data-complex-card-id="${importFixture.complexId}"]`)
      .first()
      .textContent();
    assertTextIncludes(
      importedCardText,
      importFixture.complexName,
      "complex_archive_import_flow.imported_card_name"
    );
  } finally {
    try {
      await deleteComplex(baseUrl, importFixture.complexId);
    } catch (_) {
      // Best-effort cleanup for imported archive fixture.
    }
  }
}

async function scenarioSettingsThemePersistence({ page, baseUrl }) {
  const targetTheme = "dark-b";

  await page.goto(resolveUrl(baseUrl, "/editor"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await setTheme(page, targetTheme, 30000);

  await page.goto(resolveUrl(baseUrl, "/settings"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, "#providers-container", 30000);
  await page.waitForFunction(
    () => {
      const container = document.getElementById("providers-container");
      return !!container && !String(container.textContent || "").includes("Загрузка...");
    },
    null,
    { timeout: 20000 }
  );
  await waitForTheme(page, targetTheme, 10000);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForVisible(page, "#providers-container", 30000);
  await waitForTheme(page, targetTheme, 10000);
}

async function scenarioGuardS1ReloadResume({ page, baseUrl, fixture }) {
  const sessionId = await startFixtureSessionFromComplexes(page, baseUrl, fixture);

  const initialTaskText = await page.locator("#task-content").textContent();
  assertTextIncludes(
    initialTaskText,
    fixture.taskQuestionText,
    "guard_s1_reload_resume.initial_task"
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    (expectedSessionId) => {
      const label = document.getElementById("session-id-label");
      const taskContent = document.getElementById("task-content");
      return (
        !!label &&
        String(label.textContent || "").includes(expectedSessionId) &&
        !!taskContent &&
        String(taskContent.textContent || "").length > 0
      );
    },
    sessionId,
    { timeout: 30000 }
  );

  await waitForVisible(page, "#check-answer-btn", 20000);
  await waitForVisible(page, "#theory-session-banner", 20000);
  const bannerText = await page.locator("#theory-session-banner").textContent();
  if (
    !String(bannerText || "").includes(fixture.theoryTitle) &&
    !String(bannerText || "").includes(fixture.theoryId)
  ) {
    throw new Error(
      `guard_s1_reload_resume.theory_banner_missing: ${bannerText || "empty"}`
    );
  }
}

async function scenarioGuardS1MissingSessionRedirect({ page, baseUrl }) {
  const missingSessionId = "guardrail-missing-session-404";
  await page.goto(resolveUrl(baseUrl, `/session/${missingSessionId}`), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForFunction(
    () => {
      const url = new URL(window.location.href);
      const banner = document.getElementById("status-banner");
      const bannerVisible =
        !!banner &&
        !banner.classList.contains("hidden") &&
        String(banner.textContent || "").includes("Сессия не найдена");
      return url.pathname === "/main" || bannerVisible;
    },
    null,
    { timeout: 10000 }
  );

  if (!/\/ui\/main(?:[?#]|$)/.test(page.url())) {
    await page.waitForURL(/\/ui\/main(?:[?#]|$)/, { timeout: 10000 });
  }
  await waitForVisible(page, "#headerUserName", 20000);
}

async function scenarioGuardEmptyUserSurfaces({ page, baseUrl, fixture }) {
  const tempUserName = `[Smoke] Empty Guard ${Date.now()}`;
  let tempUserId = "";

  try {
    const created = await createUser(baseUrl, {
      name: tempUserName,
      avatar_seed: FIXTURE.userAvatarSeed,
    });
    tempUserId = String((created.user || {}).user_id || "").trim();
    if (!tempUserId) {
      throw new Error("guard_empty_user_surfaces.temp_user_missing_id");
    }

    await selectUser(baseUrl, tempUserId);

    await page.goto(resolveUrl(baseUrl, "/main"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => {
        const quickAccessEmpty = document.getElementById("quick-access-empty");
        const calendarEmpty = document.getElementById("calendarEmptyState");
        const microcardsEmpty = document.getElementById("microcardsEmptyState");
        const microcardsContent = document.getElementById("microcardsContentState");
        const statsWelcome = document.getElementById("statsWelcomeMessage");
        return (
          !!quickAccessEmpty &&
          quickAccessEmpty.hidden === false &&
          !!calendarEmpty &&
          calendarEmpty.classList.contains("hidden") === false &&
          (!!microcardsEmpty || !!microcardsContent) &&
          (
            (microcardsEmpty && microcardsEmpty.classList.contains("hidden") === false) ||
            (microcardsContent && microcardsContent.classList.contains("hidden") === false)
          ) &&
          !!statsWelcome &&
          statsWelcome.classList.contains("hidden") === false
        );
      },
      null,
      { timeout: 30000 }
    );

    await page.goto(resolveUrl(baseUrl, "/complexes"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => {
        const emptyState = document.getElementById("empty-state");
        const errorState = document.getElementById("error-state");
        const cards = document.querySelectorAll("[data-complex-card-id]").length;
        return (
          (!errorState || errorState.hidden === true) &&
          ((!!emptyState && emptyState.hidden === false) || cards > 0)
        );
      },
      null,
      { timeout: 30000 }
    );

    await page.goto(resolveUrl(baseUrl, "/calendar"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVisible(page, "#daily-mix-card", 30000);
    await waitForVisible(page, "#main-focus-card", 30000);
    await page.waitForFunction(
      () => {
        const dailyMixCard = document.getElementById("daily-mix-card");
        const mainFocusCard = document.getElementById("main-focus-card");
        return (
          !!dailyMixCard &&
          !!mainFocusCard &&
          dailyMixCard.classList.contains("cursor-default") &&
          mainFocusCard.classList.contains("cursor-default")
        );
      },
      null,
      { timeout: 30000 }
    );

    await page.goto(resolveUrl(baseUrl, "/microcards"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => {
        const emptyState = document.getElementById("mcDeckEmpty");
        const deckGrid = document.getElementById("mcDeckGrid");
        const errorState = document.getElementById("mcDeckError");
        const reviewView = document.getElementById("mcViewReview");
        return (
          (
            (emptyState && emptyState.classList.contains("hidden") === false) ||
            (deckGrid && deckGrid.children.length > 0)
          ) &&
          (!errorState || errorState.classList.contains("hidden")) &&
          (!!reviewView && reviewView.classList.contains("hidden"))
        );
      },
      null,
      { timeout: 30000 }
    );
  } finally {
    try {
      await selectUser(baseUrl, fixture.userId);
    } catch (_) {
      // Best-effort; global runner cleanup will restore the smoke user anyway.
    }
    if (tempUserId) {
      try {
        await deleteUser(baseUrl, tempUserId);
      } catch (_) {
        // Best-effort cleanup only.
      }
    }
  }
}

async function scenarioGuardEditorInvalidTheoryHub({ page, baseUrl }) {
  await page.goto(
    resolveUrl(baseUrl, "/editor?theory_hub=1&theory_id=guardrail_missing_theory"),
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }
  );

  await waitForTheoryEditorUrl(page, "guardrail_missing_theory", 30000);
  await waitForVisible(page, "#theory-editor", 30000);
}

async function scenarioGuardComplexesUnknownTheoryFilter({ page, baseUrl, fixture }) {
  await page.goto(
    resolveUrl(baseUrl, "/complexes?theory_id=guardrail_missing_theory"),
    {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }
  );

  await waitForVisible(page, "#complex-theory-banner", 30000);
  await page.waitForFunction(
    () => {
      const errorState = document.getElementById("error-state");
      return !errorState || errorState.hidden === true;
    },
    null,
    { timeout: 10000 }
  );

  await page.click("#complex-theory-clear");
  await page.waitForFunction(
    () => {
      const url = new URL(window.location.href);
      return !url.searchParams.get("theory_id");
    },
    null,
    { timeout: 20000 }
  );
  await waitForVisible(
    page,
    `[data-complex-card-id="${fixture.complexId}"]`,
    30000
  );
}

async function scenarioGuardSettingsDraftRecovery({ page, baseUrl }) {
  const draftValue = "smoke-draft-openrouter-key";

  await page.goto(resolveUrl(baseUrl, "/settings"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitForVisible(page, "#key-input-openrouter", 30000);
  await page.fill("#key-input-openrouter", draftValue);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForVisible(page, "#settings-draft-banner", 30000);
  await page.click("#settings-draft-restore-btn");

  await page.waitForFunction(
    (expectedValue) => {
      const input = document.getElementById("key-input-openrouter");
      return !!input && input.value === expectedValue;
    },
    draftValue,
    { timeout: 15000 }
  );
}

const SCENARIOS = [
  {
    id: "welcome_main",
    label: "Welcome -> Main",
    suites: ["p0"],
    run: scenarioWelcomeToMain,
  },
  {
    id: "main_complexes_s1",
    label: "Main -> Complexes -> S1",
    suites: ["p0"],
    run: scenarioMainToComplexesToS1,
  },
  {
    id: "s1_core_session",
    label: "S1 core session",
    suites: ["p0"],
    run: scenarioS1CoreSession,
  },
  {
    id: "s3_basic_results",
    label: "S3 basic results",
    suites: ["p0"],
    run: scenarioS3BasicResults,
  },

  {
    id: "topic_theory_modal_navigation",
    label: "Topic theory modal navigation",
    suites: ["p0"],
    run: scenarioTopicTheoryModalNavigation,
  },
  {
    id: "complexes_theory_modal_builder_context",
    label: "Complexes theory modal and builder context",
    suites: ["p0"],
    run: scenarioComplexesTheoryModalBuilderContext,
  },
  {
    id: "statistics_theory_flow",
    label: "Statistics theory flow",
    suites: ["p0"],
    run: scenarioStatisticsTheoryFlow,
  },
  {
    id: "calendar_recommended_action",
    label: "Calendar recommended action",
    suites: ["p1"],
    run: scenarioCalendarRecommendedAction,
  },
  {
    id: "microcards_basic_review",
    label: "Microcards basic review",
    suites: ["p1"],
    run: scenarioMicrocardsBasicReview,
  },
  {
    id: "microcards_editor_import_flow",
    label: "Microcards editor import flow",
    suites: ["p1"],
    run: scenarioMicrocardsEditorImportFlow,
  },
  {
    id: "editor_archive_export_import_flow",
    label: "Editor archive export/import flow",
    suites: ["p1"],
    run: scenarioEditorArchiveExportImportFlow,
  },
  {
    id: "complex_archive_import_flow",
    label: "Complex archive import flow",
    suites: ["p1"],
    run: scenarioComplexArchiveImportFlow,
  },
  {
    id: "settings_theme_persistence",
    label: "Settings theme persistence",
    suites: ["p1"],
    run: scenarioSettingsThemePersistence,
  },
  {
    id: "guard_editor_invalid_theory_hub",
    label: "Guardrail: legacy theory deep-link redirect",
    suites: ["guardrail"],
    run: scenarioGuardEditorInvalidTheoryHub,
  },
  {
    id: "guard_complexes_unknown_theory_filter",
    label: "Guardrail: unknown theory filter recovery",
    suites: ["guardrail"],
    run: scenarioGuardComplexesUnknownTheoryFilter,
  },
  {
    id: "guard_settings_draft_recovery",
    label: "Guardrail: settings draft recovery",
    suites: ["guardrail"],
    run: scenarioGuardSettingsDraftRecovery,
  },
  {
    id: "guard_s1_reload_resume",
    label: "Guardrail: S1 reload resume",
    suites: ["guardrail"],
    run: scenarioGuardS1ReloadResume,
  },
  {
    id: "guard_s1_missing_session_redirect",
    label: "Guardrail: S1 missing session redirect",
    suites: ["guardrail"],
    run: scenarioGuardS1MissingSessionRedirect,
  },
  {
    id: "guard_empty_user_surfaces",
    label: "Guardrail: empty user surfaces",
    suites: ["guardrail"],
    run: scenarioGuardEmptyUserSurfaces,
  },
];

async function runScenario(browser, scenario, ctx) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const startedAt = Date.now();
  const result = {
    id: scenario.id,
    label: scenario.label,
    ok: false,
    durationMs: 0,
    screenshot: null,
    error: null,
    notes: [],
  };

  try {
    await scenario.run({ page, context, browser, ...ctx });
    result.ok = true;
  } catch (error) {
    result.error = error && error.message ? error.message : String(error);
    const screenshotPath = path.join(
      ctx.artifacts.screenshotDir,
      `${scenario.id}.png`
    );
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      result.screenshot = screenshotPath;
    } catch (screenshotError) {
      result.notes.push(
        `screenshot_failed: ${
          screenshotError && screenshotError.message
            ? screenshotError.message
            : String(screenshotError)
        }`
      );
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
    await context.close();
  }

  return result;
}

async function main() {
  const opts = parseArgs();
  const startedAtIso = new Date().toISOString();

  const reachable = await pingBaseUrl(opts.baseUrl);
  if (!reachable) {
    throw new Error(
      `Server is not reachable at ${opts.baseUrl}. Start desktop-app/server.py and retry.`
    );
  }

  const artifacts = createRunArtifacts(opts.reportDir);
  const fixture = await ensureSmokeFixture(opts.baseUrl);

  const scenarioIds = new Set(
    (Array.isArray(opts.scenarioIds) ? opts.scenarioIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const suiteIds = new Set(
    (Array.isArray(opts.suiteIds) ? opts.suiteIds : [])
      .map((id) => String(id || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const scenariosToRun = SCENARIOS.filter((scenario) => {
    const matchesScenario = !scenarioIds.size || scenarioIds.has(scenario.id);
    const scenarioSuites = Array.isArray(scenario.suites) ? scenario.suites : [];
    const matchesSuite =
      !suiteIds.size || scenarioSuites.some((suiteId) => suiteIds.has(suiteId));
    return matchesScenario && matchesSuite;
  });

  if (!scenariosToRun.length) {
    throw new Error("No browser-smoke scenarios selected.");
  }

  const browser = await chromium.launch({
    headless: opts.headless !== false,
  });

  const scenarioResults = [];
  try {
    for (const scenario of scenariosToRun) {
      if (scenario.id !== "welcome_main") {
        await selectUser(opts.baseUrl, fixture.userId);
      }
      const result = await runScenario(browser, scenario, {
        baseUrl: opts.baseUrl,
        fixture,
        artifacts,
        options: opts,
      });
      scenarioResults.push(result);
    }
  } finally {
    try {
      await cancelActiveSessionsForComplex(opts.baseUrl, fixture.complexId);
    } catch (cleanupError) {
      scenarioResults.push({
        id: "cleanup_cancel_active_sessions",
        label: "Cleanup active sessions",
        ok: false,
        durationMs: 0,
        screenshot: null,
        error:
          cleanupError && cleanupError.message
            ? cleanupError.message
            : String(cleanupError),
        notes: [],
      });
    }

    if (fixture.previousUserId && fixture.previousUserId !== fixture.userId) {
      try {
        await selectUser(opts.baseUrl, fixture.previousUserId);
      } catch (restoreError) {
        scenarioResults.push({
          id: "cleanup_restore_user",
          label: "Restore previous user",
          ok: false,
          durationMs: 0,
          screenshot: null,
          error:
            restoreError && restoreError.message
              ? restoreError.message
              : String(restoreError),
          notes: [],
        });
      }
    }

    await browser.close();
  }

  const failedCount = scenarioResults.filter((item) => !item.ok).length;
  const passedCount = scenarioResults.length - failedCount;
  const durationMs = Date.now() - Date.parse(startedAtIso);

  const summary = {
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs,
    baseUrl: opts.baseUrl,
    fixture: {
      userId: fixture.userId,
      complexId: fixture.complexId,
      theoryId: fixture.theoryId,
      statsSeed: fixture.statsSeed,
    },
    selectedSuites: Array.from(suiteIds.values()),
    selectedScenarios: Array.from(scenarioIds.values()),
    passedCount,
    failedCount,
    scenarios: scenarioResults,
  };

  writeRunSummary(artifacts, summary);

  console.log(
    `[browser-smoke] ${passedCount} passed, ${failedCount} failed. Report: ${artifacts.mdPath}`
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[browser-smoke] failed:",
    error && error.message ? error.message : error
  );
  process.exit(1);
});
