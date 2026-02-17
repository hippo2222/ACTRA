"""
Централизованные сообщения для системы оценивания (Area 4.4).
Используются на Backend (TaskEvaluatorService) и раздаются на Frontend через API.
"""

from typing import Dict, Any

MESSAGES = {
    # -------------------------------------------------------------------------
    # Click Task
    # -------------------------------------------------------------------------
    "click_success_all": "✅ Правильно! Вы правильно указали на все {found_count} аннотаций",
    "click_success_partial_threshold": "✅ Правильно! Вы правильно указали на {found_count} из {required_correct} требуемых аннотаций (всего {total_count})",
    
    "click_fail_basic": "❌ Вы нашли {found_count} из {total_count} аннотаций. Попробуйте еще раз!",
    "click_fail_threshold": "❌ Вы нашли {found_count} из {required_correct} требуемых аннотаций (всего {total_count}). Попробуйте еще раз!",
    
    "click_labels_missing": "❌ Введите названия для найденных областей",
    "click_labels_missing_threshold": "❌ Введите названия для найденных областей ({found_count}/{required_correct} требуется из {total_count})",
    "click_labels_missing_all": "❌ Введите названия для найденных областей ({found_count}/{total_count})",
    
    "click_combined_success": "✅ Правильно! Найдено областей: {found_count}/{total_count}, {labels_message}",
    "click_combined_success_threshold": "✅ Правильно! Найдено областей: {found_count}/{required_correct} требуется (из {total_count}), {labels_message}",
    
    "click_combined_fail": "❌ Найдено областей: {found_count}/{total_count}, но {labels_message}",
    "click_combined_fail_threshold": "❌ Найдено областей: {found_count}/{required_correct} требуется (из {total_count}), но {labels_message}",

    # -------------------------------------------------------------------------
    # Draw Task
    # -------------------------------------------------------------------------
    "draw_no_targets": "Нет эталонных областей",
    "draw_no_polygons": "Сначала нарисуйте контуры",
    "draw_labels_missing": "Введите названия для всех целей",
    
    "draw_success": "✅ Отлично! Покрытие: {coverage:.1f}% (минимум {threshold}%)",
    "draw_fail": "❌ Нужно улучшить. Покрытие: {coverage:.1f}% (минимум {threshold}%)",
    
    # -------------------------------------------------------------------------
    # Labels (General)
    # -------------------------------------------------------------------------
    "labels_success_all": "✅ Все названия правильные ({matched_count}/{total_labels})",
    "labels_success_tolerance": "✅ Все названия правильные ({matched_count}/{total_labels}) ⚠️ (с учетом толерантности)",
    "labels_fail": "❌ Не все названия правильные ({matched_count}/{total_labels})",
    "labels_fail_score": "❌ Верно названо: {matched_count}/{total_labels} ({score:.1f}%)",
    
    "label_correct": "✅ Правильное название: {correct_label}",
    "label_correct_tolerance": "✅ Правильное название: {correct_label} ⚠️ (с учетом толерантности)",
    "label_wrong": "❌ Неправильное название. Правильно: {correct_label}",

    # -------------------------------------------------------------------------
    # Generic Errors
    # -------------------------------------------------------------------------
    "error_no_targets": "❌ Нет правильных ответов для проверки",
    "error_generic": "Ошибка оценивания",
}

def get_message(key: str, **kwargs: Any) -> str:
    """
    Получить сообщение по ключу с безопасным форматированием.
    
    Args:
        key: Ключ сообщения в словаре MESSAGES
        **kwargs: Аргументы для .format()
        
    Returns:
        Отформатированная строка или сам ключ, если сообщение не найдено/ошибка.
    """
    template = MESSAGES.get(key)
    if template is None:
        return key
        
    try:
        return template.format(**kwargs)
    except Exception:
        # В случае ошибки форматирования возвращаем шаблон как есть (лучше чем крэш)
        return template
