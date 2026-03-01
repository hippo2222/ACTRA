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
    # Assuming "/ui/editor" is the main entry for complexes and has the import button.
    page.goto(f"{local_server}/ui/editor")

    # The actual selector for the open import modal button might vary.
    # Searching for generic terms if exact ID is unknown. 
    # Let's try to click the first button that opens the import modal.
    # From import_manager.js it seems there is a 'dashboard.importManager.goToStep(1)'
    # We will trigger it via JS if we can't find the button easily, but normally
    # there is a button like [data-role="import-open"] or similar.
    # Wait for the page to load
    page.wait_for_selector("body")

    # If we don't know the exact button to open the modal, we can open it via JS
    # since we know dashboard.openImportModal() or similar exists.
    # But let's look for a button containing "Импорт"
    import_btn = page.locator("button", has_text="Импорт")
    if import_btn.count() > 0:
        import_btn.first.click()
    else:
        # Fallback to JS invocation if the button is hidden in a menu
        page.evaluate("if(window.dashboard && window.dashboard.importManager) { window.dashboard.importManager.setImportMode('ai'); window.dashboard.importManager.goToStep(1); window.dashboard.openModal('import-tasks-modal'); }")

    # 2. In step 1, select AI mode if not already active
    # The button with text "ИИ-генерация"
    ai_mode_btn = page.locator("button", has_text="ИИ-генерация")
    ai_mode_btn.click()

    # 3. We need to select a module and topic inside the modal
    # Select first module
    page.locator("#import-module-select").select_option(index=1)
    # Give time for topic select to populate
    page.wait_for_timeout(500)
    page.locator("#import-topic-select").select_option(index=1)

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
        page.wait_for_selector("input[data-ai-rec-type]", timeout=90000)

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
