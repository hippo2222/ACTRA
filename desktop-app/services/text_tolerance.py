"""
Модуль для обработки толерантности к тексту при проверке ответов.

Поддерживает:
- Нормализацию букв "е" и "ё"
- Нормализацию раскладки клавиатуры (русский текст, набранный в английской раскладке)
- Нормализацию "ы" и "і" (для украинского/белорусского языка)
- Толерантность к опечаткам (расстояние Левенштейна)
- Толерантность к неправильным окончаниям (морфологический анализ)
"""

import re
import logging
import inspect
from collections import namedtuple
from typing import Dict, Any, Optional, Tuple
from functools import lru_cache

logger = logging.getLogger(__name__)

# Python 3.11+ удалил inspect.getargspec, который до сих пор требует pymorphy2.
# Восстанавливаем минимальную реализацию до импорта pymorphy2,
# чтобы морфологический движок мог инициализироваться.
if not hasattr(inspect, "getargspec"):
    from inspect import getfullargspec

    ArgSpec = namedtuple("ArgSpec", "args varargs keywords defaults")

    def _compat_getargspec(func):
        spec = getfullargspec(func)
        return ArgSpec(spec.args, spec.varargs, spec.varkw, spec.defaults)

    inspect.getargspec = _compat_getargspec  # type: ignore[attr-defined]

# Попытка импортировать внешние библиотеки с fallback
try:
    import Levenshtein
    LEVENSHTEIN_AVAILABLE = True
except ImportError:
    LEVENSHTEIN_AVAILABLE = False
    logger.warning("python-Levenshtein не найден, будет использован fallback на difflib")

try:
    from difflib import SequenceMatcher
    DIFFLIB_AVAILABLE = True
except ImportError:
    DIFFLIB_AVAILABLE = False
    logger.warning("difflib недоступен")

try:
    import pymorphy2
    MORPH_ANALYZER = pymorphy2.MorphAnalyzer()
    PYMORPHY2_AVAILABLE = True
except (ImportError, AttributeError, Exception) as e:
    PYMORPHY2_AVAILABLE = False
    MORPH_ANALYZER = None
    logger.warning(f"pymorphy2 недоступен ({e}), будет использован простой стемминг")


def normalize_text_with_yo(text: str) -> str:
    """
    Нормализует текст, заменяя "ё" на "е" для взаимозаменяемости.
    
    Args:
        text: Текст для нормализации
    
    Returns:
        Нормализованный текст
    """
    if not text:
        return ''
    return text.replace('ё', 'е').replace('Ё', 'Е')


def normalize_keyboard_layout(text: str) -> str:
    """
    Нормализует текст, исправляя неправильную раскладку клавиатуры.
    
    Преобразует русский текст, набранный в английской раскладке, обратно в русский.
    Например: "ghbdtn" -> "привет", "ntcn" -> "тест"
    
    Args:
        text: Текст для нормализации
    
    Returns:
        Нормализованный текст
    """
    if not text:
        return ''
    
    # Маппинг английской раскладки на русскую (QWERTY -> ЙЦУКЕН)
    eng_to_rus = {
        'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н', 'u': 'г', 'i': 'ш', 'o': 'щ', 'p': 'з',
        '[': 'х', ']': 'ъ', 'a': 'ф', 's': 'ы', 'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р', 'j': 'о', 'k': 'л',
        'l': 'д', ';': 'ж', "'": 'э', 'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и', 'n': 'т', 'm': 'ь',
        ',': 'б', '.': 'ю', '`': 'ё',
        # Заглавные
        'Q': 'Й', 'W': 'Ц', 'E': 'У', 'R': 'К', 'T': 'Е', 'Y': 'Н', 'U': 'Г', 'I': 'Ш', 'O': 'Щ', 'P': 'З',
        '{': 'Х', '}': 'Ъ', 'A': 'Ф', 'S': 'Ы', 'D': 'В', 'F': 'А', 'G': 'П', 'H': 'Р', 'J': 'О', 'K': 'Л',
        'L': 'Д', ':': 'Ж', '"': 'Э', 'Z': 'Я', 'X': 'Ч', 'C': 'С', 'V': 'М', 'B': 'И', 'N': 'Т', 'M': 'Ь',
        '<': 'Б', '>': 'Ю', '~': 'Ё'
    }
    
    # Подсчитываем количество потенциально неправильных символов
    eng_chars_count = sum(1 for c in text if c.isalpha() and c.lower() in eng_to_rus)
    total_alpha = sum(1 for c in text if c.isalpha())
    
    # Если больше 70% букв выглядят как английские в русской раскладке,
    # значит, это скорее всего русский текст, набранный в английской раскладке
    if total_alpha > 0 and eng_chars_count / total_alpha > 0.7:
        # Конвертируем английские буквы в русские
        converted = ''.join(eng_to_rus.get(c, c) for c in text)
        # Проверяем, выглядит ли результат как русский текст
        rus_chars_count = sum(1 for c in converted if c.isalpha() and ord('а') <= ord(c.lower()) <= ord('я'))
        if rus_chars_count / max(total_alpha, 1) > 0.5:
            # Больше 50% букв стали русскими - значит, это была конвертация
            return converted
    
    # Если не было конвертации, возвращаем исходный текст
    return text


