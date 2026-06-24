import pytest
import os
from pathlib import Path

# Mark this file as an integration/e2e test
pytestmark = pytest.mark.integration

def test_ai_generation_full_cycle_e2e(page, local_server):
    """
    Simulates a user going through the AI generation import cycle.
    """
    # 1. Capture console output and intercept settings to disable onboarding tour
    page.on("console", lambda msg: print(f"\n--- BROWSER CONSOLE [{msg.type}]: {msg.text}"))
    
    page.route("**/api/ui/settings", lambda route: route.fulfill(
        json={"ok": True, "settings": {"onboarding": {"disabled": True}}}
    ))

    # 2. Open the UI Editor where the import modal is located
    page.goto(f"{local_server}/editor")
    page.wait_for_selector("body")
    
    # Wait for the dashboard catalog to load
    page.wait_for_function("() => window.dashboard && window.dashboard.catalog && window.dashboard.catalog.length > 0", timeout=15000)

    # Open the import modal directly via JS to avoid localization and scrim dependency, override in-development flag
    page.evaluate("""
        if(window.dashboard && window.dashboard.importManager) {
            window.dashboard.importManager.isInternalAiGenerationInDevelopment = () => false;
            window.dashboard.showImportModal();
            window.dashboard.importManager.setImportMode('ai');
            window.dashboard.importManager.goToStep(1);
        }
    """)

    # Wait for the re-rendering of AI mode step 1 to complete (the button gets highlighted)
    page.locator("[data-role='import-mode-ai'].border-primary").wait_for()

    # 3. We need to select a module and topic inside the modal dynamically
    # Wait for the module select to have at least one valid option (non-empty value)
    page.wait_for_function("""
        () => {
            const select = document.getElementById('import-module-select');
            return select && Array.from(select.options).some(opt => opt.value !== "");
        }
    """, timeout=15000)

    # Resolve and select the first valid module option
    module_value = page.evaluate("""
        () => {
            const select = document.getElementById('import-module-select');
            const validOpt = Array.from(select.options).find(opt => opt.value !== "");
            return validOpt ? validOpt.value : null;
        }
    """)
    assert module_value is not None, "No valid module option found in dropdown"
    page.locator("#import-module-select").select_option(value=module_value)

    # Wait for the topic select to have at least one valid option (non-empty value)
    page.wait_for_function("""
        () => {
            const select = document.getElementById('import-topic-select');
            return select && Array.from(select.options).some(opt => opt.value !== "");
        }
    """, timeout=15000)

    # Resolve and select the first valid topic option
    topic_value = page.evaluate("""
        () => {
            const select = document.getElementById('import-topic-select');
            const validOpt = Array.from(select.options).find(opt => opt.value !== "");
            return validOpt ? validOpt.value : null;
        }
    """)
    assert topic_value is not None, "No valid topic option found in dropdown"
    page.locator("#import-topic-select").select_option(value=topic_value)

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
