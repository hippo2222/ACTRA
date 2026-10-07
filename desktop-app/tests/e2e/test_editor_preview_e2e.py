import json
import pytest
from playwright.sync_api import Page, expect

# Mark this file as an integration/e2e test
pytestmark = pytest.mark.integration


def _disable_onboarding(page: Page):
    """Intercept UI settings to disable onboarding tour."""
    page.on("console", lambda msg: print(f"\n[BROWSER CONSOLE] [{msg.type}] {msg.text}"))
    page.route("**/api/ui/settings", lambda route: route.fulfill(
        json={"ok": True, "settings": {"onboarding": {"disabled": True}}}
    ))


def test_editor_preview_single_task_play_pause_and_cancel_e2e(page: Page, local_server: str):
    """
    Test 1: Single Task Test-Drive & Return
    - Open Editor dashboard (/editor)
    - Launch test-drive for a task via [data-action='play-task']
    - Verify navigation to S1 session (/session/<id>?return_to=...)
    - S1 loads, user pauses session via back button and confirm modal
    - Verify automated redirect back to /editor
    - Verify sticky preview banner appears on Editor dashboard
    - Click cancel in banner -> session is discarded and banner removed
    """
    _disable_onboarding(page)

    # 1. Clean up any leftover preview session
    page.request.post(f"{local_server}/api/editor/preview-session/cancel")

    # 2. Open Editor dashboard
    page.goto(f"{local_server}/editor")
    page.wait_for_selector("body")

    # Wait for catalog to load and tasks to render
    page.wait_for_function(
        "() => window.dashboard && window.dashboard.catalog && window.dashboard.catalog.length > 0",
        timeout=15000,
    )

    # Wait for task cards in grid
    play_buttons = page.locator("article button[data-action='play-task']")
    play_buttons.first.wait_for(state="visible", timeout=15000)

    # 3. Click play button on first task
    play_buttons.first.click()

    # 4. Wait for navigation to S1 session
    page.wait_for_url("**/session/**", timeout=15000)
    assert "/session/" in page.url
    assert "return_to=" in page.url

    # 5. S1 session page loaded - wait for toolbar / back button
    back_btn = page.locator("#back-to-complexes-btn")
    back_btn.wait_for(state="visible", timeout=15000)

    # 6. Click Back button to open pause modal
    back_btn.click()

    # 7. Modal opens with pause & exit button
    pause_submit = page.locator("#pause-confirm-submit")
    pause_submit.wait_for(state="visible", timeout=10000)
    pause_submit.click()

    # 8. Should redirect back to Editor
    page.wait_for_url("**/editor**", timeout=15000)
    assert "/editor" in page.url

    # 9. Verify sticky preview banner appears on Editor dashboard
    banner = page.locator("[data-role='preview-session-banner']")
    banner.wait_for(state="visible", timeout=15000)

    # Check banner contains resume and cancel buttons
    resume_btn = banner.locator("[data-action='preview-resume']")
    cancel_btn = banner.locator("[data-action='preview-cancel']")
    expect(resume_btn).to_be_visible()
    expect(cancel_btn).to_be_visible()

    # 10. Click cancel button in banner to discard preview session
    cancel_btn.click()

    # 11. Verify banner is removed from DOM
    banner.wait_for(state="detached", timeout=10000)


