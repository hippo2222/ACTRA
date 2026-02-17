import os
import glob

PROJECT_ROOT = "d:/Ai Ai/radioproject"

def cleanup():
    # Target specific patterns with non-standard characters
    patterns = [
        "frontend/TestUI/*IMG*.html",
        "frontend/TestUI/*L1*.html",
        "frontend/TestUI/*L2*.html" 
    ]
    
    deleted_count = 0
    for pattern in patterns:
        full_pattern = os.path.join(PROJECT_ROOT, pattern)
        files = glob.glob(full_pattern)
        for f in files:
            # Double check it's not a file we want to keep (though we reviewed these lists)
            # We decided to delete IMG*, L1*, L2* HTMLs in TestUI as they are mocks
            try:
                os.remove(f)
                print(f"Deleted: {f}")
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting {f}: {e}")
                
    print(f"Cleanup complete. Deleted {deleted_count} stubborn files.")

def create_dirs():
    dirs = [
        "frontend/assets/images",
        "frontend/assets/images/dashboard",
        "frontend/assets/images/avatars",
        "frontend/assets/images/tasks",
        "frontend/assets/images/calendar"
    ]
    for d in dirs:
        path = os.path.join(PROJECT_ROOT, d)
        os.makedirs(path, exist_ok=True)
        print(f"Created directory: {d}")

if __name__ == "__main__":
    cleanup()
    create_dirs()
