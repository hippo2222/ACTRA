"""
Evaluator Hooks - Точки расширения для оценки заданий

Позволяет плагинам добавлять обработчики до и после оценки заданий.
"""

from typing import Dict, Any, Callable, Optional
from ..hooks.hook_registry import hook_registry


class EvaluatorHooks:
    """
    Класс для работы с evaluator hooks.
    
    Предоставляет точки расширения для модификации процесса оценки заданий.
    """
    
    HOOK_PRE_EVALUATE = "evaluator.hooks.pre_evaluate"
    HOOK_POST_EVALUATE = "evaluator.hooks.post_evaluate"
    
    @staticmethod
    def register_pre_evaluate(plugin_id: str, handler: Callable[[str, Any, Dict[str, Any]], Optional[Dict[str, Any]]],
                              priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый до оценки задания.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (task_type, user_input, answer_key)
                     и возвращающая модифицированные данные или None
            priority: Приоритет обработчика
        """
        hook_registry.register(
            EvaluatorHooks.HOOK_PRE_EVALUATE,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def register_post_evaluate(plugin_id: str, handler: Callable[[str, Any, Dict[str, Any]], Optional[Dict[str, Any]]],
                               priority: int = 0) -> None:
        """
        Регистрирует обработчик, вызываемый после оценки задания.
        
        Args:
            plugin_id: ID плагина
            handler: Функция, принимающая (task_type, user_input, answer_key, result)
                     и возвращающая модифицированный результат или None.
                     result содержит поля: success, score, message, metric, details.
                     handler может модифицировать любое из этих полей, включая metric.
            priority: Приоритет обработчика
        """
        hook_registry.register(
            EvaluatorHooks.HOOK_POST_EVALUATE,
            handler,
            plugin_id=plugin_id,
            priority=priority
        )
    
    @staticmethod
    def call_pre_evaluate(task_type: str, user_input: Any, answer_key: Dict[str, Any]) -> tuple:
        """
        Вызывает все обработчики pre_evaluate.
        
        Args:
            task_type: Тип задания
            user_input: Ввод пользователя
            answer_key: Ключ ответа
        
        Returns:
            Кортеж (modified_user_input, modified_answer_key) или исходные значения
        """
        results = hook_registry.call(EvaluatorHooks.HOOK_PRE_EVALUATE, task_type, user_input, answer_key)
        
        # Применяем модификации последовательно
        modified_user_input = user_input
        modified_answer_key = answer_key
        
        for result in results:
            if result is not None:
                if isinstance(result, dict):
                    # Результат может содержать модифицированные данные
                    if 'user_input' in result:
                        modified_user_input = result['user_input']
                    if 'answer_key' in result:
                        modified_answer_key = result['answer_key']
        
        return modified_user_input, modified_answer_key
    
    @staticmethod
    def call_post_evaluate(task_type: str, user_input: Any, answer_key: Dict[str, Any], 
                          result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Вызывает все обработчики post_evaluate.
        
        Args:
            task_type: Тип задания
            user_input: Ввод пользователя
            answer_key: Ключ ответа
            result: Результат оценки (может содержать поля: success, score, message, metric, details)
        
        Returns:
            Модифицированный результат или исходный.
            Результат может содержать поле "metric" ("IoU" | "distance" | "percent"),
            которое hooks могут модифицировать.
        """
        results = hook_registry.call(EvaluatorHooks.HOOK_POST_EVALUATE, task_type, user_input, answer_key, result)
        
        # Применяем модификации последовательно
        modified_result = result
        
        for result_mod in results:
            if result_mod is not None:
                if isinstance(result_mod, dict):
                    # Объединяем модификации
                    modified_result = {**modified_result, **result_mod}
        
        return modified_result
    
    @staticmethod
    def unregister_all(plugin_id: str) -> None:
        """
        Отменяет регистрацию всех evaluator hooks плагина.
        
        Args:
            plugin_id: ID плагина
        """
        hook_registry.unregister_all_for_plugin(plugin_id)


# Глобальный экземпляр
evaluator_hooks = EvaluatorHooks()





