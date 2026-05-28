import pytest
import os
from pathlib import Path

# Mark this file as an integration/e2e test
pytestmark = pytest.mark.integration

def test_ai_generation_full_cycle_e2e(page, local_server):
    """
    Simulates a user going through the AI generation import cycle.
    """
    # 1. Open the UI Editor where the import modal is located
    # Assuming "/editor" is the main entry for complexes and has the import button.
    page.goto(f"{local_server}/editor")

    # The actual selector for the open import modal button might vary.
    # Searching for generic terms if exact ID is unknown. 
    # Let's try to click the first button that opens the import modal.
    # From import_manager.js it seems there is a 'dashboard.importManager.goToStep(1)'
    # We will trigger it via JS if we can't find the button easily, but normally
    # there is a button like [data-role="import-open"] or similar.
    # Wait for the page to load
    page.wait_for_selector("body")
    
    # Disable onboarding tour to prevent the tour scrim from intercepting clicks
    page.evaluate("localStorage.setItem('actra_onboarding_disabled_v1', 'true')")
    page.reload()
    page.wait_for_selector("body")
    
    # Wait for the dashboard catalog to load
    page.wait_for_function("() => window.dashboard && window.dashboard.catalog && window.dashboard.catalog.length > 0", timeout=15000)

    # Open the import modal directly via JS to avoid localization and scrim dependency
    page.evaluate("if(window.dashboard) { window.dashboard.showImportModal(); if (window.dashboard.importManager) { window.dashboard.importManager.setImportMode('ai'); window.dashboard.importManager.goToStep(1); } }")

    # Wait for the re-rendering of AI mode step 1 to complete (the button gets highlighted)
    page.locator("[data-role='import-mode-ai'].border-primary").wait_for()

    # 3. We need to select a module and topic inside the modal
    # Wait for module "111" to be available in the dropdown options
    try:
        page.wait_for_selector("#import-module-select option[value='111']", state="attached", timeout=10000)
    except Exception as e:
        select_html = page.evaluate("() => document.getElementById('import-module-select') ? document.getElementById('import-module-select').outerHTML : 'NOT_FOUND'")
        modal_html = page.evaluate("() => document.getElementById('import-tasks-modal') ? document.getElementById('import-tasks-modal').innerHTML : 'MODAL_NOT_FOUND'")
        print(f"\n--- DEBUG E2E SELECT HTML:\n{select_html}")
        print(f"\n--- DEBUG E2E MODAL HTML:\n{modal_html}")
        raise e
    
    # Print module options for debugging
    modules_opts = page.evaluate("() => Array.from(document.querySelectorAll('#import-module-select option')).map(o => ({text: o.textContent, value: o.value}))")
    print("\n--- DEBUG: MODULE OPTIONS:", modules_opts)
    
    # Select module "111"
    page.locator("#import-module-select").select_option(value="111")
    
    # Wait for the topic "111_t" to be populated in the topic dropdown
    page.wait_for_selector("#import-topic-select option[value='111_t']", state="attached", timeout=10000)
    
    # Print topic options for debugging
    topics_opts = page.locator("#import-topic-select option").all_text_contents()
    print("\n--- DEBUG: TOPIC OPTIONS:", topics_opts)
    print("\n--- DEBUG: TOPIC SELECT DISABLED:", page.locator("#import-topic-select").is_disabled())
    
    # Select topic "111_t"
    page.locator("#import-topic-select").select_option(value="111_t")

    # 4. Upload a file
    # Create a temporary test file
    test_file_path = Path(__file__).parent / "e2e_test_material.txt"
    with open(test_file_path, "w", encoding="utf-8") as f:
        f.write("Сбор анамнеза. Диагностика пневмонии. Осмотр пациента. " * 20) # ensure > 50 words
    
    try:
        # Upload it
        with page.expect_file_chooser() as fc_info:
            page.locator("#ai-drop-zone").click()
        file_chooser = fc_info.value
        file_chooser.set_files(test_file_path)

        # Wait for the file to be processed (the UI updates to show the filename)
        # Instead of strict text, wait for the dropzone or adjacent element to update.
        page.wait_for_timeout(1000)

        # Click Next (Анализировать)
        next_btn = page.locator("[data-role='import-next']")
        next_btn.click()

        # 5. Step 2: Wait for Analysis
        # It shows a loader then the analysis results checkboxes.
        # We wait for at least one AI recommendation checkbox to appear.
        # Using data-testid for stable selector (not affected by UI changes)
        page.wait_for_selector("[data-testid^='ai-rec-toggle-']", timeout=90000)

        # Force a short wait for animations
        page.wait_for_timeout(500)

        # Click Next to start Generation
        next_btn.click()

        # 6. Step 3: Wait for Generation
        # Wait for the preview cards or step 3 container.
        page.wait_for_selector("text='Сгенерированные задания'", timeout=120000)

        # Verify that at least one group of tasks appeared
        # We can check for a common badge or the task title element
        assert page.locator("text='Сгенерированные задания'").count() > 0
        assert page.locator("input[type='checkbox']").count() > 0

        # 7. Complete the import
        # Click "К импорту" (Next)
        next_btn.click()

        # 8. Step 4: Ready for import
        # Wait for the import summary text
        page.wait_for_selector("text='Готово к импорту'", timeout=10000)
        
        # Click "Импортировать" (Next)
        next_btn.click()

        # Wait for success toast (any success notification)
        page.wait_for_selector(".bg-success", timeout=15000)
    finally:
        # Clean up file
        if test_file_path.exists():
            os.remove(test_file_path)
