import os
import sys
import json
import zipfile
import datetime

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    t1_path = os.path.join(base_dir, "table_5_1_tela_stratification.json")
    t2_path = os.path.join(base_dir, "table_5_2_pneumothorax_differentiation.json")
    
    with open(t1_path, "r", encoding="utf-8") as f:
        t1 = json.load(f)
    t1["name"] = t1.get("name") or t1.get("meta", {}).get("name") or "Таблица 5.1: Стратификация риска и реперфузия при ТЭЛА"
    t1["task_schema_version"] = "1.2"
    
    with open(t2_path, "r", encoding="utf-8") as f:
        t2 = json.load(f)
    t2["name"] = t2.get("name") or t2.get("meta", {}).get("name") or "Таблица 5.2: Дифференциация синдрома затенения и просветления гемиторакса"
    t2["task_schema_version"] = "1.2"
    
    # Save back canonical tasks
    with open(t1_path, "w", encoding="utf-8") as f:
        json.dump(t1, f, indent=2, ensure_ascii=False)
    with open(t2_path, "w", encoding="utf-8") as f:
        json.dump(t2, f, indent=2, ensure_ascii=False)
        
    mod_id = "neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya"
    mod_name = "Неотложные состояния: Пульмонология и Кардиология"
    top_id = "differentsialnaya_diagnostika_i_stratifikatsiya_riska"
    top_name = "Дифференциальная диагностика и стратификация риска"
    
    def build_archive(filename, tasks):
        archive_path = os.path.join(base_dir, filename)
        now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        manifest = {
            "export_date": now_str,
            "app_version": "1.1.0",
            "export_type": "tasks",
            "total_tasks": len(tasks),
            "contains": {
                "modules": [mod_id],
                "topics": [top_id],
                "tasks": [t["id"] for t in tasks]
            },
            "module_names": {
                mod_id: mod_name
            },
            "topic_names": {
                mod_id: {
                    top_id: top_name
                }
            }
        }
        
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # Write manifest.json
            zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"))
            # Write tasks
            for t in tasks:
                task_id = t["id"]
                arc_path = f"modules/{mod_id}/topics/{top_id}/tasks/{task_id}/task.json"
                zf.writestr(arc_path, json.dumps(t, indent=2, ensure_ascii=False).encode("utf-8"))
        
        print(f"Created: {archive_path} ({os.path.getsize(archive_path)} bytes)")
        return archive_path

    # 1. Combined bundle (both tasks)
    build_archive("tasks_export_clinical_hierarchies.zip", [t1, t2])
    # 2. Individual Task 5.1 (ТЭЛА)
    build_archive("tasks_export_table_5_1_tela_stratification.zip", [t1])
    # 3. Individual Task 5.2 (Пневмоторакс / ателектаз / плеврит)
    build_archive("tasks_export_table_5_2_pneumothorax_differentiation.zip", [t2])

if __name__ == "__main__":
    main()
