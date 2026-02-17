"""
Инструмент для валидации всех заданий в базе данных (Area 4.4).
Проверяет структуру данных и выявляет задания с отсутствующими полями.

Запуск:
python desktop-app/tools/validate_tasks.py
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Dict, Any

# Добавляем путь к проекту для импортов, если потребуется
current_dir = Path(__file__).parent.resolve()
project_root = current_dir.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

def validate_task(task_path: Path) -> List[Dict[str, Any]]:
    """
    Валидирует задание и возвращает список найденных проблем.
    
    Returns:
        Список словарей с описанием проблем.
    """
    issues = []
    
    try:
        with open(task_path, 'r', encoding='utf-8') as f:
            task_data = json.load(f)
    except Exception as e:
        return [{'severity': 'error', 'field': 'file', 'message': f'JSON Load Error: {e}', 'location': str(task_path)}]
    
    # Проверка answer_key
    answer_key = task_data.get('answer_key', {})
    if not answer_key:
         # Для некоторых типов (Theory) answer_key может не быть
         task_type = task_data.get('type')
         if task_type != 'theory':
            issues.append({'severity': 'info', 'field': 'answer_key', 'message': 'Missing answer_key (might be fine for theory)', 'location': 'root'})
    
    targets = answer_key.get('targets', [])
    
    content = task_data.get('content', {})
    requires_labels = content.get('requires_labels', False)

    for idx, target in enumerate(targets):
        # Проверка наличия shape
        # Задания типа Point, Polygon, Freehand должны иметь shape
        # Но формат может быть разным. Simple check.
        if 'shape' not in target and 'type' not in target:
             # Проверяем неявные признаки (points)
             points = target.get('points')
             coord = target.get('coordinates') or target.get('point')
             
             if not points and not coord:
                issues.append({
                    'severity': 'warning',
                    'field': f'answer_key.targets[{idx}].shape',
                    'message': 'Target shape not specified and no points/coordinates found',
                    'location': f'target index {idx}'
                })
             else:
                issues.append({
                    'severity': 'warning',
                    'field': f'answer_key.targets[{idx}].shape',
                    'message': 'Target shape not explicitly specified (will be auto-detected)',
                    'location': f'target index {idx}'
                })
        
        # Проверка наличия label для уровней >= 2
        if requires_labels:
            if 'label' not in target:
                 issues.append({
                    'severity': 'error',
                    'field': f'answer_key.targets[{idx}].label',
                    'message': 'Label required by task content but not specified in target',
                    'location': f'target index {idx}'
                })
            elif not target.get('label'):
                 issues.append({
                    'severity': 'error',
                    'field': f'answer_key.targets[{idx}].label',
                    'message': 'Label is empty/null',
                    'location': f'target index {idx}'
                })
    
    return issues

def main():
    """Сканирует все задания и выводит отчет о проблемах"""
    # Assuming standard data path
    tasks_dir = project_root / 'data' / 'modules'
    if not tasks_dir.exists():
        # Fallback to just data if modules not found (or maybe structure is flat)
        tasks_dir = project_root / 'data'
        print(f"Directory not found: {tasks_dir}")
        return

    all_issues = {}
    count = 0
    
    print(f"Scanning tasks in {tasks_dir}...")
    
    for task_file in tasks_dir.rglob('task.json'):
        count += 1
        issues = validate_task(task_file)
        if issues:
            # Filter info/warnings if needed
            all_issues[str(task_file)] = issues
    
    # Вывод отчета
    print(f"\n--- Validation Report ---")
    print(f"Tasks scanned: {count}")
    print(f"Tasks with issues: {len(all_issues)}")
    
    if all_issues:
        print("\nDetails:")
        for task_path, issues in all_issues.items():
            print(f"\nFile: {task_path}")
            for issue in issues:
                tag = f"[{issue['severity'].upper()}]"
                print(f"  {tag:<10} {issue['field']}: {issue['message']} ({issue['location']})")

if __name__ == '__main__':
    main()
