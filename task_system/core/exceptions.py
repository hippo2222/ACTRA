"""
Единая система исключений проекта ACTRA.

Предоставляет иерархию исключений для обработки ошибок
в различных компонентах системы.
"""


class ActraError(Exception):
    """
    Базовое исключение проекта.
    
    Все специфичные исключения проекта наследуются от этого класса.
    Поддерживает дополнительную информацию через параметр details.
    
    Args:
        message: Сообщение об ошибке
        details: Словарь с дополнительным контекстом ошибки
    """
    
    def __init__(self, message: str, details: dict = None):
        """
        Инициализация исключения.
        
        Args:
            message: Сообщение об ошибке
            details: Словарь с дополнительной информацией (plugin_id, path, etc.)
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}
    
    def __str__(self):
        """Строковое представление исключения."""
        if self.details:
            details_str = ", ".join(f"{k}={v}" for k, v in self.details.items())
            return f"{self.message} ({details_str})"
        return self.message


class TaskLoadError(ActraError):
    """
    Ошибка при загрузке задания.
    
    Выбрасывается при ошибках:
    - Файл задания не найден (FileNotFoundError)
    - Ошибка чтения JSON (JSONDecodeError)
    - Ошибка доступа к файлам
    """
    pass


class EvaluationError(ActraError):
    """
    Ошибка при оценке ответа пользователя.
    
    Выбрасывается при ошибках:
    - Некорректные данные ответа пользователя
    - Ошибки в процессе оценки
    - Несовместимость типов данных
    """
    pass


class PluginError(ActraError):
    """
    Ошибка при работе с плагинами.
    
    Выбрасывается при ошибках:
    - Загрузка плагина
    - Инициализация плагина (setup)
    - Выгрузка плагина (teardown)
    - Выполнение hooks плагинов
    """
    pass


class TaskValidationError(ActraError):
    """
    Ошибка валидации задания.
    
    Выбрасывается при ошибках:
    - Невалидная структура данных задания
    - Ошибки валидации через Pydantic
    - Отсутствие обязательных полей
    
    Поддерживает список ошибок валидации для детального отчета.
    """
    
    def __init__(self, message: str, errors: list = None, details: dict = None):
        """
        Инициализация ошибки валидации.
        
        Args:
            message: Сообщение об ошибке
            errors: Список ошибок валидации (например, от Pydantic)
            details: Дополнительный контекст
        """
        super().__init__(message, details)
        self.errors = errors or []
    
    def __str__(self):
        """Строковое представление с деталями ошибок."""
        base_str = super().__str__()
        if self.errors:
            error_details = "\n".join(
                f"  - {err.get('loc', 'unknown')}: {err.get('msg', 'unknown error')}"
                if isinstance(err, dict)
                else f"  - {err}"
                for err in self.errors
            )
            return f"{base_str}\n{error_details}"
        return base_str














