def normalize_y_i(text: str) -> str:
    """
    Нормализует текст, заменяя "ы" на "і" для взаимозаменяемости.
    Это для украинского/белорусского языка, где "ы" и "і" могут быть синонимами.
    
    Args:
        text: Текст для нормализации
    
    Returns:
        Нормализованный текст (ы -> і)
    """
    if not text:
        return ''
    return text.replace('ы', 'і').replace('Ы', 'І')


def normalize_text(text: str, normalize_yo: bool = True, 
                  normalize_layout: bool = True, normalize_y_i: bool = True) -> str:
    """
    Комплексная нормализация текста.
    
    Применяет все виды нормализации в правильном порядке:
    1. Раскладка клавиатуры (если включена)
    2. ы/і (если включена)
    3. е/ё (если включена)
    
    Args:
        text: Текст для нормализации
        normalize_yo: Нормализовать е/ё
        normalize_layout: Нормализовать раскладку клавиатуры
        normalize_y_i: Нормализовать ы/і
    
    Returns:
        Нормализованный текст
    """
    if not text:
        return ''
    
    result = text
    
    # Порядок важен: сначала раскладка, потом остальное
    if normalize_layout:
        result = normalize_keyboard_layout(result)
    
    if normalize_y_i:  # Здесь normalize_y_i - это параметр (bool)
        # Используем globals() для доступа к функции, так как параметр перекрыл её имя
        result = globals()['normalize_y_i'](result)
    
    if normalize_yo:
        result = normalize_text_with_yo(result)
    
    return result


def calculate_levenshtein_distance(word1: str, word2: str) -> int:
    """
    Вычисляет расстояние Левенштейна между двумя словами.
    
    Использует python-Levenshtein если доступен, иначе fallback на difflib.
    
    Args:
        word1: Первое слово
        word2: Второе слово
    
    Returns:
        Расстояние Левенштейна (количество операций для преобразования)
    """
    if not word1 or not word2:
        return max(len(word1), len(word2))
    
    if LEVENSHTEIN_AVAILABLE:
        return Levenshtein.distance(word1, word2)
    elif DIFFLIB_AVAILABLE:
        # Используем SequenceMatcher как fallback
        # ratio возвращает значение от 0 до 1, где 1 - полное совпадение
        similarity = SequenceMatcher(None, word1, word2).ratio()
        # Приблизительно конвертируем в расстояние Левенштейна
        max_len = max(len(word1), len(word2))
        distance = int((1 - similarity) * max_len)
        return distance
    else:
        # Простой fallback: считаем количество разных символов
        # Это не точное расстояние Левенштейна, но лучше чем ничего
        if len(word1) != len(word2):
            return abs(len(word1) - len(word2))
        return sum(1 for a, b in zip(word1, word2) if a != b)


@lru_cache(maxsize=1000)
def get_word_stem(word: str, use_morphology: bool = True) -> str:
    """
    Получает основу слова (лемму) с использованием морфологического анализа.
    
    Использует pymorphy2 если доступен, иначе простой стемминг (отсекание окончания).
    
    Args:
        word: Слово для анализа
        use_morphology: Использовать ли морфологический анализ (если доступен)
    
    Returns:
        Основа слова (лемма)
    """
    if not word:
        return ''
    
    # Нормализуем для анализа
    word_lower = word.lower().strip()
    
    if use_morphology and PYMORPHY2_AVAILABLE and MORPH_ANALYZER:
        try:
            parsed = MORPH_ANALYZER.parse(word_lower)
            if parsed:
                # Берем первую (наиболее вероятную) интерпретацию
                lemma = parsed[0].normal_form
                return lemma
        except Exception as e:
            logger.debug(f"Ошибка морфологического анализа слова '{word}': {e}")
            # Fallback на простой стемминг
    
    # Простой стемминг: отсекаем последние 3 символа (настраиваемо)
    # Это fallback, если морфология недоступна
    if len(word_lower) > 3:
        return word_lower[:-3]
    return word_lower


