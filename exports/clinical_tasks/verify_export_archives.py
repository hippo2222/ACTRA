import os
import sys
import tempfile
from pathlib import Path

# Add desktop-app to path
sys.path.insert(0, os.path.abspath("desktop-app"))

from services.import_export_service import ImportExportService
from services.storage_service import StorageService

def test_validation():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # We test with a fresh isolated storage directory to model a target server
    temp_dir = tempfile.mkdtemp(prefix="test_prod_storage_")
    storage = StorageService(data_dir=temp_dir)
    svc = ImportExportService(storage_service=storage)
    
    zip_files = [
        "tasks_export_clinical_hierarchies.zip",
        "tasks_export_table_5_1_tela_stratification.zip",
        "tasks_export_table_5_2_pneumothorax_differentiation.zip"
    ]
    
    for zf_name in zip_files:
        zf_path = os.path.join(base_dir, zf_name)
        report = svc.validate_import_archive(zf_path)
        print(f"\n--- Validation Report for {zf_name} ---")
        print(f"OK: {report.get('ok')}")
        print(f"Summary: {report.get('summary')}")
        print(f"Errors: {report.get('errors')}")
        print(f"Warnings: {report.get('warnings', [])}")
        assert report.get("ok") is True, f"Validation failed for {zf_name}"
        assert report["summary"]["errors"] == 0, f"Errors found in {zf_name}: {report['errors']}"
        assert report["summary"]["valid"] > 0, f"No valid tasks in {zf_name}"
    
    print("\nALL ARCHIVES SUCCESSFULLY VALIDATED BY ACTRA IMPORT SERVICE!")

if __name__ == "__main__":
    test_validation()