def test_editor_preview_multi_task_selection_and_complex_handoff_e2e(page: Page, local_server: str):
    """
    Test 2: Multi-Task Selection & Complex Creation Handoff
    - Open Editor
    - Select multiple tasks via checkboxes
    - Selection action bar slides into view with correct count
    - Click 'Создать комплекс'
    - Navigates to /complexes/create
    - Builder initializes with handed-off tasks in selected list
    - Catalog chips auto-expanded and marked as added
    - Handoff sessionStorage key cleaned up
    """
    _disable_onboarding(page)

    # 1. Open Editor dashboard
    page.goto(f"{local_server}/editor")
    page.wait_for_selector("body")

    # Wait for catalog to load
    page.wait_for_function(
        "() => window.dashboard && window.dashboard.catalog && window.dashboard.catalog.length > 0",
        timeout=15000,
    )

    # Wait for task cards
    cards = page.locator("article.task-card")
    cards.first.wait_for(state="attached", timeout=15000)
    count = cards.count()
    assert count >= 2, f"Expected at least 2 task cards, got {count}"

    # 2. Select two tasks
    # Hover over card and click checkbox
    cards.nth(0).hover()
    cards.nth(0).locator("input.task-checkbox").click(force=True)

    cards.nth(1).hover()
    cards.nth(1).locator("input.task-checkbox").click(force=True)

    # 3. Verify action bar is displayed and count is 2
    action_bar = page.locator("#selection-action-bar")
    action_bar.wait_for(state="visible", timeout=10000)
    counter = page.locator("#selection-counter")
    expect(counter).to_contain_text("2")

    # 4. Click 'Создать комплекс'
    create_btn = page.locator("[data-role='selection-create-complex']")
    create_btn.wait_for(state="visible", timeout=5000)
    create_btn.click()

    # 5. Navigates to /complexes/create
    page.wait_for_url("**/complexes/create**", timeout=15000)
    assert "/complexes/create" in page.url

    # 6. Verify tasks are added in the builder selected list
    selected_count = page.locator("#selected-count")
    selected_count.wait_for(state="visible", timeout=15000)
    page.wait_for_function(
        "() => Number(document.getElementById('selected-count')?.textContent || 0) >= 2",
        timeout=15000,
    )

    # 7. Verify sessionStorage key is cleaned up
    cleaned = page.evaluate("() => sessionStorage.getItem('actra_handoff_complex_tasks') === null")
    assert cleaned is True

    # 8. Verify added task chips in catalog are marked with task-chip--added
    page.wait_for_selector(".task-chip--added", timeout=15000)
    added_chips = page.locator(".task-chip--added")
    assert added_chips.count() >= 2


def test_complexes_library_paused_preview_card_and_dismiss_e2e(page: Page, local_server: str):
    """
    Test 3: Paused Preview Session in Complexes Library
    - Prepare an active paused preview session via API
    - Open /complexes
    - Verify preview synthetic card [data-complex-card-id='task_preview'] is rendered at top
    - Switch filter to 'На паузе' -> card remains visible
    - Click 'Сбросить' -> confirm modal -> card dismissed and active session cleared
    """
    _disable_onboarding(page)

    # 1. Clean existing preview session
    page.request.post(f"{local_server}/api/editor/preview-session/cancel")

    # 2. Get a valid task reference from catalog
    catalog_resp = page.request.get(f"{local_server}/api/editor/catalog")
    assert catalog_resp.ok
    catalog_data = catalog_resp.json()
    modules = catalog_data.get("modules") or catalog_data.get("catalog") or []
    assert catalog_data.get("ok") and len(modules) > 0
    first_mod = modules[0]
    first_top = first_mod["topics"][0]
    first_task = first_top["tasks"][0]
    task_ref = f"{first_mod['id']}/{first_top['id']}/{first_task['id']}"

    # 3. Start preview session
    start_resp = page.request.post(
        f"{local_server}/api/editor/preview-session/start",
        data=json.dumps({"task_refs": [task_ref], "force": True}),
        headers={"Content-Type": "application/json"},
    )
    assert start_resp.ok
    session_id = start_resp.json()["session_id"]

    # 4. Pause the session
    pause_resp = page.request.post(f"{local_server}/api/session/{session_id}/pause")
    assert pause_resp.ok

    # 5. Open /complexes library
    page.goto(f"{local_server}/complexes")
    page.wait_for_selector("body")

    # 6. Verify preview card appears
    preview_card = page.locator("[data-complex-card-id='task_preview']")
    preview_card.wait_for(state="visible", timeout=15000)

    # Verify badge text
    expect(preview_card).to_contain_text("Тест-драйв из Редактора")

    # 7. Click filter "На паузе"
    paused_filter_chip = page.locator("button.complex-filter-chip[data-filter='paused']")
    paused_filter_chip.wait_for(state="visible", timeout=5000)
    paused_filter_chip.click()

    # 8. Verify preview card remains visible with filter active
    expect(preview_card).to_be_visible()

    # 9. Click "Сбросить" button
    cancel_btn = preview_card.locator("[data-action='cancel-preview']")
    cancel_btn.click()

    # 10. Confirm modal appears
    confirm_modal = page.locator("[data-role='confirm-card']")
    confirm_modal.wait_for(state="visible", timeout=5000)
    confirm_btn = page.locator("[data-role='confirm']")
    confirm_btn.click()

    # 11. Verify card is removed
    preview_card.wait_for(state="detached", timeout=10000)

    # 12. Verify backend endpoint confirms no active preview session
    active_resp = page.request.get(f"{local_server}/api/editor/preview-session/active")
    assert active_resp.ok
    assert active_resp.json().get("active") is False