def check_word_with_typos(user_word: str, correct_word: str, max_typos: int = 2) -> bool:
    """
    Проверяет, совпадает ли слово пользователя с правильным словом с учетом опечаток.
    
    Args:
        user_word: Слово от пользователя
        correct_word: Правильное слово
        max_typos: Максимальное количество допустимых опечаток
    
    Returns:
        True, если слова совпадают с учетом толерантности к опечаткам
    """
    if not user_word or not correct_word:
        return user_word == correct_word
    
    # Нормализуем для сравнения
    user_normalized = normalize_text_with_yo(user_word.lower().strip())
    correct_normalized = normalize_text_with_yo(correct_word.lower().strip())
    
    # Точное совпадение
    if user_normalized == correct_normalized:
        return True
    
    # Проверяем расстояние Левенштейна
    distance = calculate_levenshtein_distance(user_normalized, correct_normalized)
    return distance <= max_typos


def check_word_with_endings(user_word: str, correct_word: str, 
                            use_morphology: bool = True,
                            stemming_chars: int = 3) -> bool:
    """
    Проверяет, совпадает ли слово пользователя с правильным словом с учетом окончаний.
    
    Сравнивает основы слов (леммы) через морфологический анализ или простой стемминг.
    
    Args:
        user_word: Слово от пользователя
        correct_word: Правильное слово
        use_morphology: Использовать ли морфологический анализ
        stemming_chars: Количество символов для отсекания при простом стемминге
    
    Returns:
        True, если основы слов совпадают
    """
    if not user_word or not correct_word:
        return user_word == correct_word
    
    # Получаем основы слов
    user_stem = get_word_stem(user_word, use_morphology)
    correct_stem = get_word_stem(correct_word, use_morphology)
    
    # Нормализуем комплексно (раскладка, ы/і, е/ё)
    user_stem = normalize_text(user_stem, normalize_yo=True, normalize_layout=True, normalize_y_i=True)
    correct_stem = normalize_text(correct_stem, normalize_yo=True, normalize_layout=True, normalize_y_i=True)
    
    return user_stem == correct_stem


