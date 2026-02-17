import os
import shutil

PROJECT_ROOT = "d:/Ai Ai/radioproject"

FILES_TO_DELETE = [
    "frontend/Calendar/A.html",
    "frontend/Calendar/B.html",
    "frontend/Calendar/C.html",
    "frontend/ClickUI/Click L1_A.html",
    "frontend/ClickUI/Click L1_B.html",
    "frontend/ClickUI/Click L1_C.html",
    "frontend/ClickUI/Dif1LeftBar.html",
    "frontend/ClickUI/L2_B.html",
    "frontend/Complexes/Template_1.html",
    "frontend/Complexes/Template_2.html",
    "frontend/DrawUI/DrawUI.smoke.html",
    "frontend/Editor/Open Answer Editor Textual Reasoning.html",
    "frontend/Editor/Point_Annotation.html",
    "frontend/Editor/Region_Segmentation.html",
    "frontend/Editor/Sequence Assembly Editor Procedural Steps.html",
    "frontend/Editor/Test Task Editor Multiple Choice.html",
    "frontend/MainScreen/Template.html",
    "frontend/MainScreen/editorbutton.html",
    "frontend/OpenAnswerUI/OA1.html",
    "frontend/OpenAnswerUI/OA2.html",
    "frontend/OpenAnswerUI/OA4.html",
    "frontend/S1/code.html",
    "frontend/S2/code.html",
    "frontend/S3/code.html",
    "frontend/SequenceUI/Dif2_1.html",
    "frontend/SequenceUI/Dif2_2.html",
    "frontend/SequenceUI/template_1.html",
    "frontend/SequenceUI/template_2.html",
    "frontend/SequenceUI/template_3.html",
    "frontend/SequenceUI/template_4.html",
    "frontend/SequenceUI/template_5.html",
    "frontend/SequenceUI/template_6.html",
    "frontend/TestUI/IMG-A1.html",
    "frontend/TestUI/IMG-Q1.html",
    "frontend/TestUI/L1-SPEC.html",
    "frontend/TestUI/L1-T1 Multiple Answers.html",
    "frontend/TestUI/l1-t1.html",
    "frontend/TestUI/L1-M1.html",
    "frontend/TestUI/L1-T3.html",
    "frontend/TestUI/L2-SPEC-review.html",
    "frontend/TestUI/L2-O1.html",
    "frontend/TestUI/L2-O2.html",
    "frontend/TestUI/testui-trainer.html",
    # Test Files
    "frontend/Editor/base_editor_test.html",
    "frontend/Editor/draw_editor_tests.html",
    "frontend/Editor/open_answer_editor_tests.html",
    "frontend/Editor/phase3_tests.html",
    "frontend/Editor/sequence_editor_tests.html",
    "frontend/Editor/test_editor_tests.html",
    "frontend/MainScreen/statistics_widget_tests.html",
    "frontend/MainScreen/run_tests_ui.py",
    "frontend/S1/s1_tests.html"
]

DIRS_TO_DELETE = [
    "frontend/MistakesClickUI",
    "frontend/MistakesDo",
    "frontend/StatisticsSCR"
]

def main():
    print("Starting cleanup...")
    deleted_count = 0
    
    # Delete Files
    for rel_path in FILES_TO_DELETE:
        full_path = os.path.join(PROJECT_ROOT, rel_path)
        if os.path.exists(full_path):
            try:
                os.remove(full_path)
                print(f"Deleted file: {rel_path}")
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting {rel_path}: {e}")
        else:
            print(f"File not found (already deleted?): {rel_path}")

    # Delete Directories
    for rel_path in DIRS_TO_DELETE:
        full_path = os.path.join(PROJECT_ROOT, rel_path)
        if os.path.exists(full_path):
            try:
                shutil.rmtree(full_path)
                print(f"Deleted directory: {rel_path}")
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting directory {rel_path}: {e}")
        else:
            print(f"Directory not found: {rel_path}")

    print(f"Cleanup complete. Deleted {deleted_count} items.")

if __name__ == "__main__":
    main()
