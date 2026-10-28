/**
 * ACTRA Adversarial Studio Modal Audit Runner
 * Blind Wildcard Zero-Rails Reviewer
 * Attack vectors: Keyboard/A11y, State Desync, Form Enter, Viewport Fold, Tour Step 5 Zombie & Collision
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.ACTRA_BASE_URL || 'http://127.0.0.1:8000';
const OUT_DIR = path.resolve('tmp/adversarial_audit');

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

function rectsOverlap(r1, r2) {
    return !(
        r1.right <= r2.left ||
        r1.left >= r2.right ||
        r1.bottom <= r2.top ||
        r1.top >= r2.bottom
    );
}

const auditFindings = [];

function recordFinding(category, severity, title, details) {
    auditFindings.push({ category, severity, title, details });
    const color = severity === 'BLOCKER' ? '\x1b[31m[BLOCKER]\x1b[0m' :
                  severity === 'MAJOR' ? '\x1b[33m[MAJOR]\x1b[0m' :
                  severity === 'MINOR' ? '\x1b[36m[MINOR]\x1b[0m' : '\x1b[90m[NITPICK]\x1b[0m';
    console.log(`${color} ${title}: ${details}`);
}

async function runAdversarialAudit() {
    console.log('\n===============================================================');
    console.log('   ACTRA Adversarial Audit: Studio Modal & Onboarding Step 5   ');
    console.log('===============================================================\n');

    const browser = await chromium.launch({ headless: true });

    async function createContext(vp = { width: 1280, height: 800 }) {
        const context = await browser.newContext({ viewport: vp });
        await context.request.post(`${BASE_URL}/api/auth/login`, {
            data: { identifier: 'devuser', password: 'password123' },
            headers: { Origin: BASE_URL }
        });
        return context;
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 1: Form Enter Key Triggers Page Reload / Navigation
    // -------------------------------------------------------------------------
    console.log('--- [Attack Vector 1] Testing Form Enter Key Submission ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        // Open modal
        await page.evaluate(() => window.dashboard.showCreateTaskModal());
        await page.waitForSelector('#create-task-modal:not(.hidden)');

        // Type in name input
        await page.fill('#task-name-input', 'Adversarial Test Task');

        // Watch for navigation/reload
        let navigated = false;
        page.on('framenavigated', () => { navigated = true; });

        // Press Enter
        await page.press('#task-name-input', 'Enter');
        await page.waitForTimeout(1000);

        const currentUrl = page.url();
        if (navigated || currentUrl.includes('task_subtype=')) {
            recordFinding(
                'Form & Native Events',
                'BLOCKER',
                'Form Enter Key Reloads Page',
                `Pressing Enter inside #task-name-input triggered unhandled form submit, navigating to ${currentUrl}. Task was NOT created!`
            );
        } else {
            console.log('  ✔ Form did not reload page on Enter');
        }
        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 2: Zombie Tour Step 5 on Modal Dismissal
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 2] Testing Tour Step 5 Zombie on Modal Dismissal ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        // Start tour directly at Step 5
        await page.evaluate(async () => {
            window.OnboardingTour.finish();
            await new Promise(r => setTimeout(r, 100));
            await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
        });
        await page.waitForTimeout(1000);

        // Dismiss modal via close button inside modal
        await page.click('#create-task-modal .editor-modal-close-btn');
        await page.waitForTimeout(600);

        const tourState = await page.evaluate(() => {
            const modalHidden = document.querySelector('#create-task-modal')?.classList.contains('hidden');
            const calloutsVisible = document.querySelectorAll('.onboarding-tour-callout.is-visible').length;
            const controlVisible = Boolean(document.querySelector('.onboarding-tour-control'));
            const scrimVisible = Boolean(document.querySelector('.onboarding-tour-scrim'));
            return { modalHidden, calloutsVisible, controlVisible, scrimVisible };
        });

        if (tourState.modalHidden && (tourState.calloutsVisible > 0 || tourState.controlVisible)) {
            recordFinding(
                'Onboarding Resilience',
                'BLOCKER',
                'Zombie Onboarding Tour on Modal Close',
                `Modal was hidden, but ${tourState.calloutsVisible} callouts and control bar remain active pointing into empty space!`
            );
            await page.screenshot({ path: path.join(OUT_DIR, 'zombie_tour_step5.png') });
        } else {
            console.log('  ✔ Tour cleaned up properly when modal was closed');
        }
        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 3: Tour Step 5 Collision & Bidirectional Navigation on 1024x768
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 3] Testing Tour Step 5 Callout Collision & Bidirectional Navigation at 1024x768 ---');
    {
        const context = await createContext({ width: 1024, height: 768 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(600);

        await page.evaluate(async () => {
            window.dashboard.closeModals();
            await window.OnboardingTour.finish();
            await new Promise(r => setTimeout(r, 400));
            await window.OnboardingTour.start('editor-dashboard-authoring', { force: true, initialStep: 4 });
            await new Promise(r => setTimeout(r, 800));
        });

        const collisionData = await page.evaluate(() => {
            const dialog = document.querySelector('[data-onboarding-target="editor-create-task-dialog"]');
            if (!dialog) return { error: 'No dialog' };
            const dRect = dialog.getBoundingClientRect();

            const callouts = Array.from(document.querySelectorAll('.onboarding-tour-callout.is-visible')).map(el => {
                const rect = el.getBoundingClientRect();
                const title = el.querySelector('.onboarding-tour-callout-title')?.textContent?.trim() || '';
                return { title, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
            });

            // 1. Dialog overlap check
            const collisions = [];
            for (const c of callouts) {
                const overlap = !(c.rect.right <= dRect.left || c.rect.left >= dRect.right || c.rect.bottom <= dRect.top || c.rect.top >= dRect.bottom);
                if (overlap) {
                    collisions.push({ title: c.title, overlapAmount: dRect.left - c.rect.right });
                }
            }

            // 2. Mutual callout overlap check
            const mutualCollisions = [];
            for (let i = 0; i < callouts.length; i++) {
                for (let j = i + 1; j < callouts.length; j++) {
                    const c1 = callouts[i].rect;
                    const c2 = callouts[j].rect;
                    const overlap = !(c1.right <= c2.left || c1.left >= c2.right || c1.bottom <= c2.top || c1.top >= c2.bottom);
                    if (overlap) {
                        mutualCollisions.push({ c1: callouts[i].title, c2: callouts[j].title });
                    }
                }
            }

            return { dRect, collisions, mutualCollisions, calloutsCount: callouts.length };
        });

        // Anti-Vacuous-Pass Assertion: Must find exactly 3 visible callouts
        if (collisionData.calloutsCount < 3) {
            recordFinding(
                'Onboarding Resilience & Geometry',
                'BLOCKER',
                'Vacuous Test / Missing Callouts on 1024x768',
                `Expected 3 visible callouts on step 5, but found ${collisionData.calloutsCount}!`
            );
        } else if (collisionData.collisions && collisionData.collisions.length > 0) {
            recordFinding(
                'Onboarding Resilience & Geometry',
                'MAJOR',
                'Callout-Modal Collision at 1024x768',
                `${collisionData.collisions.length} callout(s) overlap dialog on 1024x768!`
            );
            await page.screenshot({ path: path.join(OUT_DIR, 'tour_step5_collision_1024x768.png') });
        } else if (collisionData.mutualCollisions && collisionData.mutualCollisions.length > 0) {
            recordFinding(
                'Onboarding Resilience & Geometry',
                'MAJOR',
                'Mutual Callout Overlap at 1024x768',
                `Callouts overlap each other: ${JSON.stringify(collisionData.mutualCollisions)}`
            );
            await page.screenshot({ path: path.join(OUT_DIR, 'tour_step5_collision_1024x768.png') });
        } else {
            console.log(`  ✔ Found ${collisionData.calloutsCount}/3 callouts, 0 dialog collisions, 0 mutual collisions at 1024x768`);
        }

        // Bidirectional Navigation Check: Step 5 -> Back -> Step 4 -> Next -> Step 5 -> User [X]
        console.log('  Testing Bidirectional Navigation (Step 5 -> Back -> Step 4 -> Next -> Step 5)...');
        const prevBtn = page.locator('[data-onboarding-action="prev"]');
        await prevBtn.click();
        await page.waitForTimeout(600);

        const backState = await page.evaluate(() => ({
            isActive: window.OnboardingTour.isActive(),
            stepId: window.OnboardingTour.getActiveStep()?.id,
            modalHidden: document.querySelector('#create-task-modal')?.classList.contains('hidden')
        }));

        if (!backState.isActive || backState.stepId !== 'editor-dashboard-task-grid' || !backState.modalHidden) {
            recordFinding(
                'Onboarding Resilience',
                'BLOCKER',
                'Tour Regression: Tour Died on "Назад" Navigation',
                `Going back from Step 5 broke the tour: isActive=${backState.isActive}, stepId=${backState.stepId}, modalHidden=${backState.modalHidden}`
            );
        } else {
            console.log('  ✔ Step 5 -> Back -> Step 4 succeeded, tour alive, modal closed cleanly');
        }

        const nextBtn = page.locator('[data-onboarding-action="next"]');
        await nextBtn.click();
        await page.waitForTimeout(600);

        const forwardState = await page.evaluate(() => ({
            isActive: window.OnboardingTour.isActive(),
            stepId: window.OnboardingTour.getActiveStep()?.id,
            modalOpen: !document.querySelector('#create-task-modal')?.classList.contains('hidden')
        }));

        if (!forwardState.isActive || forwardState.stepId !== 'editor-dashboard-create-task' || !forwardState.modalOpen) {
            recordFinding(
                'Onboarding Resilience',
                'BLOCKER',
                'Tour Regression: Forward Navigation to Step 5 Failed',
                `Returning to Step 5 failed: isActive=${forwardState.isActive}, stepId=${forwardState.stepId}, modalOpen=${forwardState.modalOpen}`
            );
        } else {
            console.log('  ✔ Forward return to Step 5 succeeded, tour alive, modal re-opened cleanly');
        }

        await page.screenshot({ path: path.join(OUT_DIR, 'tour_step5_verified_1024x768.png') });
        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 4: Dialog Height Clipping on Short Viewport (1280x540)
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 4] Testing Modal Content & Footer Clipping at 1280x540 ---');
    {
        const context = await createContext({ width: 1280, height: 540 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await page.evaluate(() => window.dashboard.showCreateTaskModal());
        await page.waitForSelector('#create-task-modal:not(.hidden)');

        const clippingData = await page.evaluate(() => {
            const submitBtn = document.querySelector('#create-task-submit-btn');
            const dialogSurface = document.querySelector('.editor-dialog-surface');
            if (!submitBtn || !dialogSurface) return { error: 'Not found' };

            const sRect = submitBtn.getBoundingClientRect();
            const dRect = dialogSurface.getBoundingClientRect();

            const isClippedBySurface = sRect.bottom > dRect.bottom || sRect.top < dRect.top;
            const isOutsideViewport = sRect.bottom > window.innerHeight;

            return {
                submitRect: { top: sRect.top, bottom: sRect.bottom },
                dialogRect: { top: dRect.top, bottom: dRect.bottom },
                windowHeight: window.innerHeight,
                isClippedBySurface,
                isOutsideViewport
            };
        });

        if (clippingData.isClippedBySurface || clippingData.isOutsideViewport) {
            recordFinding(
                'Viewport & Screen Economy',
                'MAJOR',
                'Submit Button Clipped on Short Viewport (1280x540)',
                `Submit button is clipped or pushed offscreen (Submit bottom: ${clippingData.submitRect.bottom}, Surface bottom: ${clippingData.dialogRect.bottom}, Viewport height: ${clippingData.windowHeight})`
            );
            await page.screenshot({ path: path.join(OUT_DIR, 'modal_clipped_1280x540.png') });
        } else {
            console.log('  ✔ Submit button fully visible at 1280x540');
        }
        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 5: Sidebar "+ Задание" Desynchronization
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 5] Testing Sidebar "+ Задание" Desynchronization ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const desyncResult = await page.evaluate(async () => {
            // Setup mock catalog with 2 modules
            window.dashboard.catalog = [
                { id: 'mod_alpha', name: 'Module Alpha', topics: [{ id: 'top_alpha', name: 'Topic Alpha' }] },
                { id: 'mod_beta', name: 'Module Beta', topics: [{ id: 'top_beta', name: 'Topic Beta' }] }
            ];
            window.dashboard.activeModuleId = 'mod_alpha';
            window.dashboard.activeTopicId = 'top_alpha';
            window.dashboard.renderSidebar();

            // Simulate clicking "+ Задание" on Topic Beta
            const moduleSelect = document.querySelector('#task-module-select');
            moduleSelect.value = 'mod_beta';
            window.dashboard.updateTopicSelect();
            const topicSelect = document.querySelector('#task-topic-select');
            topicSelect.value = 'top_beta';
            window.dashboard.showCreateTaskModal();

            return {
                expectedModule: 'mod_beta',
                actualModule: document.querySelector('#task-module-select').value,
                expectedTopic: 'top_beta',
                actualTopic: document.querySelector('#task-topic-select').value
            };
        });

        if (desyncResult.actualModule !== desyncResult.expectedModule) {
            recordFinding(
                'State Management',
                'MAJOR',
                'Sidebar Add Task Desyncs Module Selection',
                `Clicked add task on mod_beta, but modal opened with ${desyncResult.actualModule} (reverted to activeModuleId)!`
            );
        } else {
            console.log('  ✔ Module selection remained in sync');
        }
        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 6: Accessibility, Focus Trap & Keyboard Navigation
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 6] Testing Accessibility, Focus Trap & ARIA ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const a11yResult = await page.evaluate(() => {
            window.dashboard.showCreateTaskModal();
            const modal = document.querySelector('#create-task-modal');
            const picker = document.querySelector('#editor-task-type-picker');
            const cards = Array.from(picker.querySelectorAll('.editor-task-type-card'));
            const pillsContainer = document.querySelector('#editor-subtype-pills');
            const pills = Array.from(pillsContainer.querySelectorAll('.editor-subtype-pill'));

            const modalRole = modal.getAttribute('role');
            const modalAriaModal = modal.getAttribute('aria-modal');
            const pickerRole = picker.getAttribute('role');
            const activeCardChecked = cards[0]?.getAttribute('aria-checked') || cards[0]?.getAttribute('aria-pressed');
            const pillsRole = pillsContainer?.getAttribute('role');
            const activePillSelected = pills[0]?.getAttribute('aria-selected');

            return {
                hasModalDialogRole: modalRole === 'dialog',
                hasAriaModal: modalAriaModal === 'true',
                hasPickerRadioGroup: pickerRole === 'radiogroup' || pickerRole === 'tablist',
                hasCardAriaState: Boolean(activeCardChecked),
                hasPillsTabList: pillsRole === 'tablist' || pillsRole === 'radiogroup',
                hasPillAriaSelected: Boolean(activePillSelected),
            };
        });

        if (!a11yResult.hasModalDialogRole || !a11yResult.hasAriaModal) {
            recordFinding(
                'Accessibility (a11y)',
                'MAJOR',
                'Modal Lacks role="dialog" and aria-modal="true"',
                'Screen readers cannot identify #create-task-modal as an accessible dialog.'
            );
        }
        if (!a11yResult.hasPickerRadioGroup || !a11yResult.hasCardAriaState) {
            recordFinding(
                'Accessibility (a11y)',
                'MAJOR',
                'Archetype Cards Lack ARIA Radio/Tab Roles & Checked States',
                'Screen readers do not announce archetype picker as a selection group or announce which card is selected.'
            );
        }
        if (!a11yResult.hasPillsTabList || !a11yResult.hasPillAriaSelected) {
            recordFinding(
                'Accessibility (a11y)',
                'MAJOR',
                'Subtype Pills Lack role="tab" and aria-selected State',
                'Subtype buttons have no accessible state indicating active format.'
            );
        }

        // Test Focus Trap
        const focusTrapResult = await page.evaluate(() => {
            const modal = document.querySelector('#create-task-modal');
            const activeInside = modal.contains(document.activeElement);

            const focusableSelectors = [
                'button:not([disabled])',
                'input:not([disabled]):not([type="hidden"])',
                'select:not([disabled])',
                'textarea:not([disabled])',
                'a[href]',
                '[tabindex]:not([tabindex="-1"])'
            ].join(', ');
            const focusable = Array.from(modal.querySelectorAll(focusableSelectors))
                .filter(el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            // Focus last, press Tab -> should wrap to first
            last.focus();
            const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
            modal.dispatchEvent(tabEvent);
            const wrappedToFirst = document.activeElement === first;

            // Focus first, press Shift+Tab -> should wrap to last
            first.focus();
            const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
            modal.dispatchEvent(shiftTabEvent);
            const wrappedToLast = document.activeElement === last;

            return {
                activeInside,
                wrappedToFirst,
                wrappedToLast
            };
        });

        if (!focusTrapResult.activeInside || !focusTrapResult.wrappedToFirst || !focusTrapResult.wrappedToLast) {
            recordFinding(
                'Accessibility (a11y)',
                'MAJOR',
                'Modal Focus Trap Deficient',
                'Focus is not correctly constrained within #create-task-modal or autofocus failed.'
            );
        } else {
            console.log('  ✔ Focus Trap successfully constrains focus inside #create-task-modal');
        }

        // Test Arrow Navigation on Subtype Pills
        const arrowNavResult = await page.evaluate(() => {
            const pills = Array.from(document.querySelectorAll('#editor-subtype-pills .editor-subtype-pill'));
            if (pills.length < 2) return { success: false, reason: 'insufficient pills' };
            pills[0].focus();
            const arrowRight = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
            pills[0].dispatchEvent(arrowRight);
            const activeNow = document.activeElement;
            const secondPill = pills[1];
            return {
                success: document.querySelector('#task-subtype-input')?.value !== 'regions' || activeNow === secondPill
            };
        });

        if (!arrowNavResult.success) {
            recordFinding(
                'Accessibility (a11y)',
                'MINOR',
                'Subtype Pills Lack Arrow Key Navigation',
                'Pressing ArrowRight on subtype tabs does not cycle focus to the next format.'
            );
        } else {
            console.log('  ✔ Arrow navigation cycles subtype format pills');
        }

        await context.close();
    }

    // -------------------------------------------------------------------------
    // ATTACK VECTOR 7: Nested Modal Escape Key Collision
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 7] Testing Nested Modal Escape Key Dismissal ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        // Open task modal
        await page.evaluate(() => window.dashboard.showCreateTaskModal());
        await page.waitForSelector('#create-task-modal:not(.hidden)');

        // Type draft task name
        await page.fill('#task-name-input', 'Draft Task Before Module Create');

        // Click [+] next to module to open module creation modal
        await page.click('[data-i18n-title="md.add_module_title"]');
        await page.waitForSelector('#create-module-modal:not(.hidden)');

        // User changes mind and presses Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        const modalStatus = await page.evaluate(() => {
            const moduleModalOpen = !document.querySelector('#create-module-modal').classList.contains('hidden');
            const taskModalOpen = !document.querySelector('#create-task-modal').classList.contains('hidden');
            return { moduleModalOpen, taskModalOpen };
        });

        if (!modalStatus.taskModalOpen) {
            recordFinding(
                'Modal Stacking & UX',
                'MINOR',
                'Escape in Sub-modal Closes Entire Parent Task Studio Modal',
                'Pressing Escape to dismiss #create-module-modal closed both the sub-modal and the main task creation studio modal.'
            );
        } else {
            console.log('  ✔ Only the sub-modal was closed on Escape');
        }
        await context.close();
    }


    // -------------------------------------------------------------------------
    // ATTACK VECTOR 8: Explicit Cancel & Escape Form Draft Reset
    // -------------------------------------------------------------------------
    console.log('\n--- [Attack Vector 8] Testing Explicit Cancel & Escape Draft Reset ---');
    {
        const context = await createContext({ width: 1280, height: 800 });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/editor/Main_Dashboard.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        // Scenario A: Type draft -> Explicit Cancel button -> Reopen -> Should be EMPTY
        await page.evaluate(() => {
            window.dashboard.showCreateTaskModal();
            const input = document.querySelector('#task-name-input');
            input.value = 'Discarded Draft Task A';
            window.dashboard.closeModals({ userInitiated: true, resetDraft: true });
            window.dashboard.showCreateTaskModal();
        });
        const nameAfterCancel = await page.evaluate(() => document.querySelector('#task-name-input')?.value || '');

        if (nameAfterCancel !== '') {
            recordFinding(
                'Form & State UX',
                'MINOR',
                'Draft Retained After Explicit Modal Cancel',
                `Expected #task-name-input to be empty after explicit Cancel, but found "${nameAfterCancel}".`
            );
        } else {
            console.log('  ✔ Draft was cleanly cleared after explicit Cancel');
        }

        // Scenario B: Type draft -> Open Sub-modal -> Return with preserveDraft: true -> Should PRESERVE
        await page.evaluate(() => {
            const input = document.querySelector('#task-name-input');
            input.value = 'Preserved Draft Task B';
            window.dashboard.showCreateTaskModal({ preserveDraft: true });
        });
        const nameAfterPreserve = await page.evaluate(() => document.querySelector('#task-name-input')?.value || '');

        if (nameAfterPreserve !== 'Preserved Draft Task B') {
            recordFinding(
                'Form & State UX',
                'MAJOR',
                'Draft Lost During Module/Topic In-flight Creation',
                `Expected #task-name-input to preserve draft during sub-modal flow, but found "${nameAfterPreserve}".`
            );
        } else {
            console.log('  ✔ Draft was correctly preserved during in-flight module/topic flow');
        }

        // Scenario C: Escape key dismisses and resets draft
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.evaluate(() => window.dashboard.showCreateTaskModal());
        const nameAfterEscape = await page.evaluate(() => document.querySelector('#task-name-input')?.value || '');

        if (nameAfterEscape !== '') {
            recordFinding(
                'Form & State UX',
                'MINOR',
                'Draft Retained After Escape Key Dismissal',
                `Expected #task-name-input to be empty after Escape key dismissal, but found "${nameAfterEscape}".`
            );
        } else {
            console.log('  ✔ Draft was cleanly cleared after Escape dismissal');
        }

        await context.close();
    }

    await browser.close();

    console.log('\n===============================================================');
    console.log(`🏁 AUDIT FINISHED: ${auditFindings.length} findings recorded`);
    console.log('===============================================================\n');

    fs.writeFileSync(path.join(OUT_DIR, 'adversarial_findings.json'), JSON.stringify(auditFindings, null, 2));
}

runAdversarialAudit().catch(err => {
    console.error('Audit run error:', err);
    process.exit(1);
});