def find_keyword_with_tolerance(user_text: str, keyword: str, 
                               config: Optional[Dict[str, Any]] = None) -> bool:
    """
    Ищет ключевое слово в тексте пользователя с учетом всех толерантностей.
    
    Args:
        user_text: Текст от пользователя
        keyword: Ключевое слово для поиска
        config: Конфигурация толерантности:
            - typo_tolerance.max_typos_per_word: максимальное количество опечаток
            - typo_tolerance.use_levenshtein: использовать ли расстояние Левенштейна
            - ending_tolerance.use_morphology: использовать ли морфологический анализ
            - ending_tolerance.stemming_chars: количество символов для стемминга
            - normalize_yo: нормализовать ли е/ё
    
    Returns:
        True, если ключевое слово найдено с учетом толерантностей
    """
    if not user_text or not keyword:
        return False
    
    # Настройки по умолчанию
    default_config = {
        'typo_tolerance': {
            'max_typos_per_word': 2,
            'use_levenshtein': True
        },
        'ending_tolerance': {
            'use_morphology': True,
            'stemming_chars': 3
        },
        'normalize_yo': True,
        'normalize_layout': True,
        'normalize_y_i': True
    }
    
    if config:
        # Объединяем с настройками по умолчанию
        merged_config = default_config.copy()
        if 'typo_tolerance' in config:
            merged_config['typo_tolerance'].update(config['typo_tolerance'])
        if 'ending_tolerance' in config:
            merged_config['ending_tolerance'].update(config['ending_tolerance'])
        if 'normalize_yo' in config:
            merged_config['normalize_yo'] = config['normalize_yo']
        if 'normalize_layout' in config:
            merged_config['normalize_layout'] = config['normalize_layout']
        if 'normalize_y_i' in config:
            merged_config['normalize_y_i'] = config['normalize_y_i']
        config = merged_config
    else:
        config = default_config
    
    # Нормализуем текст и ключевое слово с использованием комплексной нормализации
    user_text_normalized = user_text.lower().strip()
    keyword_normalized = keyword.lower().strip()
    
    user_text_normalized = normalize_text(
        user_text_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    keyword_normalized = normalize_text(
        keyword_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    
    # Разбиваем текст на слова (с учетом границ слов)
    # Используем регулярное выражение для извлечения слов
    word_pattern = r'\b\w+\b'
    user_words = re.findall(word_pattern, user_text_normalized, re.UNICODE)
    
    # Проверяем каждое слово пользователя
    for user_word in user_words:
        # Сначала проверяем точное совпадение
        if user_word == keyword_normalized:
            return True
        
        # Проверяем с учетом окончаний (морфология/стемминг)
        if check_word_with_endings(
            user_word, keyword_normalized,
            use_morphology=config['ending_tolerance'].get('use_morphology', True),
            stemming_chars=config['ending_tolerance'].get('stemming_chars', 3)
        ):
            return True
        
        # Проверяем с учетом опечаток
        if config['typo_tolerance'].get('use_levenshtein', True):
            max_typos = config['typo_tolerance'].get('max_typos_per_word', 2)
            if check_word_with_typos(user_word, keyword_normalized, max_typos):
                return True
    
    return False


def extract_words_from_text(text: str) -> list:
    """
    Извлекает слова из текста с учетом границ слов.
    
    Args:
        text: Текст для обработки
    
    Returns:
        Список слов
    """
    if not text:
        return []
    
    word_pattern = r'\b\w+\b'
    words = re.findall(word_pattern, text, re.UNICODE)
    return words


def compare_words_with_tolerance_info(user_word: str, correct_word: str, 
                                     config: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, str]]:
    """
    Сравнивает два слова с учетом всех толерантностей и возвращает информацию о типе толерантности.
    
    Args:
        user_word: Слово от пользователя
        correct_word: Правильное слово
        config: Конфигурация толерантности
    
    Returns:
        None, если слова не совпадают
        dict с информацией о толерантности: {'type': 'typo'|'ending'|'both'|'exact', 'correct_answer': str, 'user_answer': str}
    """
    if not user_word or not correct_word:
        if user_word == correct_word:
            return {'type': 'exact', 'correct_answer': correct_word, 'user_answer': user_word}
        return None
    
    # Настройки по умолчанию
    default_config = {
        'typo_tolerance': {
            'max_typos_per_word': 2,
            'use_levenshtein': True
        },
        'ending_tolerance': {
            'use_morphology': True,
            'stemming_chars': 3
        },
        'normalize_yo': True,
        'normalize_layout': True,
        'normalize_y_i': True
    }
    
    if config:
        merged_config = default_config.copy()
        if 'typo_tolerance' in config:
            merged_config['typo_tolerance'].update(config['typo_tolerance'])
        if 'ending_tolerance' in config:
            merged_config['ending_tolerance'].update(config['ending_tolerance'])
        if 'normalize_yo' in config:
            merged_config['normalize_yo'] = config['normalize_yo']
        if 'normalize_layout' in config:
            merged_config['normalize_layout'] = config['normalize_layout']
        if 'normalize_y_i' in config:
            merged_config['normalize_y_i'] = config['normalize_y_i']
        config = merged_config
    else:
        config = default_config
    
    # Нормализуем с использованием комплексной нормализации
    user_normalized = user_word.lower().strip()
    correct_normalized = correct_word.lower().strip()
    
    user_normalized_noyo = normalize_text(
        user_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    correct_normalized_noyo = normalize_text(
        correct_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    
    # Точное совпадение (после нормализации).
    # Важно: даже если type='exact', могли сработать нормализации (раскладка/ё/ы-і),
    # это полезно подсвечивать в UI.
    if user_normalized_noyo == correct_normalized_noyo:
        try:
            kinds = []
            if config.get('normalize_layout', True):
                if normalize_keyboard_layout(user_word) != user_word:
                    kinds.append('layout')
            if config.get('normalize_y_i', True):
                if globals()['normalize_y_i'](user_word) != user_word:
                    kinds.append('y_i')
            if config.get('normalize_yo', True):
                if normalize_text_with_yo(user_word) != user_word:
                    kinds.append('yo')
        except Exception:
            kinds = []

        return {
            'type': 'exact',
            'correct_answer': correct_word,
            'user_answer': user_word,
            'normalized_kinds': kinds
        }
    
    # Проверяем с учетом окончаний (только если не точное совпадение)
    ending_match = False
    if check_word_with_endings(
        user_word, correct_word,
        use_morphology=config['ending_tolerance'].get('use_morphology', True),
        stemming_chars=config['ending_tolerance'].get('stemming_chars', 3)
    ):
        # Проверяем, что это не точное совпадение
        if user_normalized_noyo != correct_normalized_noyo:
            ending_match = True
    
    # Проверяем с учетом опечаток (только если не точное совпадение)
    typo_match = False
    if config['typo_tolerance'].get('use_levenshtein', True):
        max_typos = config['typo_tolerance'].get('max_typos_per_word', 2)
        if check_word_with_typos(user_normalized_noyo, correct_normalized_noyo, max_typos):
            # Проверяем, что это не точное совпадение
            if user_normalized_noyo != correct_normalized_noyo:
                typo_match = True
    
    # Определяем тип толерантности
    if ending_match and typo_match:
        return {'type': 'both', 'correct_answer': correct_word, 'user_answer': user_word}
    elif ending_match:
        return {'type': 'ending', 'correct_answer': correct_word, 'user_answer': user_word}
    elif typo_match:
        return {'type': 'typo', 'correct_answer': correct_word, 'user_answer': user_word}
    
    return None


def compare_words_with_tolerance(user_word: str, correct_word: str, 
                                config: Optional[Dict[str, Any]] = None) -> bool:
    """
    Сравнивает два слова с учетом всех толерантностей.
    
    Используется для проверки ответов в тестах уровня 2, где нужно
    сравнивать ответ пользователя с правильным ответом с учетом опечаток,
    окончаний и нормализации е/ё.
    
    Args:
        user_word: Слово от пользователя
        correct_word: Правильное слово
        config: Конфигурация толерантности
    
    Returns:
        True, если слова совпадают с учетом толерантностей
    """
    if not user_word or not correct_word:
        return user_word == correct_word
    
    # Настройки по умолчанию
    default_config = {
        'typo_tolerance': {
            'max_typos_per_word': 2,
            'use_levenshtein': True
        },
        'ending_tolerance': {
            'use_morphology': True,
            'stemming_chars': 3
        },
        'normalize_yo': True,
        'normalize_layout': True,
        'normalize_y_i': True
    }
    
    if config:
        merged_config = default_config.copy()
        if 'typo_tolerance' in config:
            merged_config['typo_tolerance'].update(config['typo_tolerance'])
        if 'ending_tolerance' in config:
            merged_config['ending_tolerance'].update(config['ending_tolerance'])
        if 'normalize_yo' in config:
            merged_config['normalize_yo'] = config['normalize_yo']
        if 'normalize_layout' in config:
            merged_config['normalize_layout'] = config['normalize_layout']
        if 'normalize_y_i' in config:
            merged_config['normalize_y_i'] = config['normalize_y_i']
        config = merged_config
    else:
        config = default_config
    
    # Нормализуем с использованием комплексной нормализации
    user_normalized = user_word.lower().strip()
    correct_normalized = correct_word.lower().strip()
    
    user_normalized = normalize_text(
        user_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    correct_normalized = normalize_text(
        correct_normalized,
        normalize_yo=config.get('normalize_yo', True),
        normalize_layout=config.get('normalize_layout', True),
        normalize_y_i=config.get('normalize_y_i', True)
    )
    
    # Точное совпадение
    if user_normalized == correct_normalized:
        return True
    
    # Проверяем с учетом окончаний
    if check_word_with_endings(
        user_word, correct_word,
        use_morphology=config['ending_tolerance'].get('use_morphology', True),
        stemming_chars=config['ending_tolerance'].get('stemming_chars', 3)
    ):
        return True
    
    # Проверяем с учетом опечаток
    if config['typo_tolerance'].get('use_levenshtein', True):
        max_typos = config['typo_tolerance'].get('max_typos_per_word', 2)
        if check_word_with_typos(user_normalized, correct_normalized, max_typos):
            return True
    
    return False

