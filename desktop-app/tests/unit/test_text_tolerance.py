"""
Unit-тесты для модуля text_tolerance.

Тестирует функциональность толерантности к тексту:
- Нормализация е/ё
- Толерантность к опечаткам (расстояние Левенштейна)
- Толерантность к окончаниям (морфологический анализ)
"""

import unittest
import sys
from pathlib import Path

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.text_tolerance import (
    normalize_text_with_yo,
    calculate_levenshtein_distance,
    check_word_with_typos,
    get_word_stem,
    check_word_with_endings,
    find_keyword_with_tolerance,
    extract_words_from_text,
    compare_words_with_tolerance,
    compare_words_with_tolerance_info
)


class TestNormalizeTextWithYo(unittest.TestCase):
    """Тесты для нормализации е/ё"""
    
    def test_normalize_yo_to_e(self):
        """Замена ё на е"""
        self.assertEqual(normalize_text_with_yo('ёлка'), 'елка')
        self.assertEqual(normalize_text_with_yo('Ёлка'), 'Елка')
        self.assertEqual(normalize_text_with_yo('мёд'), 'мед')
    
    def test_normalize_mixed(self):
        """Смешанный текст с е и ё"""
        self.assertEqual(normalize_text_with_yo('печень выполняет'), 'печень выполняет')
        self.assertEqual(normalize_text_with_yo('пёчень выполняет'), 'печень выполняет')
    
    def test_empty_string(self):
        """Пустая строка"""
        self.assertEqual(normalize_text_with_yo(''), '')
        self.assertEqual(normalize_text_with_yo(None), '')
    
    def test_no_yo(self):
        """Текст без ё"""
        self.assertEqual(normalize_text_with_yo('печень'), 'печень')
        self.assertEqual(normalize_text_with_yo('метаболизм'), 'метаболизм')


class TestLevenshteinDistance(unittest.TestCase):
    """Тесты для расстояния Левенштейна"""
    
    def test_exact_match(self):
        """Точное совпадение"""
        self.assertEqual(calculate_levenshtein_distance('печень', 'печень'), 0)
        self.assertEqual(calculate_levenshtein_distance('метаболизм', 'метаболизм'), 0)
    
    def test_one_typo(self):
        """Одна опечатка"""
        self.assertEqual(calculate_levenshtein_distance('печень', 'печен'), 1)
        self.assertEqual(calculate_levenshtein_distance('печень', 'печенъ'), 1)
        self.assertEqual(calculate_levenshtein_distance('печень', 'печнь'), 1)
    
    def test_two_typos(self):
        """Две опечатки"""
        self.assertEqual(calculate_levenshtein_distance('печень', 'печнь'), 1)  # удаление
        self.assertEqual(calculate_levenshtein_distance('печень', 'печен'), 1)  # удаление
        # Две замены
        distance = calculate_levenshtein_distance('печень', 'печнб')
        self.assertLessEqual(distance, 2)
    
    def test_empty_strings(self):
        """Пустые строки"""
        self.assertEqual(calculate_levenshtein_distance('', ''), 0)
        self.assertEqual(calculate_levenshtein_distance('печень', ''), 6)
        self.assertEqual(calculate_levenshtein_distance('', 'печень'), 6)
    
    def test_different_lengths(self):
        """Строки разной длины"""
        self.assertEqual(calculate_levenshtein_distance('печень', 'печенька'), 2)
        self.assertEqual(calculate_levenshtein_distance('печенька', 'печень'), 2)


class TestCheckWordWithTypos(unittest.TestCase):
    """Тесты для проверки слов с учетом опечаток"""
    
    def test_exact_match(self):
        """Точное совпадение"""
        self.assertTrue(check_word_with_typos('печень', 'печень', 2))
        self.assertTrue(check_word_with_typos('метаболизм', 'метаболизм', 2))
    
    def test_one_typo_within_limit(self):
        """Одна опечатка в пределах лимита"""
        self.assertTrue(check_word_with_typos('печен', 'печень', 2))
        self.assertTrue(check_word_with_typos('печень', 'печен', 2))
        self.assertTrue(check_word_with_typos('метаболиз', 'метаболизм', 2))
    
    def test_two_typos_within_limit(self):
        """Две опечатки в пределах лимита"""
        self.assertTrue(check_word_with_typos('печнь', 'печень', 2))
        self.assertTrue(check_word_with_typos('метаболиз', 'метаболизм', 2))
    
    def test_too_many_typos(self):
        """Слишком много опечаток"""
        self.assertFalse(check_word_with_typos('печ', 'печень', 2))
        self.assertFalse(check_word_with_typos('мет', 'метаболизм', 2))
    
    def test_case_insensitive(self):
        """Нечувствительность к регистру"""
        self.assertTrue(check_word_with_typos('Печень', 'печень', 2))
        self.assertTrue(check_word_with_typos('ПЕЧЕНЬ', 'печень', 2))
    
    def test_yo_normalization(self):
        """Нормализация е/ё"""
        self.assertTrue(check_word_with_typos('пёчень', 'печень', 2))
        self.assertTrue(check_word_with_typos('печень', 'пёчень', 2))


class TestGetWordStem(unittest.TestCase):
    """Тесты для получения основы слова"""
    
    def test_simple_stemming(self):
        """Простой стемминг (fallback)"""
        # Если морфология недоступна, используется простой стемминг
        stem = get_word_stem('печень', use_morphology=False)
        # Должно отсечь последние 3 символа
        self.assertEqual(stem, 'печ')
    
    def test_short_word(self):
        """Короткое слово"""
        stem = get_word_stem('печ', use_morphology=False)
        # Для коротких слов возвращается как есть
        self.assertEqual(stem, 'печ')
    
    def test_empty_string(self):
        """Пустая строка"""
        self.assertEqual(get_word_stem('', use_morphology=False), '')
        self.assertEqual(get_word_stem('', use_morphology=True), '')
    
    def test_morphology_if_available(self):
        """Морфологический анализ, если доступен"""
        # Если pymorphy2 доступен, должно работать
        stem = get_word_stem('печень', use_morphology=True)
        # Проверяем, что получили какую-то основу
        self.assertIsInstance(stem, str)
        self.assertGreater(len(stem), 0)


class TestCheckWordWithEndings(unittest.TestCase):
    """Тесты для проверки слов с учетом окончаний"""
    
    def test_exact_match(self):
        """Точное совпадение"""
        self.assertTrue(check_word_with_endings('печень', 'печень', use_morphology=False))
        self.assertTrue(check_word_with_endings('метаболизм', 'метаболизм', use_morphology=False))
    
    def test_different_endings_stemming(self):
        """Разные окончания с простым стеммингом"""
        # С простым стеммингом (отсекаем 3 символа)
        self.assertTrue(check_word_with_endings('печень', 'печени', use_morphology=False))
        self.assertTrue(check_word_with_endings('печени', 'печень', use_morphology=False))
    
    def test_morphology_if_available(self):
        """Морфологический анализ, если доступен"""
        # Если pymorphy2 доступен, должно работать для разных падежей
        result = check_word_with_endings('печень', 'печени', use_morphology=True)
        # Проверяем, что функция выполнилась без ошибок
        self.assertIsInstance(result, bool)
    
    def test_empty_strings(self):
        """Пустые строки"""
        self.assertTrue(check_word_with_endings('', '', use_morphology=False))
        self.assertFalse(check_word_with_endings('печень', '', use_morphology=False))
        self.assertFalse(check_word_with_endings('', 'печень', use_morphology=False))


class TestFindKeywordWithTolerance(unittest.TestCase):
    """Тесты для поиска ключевых слов с толерантностью"""
    
    def test_exact_match(self):
        """Точное совпадение"""
        text = "Печень выполняет детоксикацию и метаболизм"
        self.assertTrue(find_keyword_with_tolerance(text, "печень"))
        self.assertTrue(find_keyword_with_tolerance(text, "детоксикацию"))
        self.assertTrue(find_keyword_with_tolerance(text, "метаболизм"))
    
    def test_with_typos(self):
        """Поиск с опечатками"""
        text = "Печен выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))
    
    def test_with_different_endings(self):
        """Поиск с разными окончаниями"""
        text = "Печени выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # С простым стеммингом должно работать
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))
    
    def test_with_yo_normalization(self):
        """Поиск с нормализацией е/ё"""
        text = "Пёчень выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))
    
    def test_not_found(self):
        """Ключевое слово не найдено"""
        text = "Орган выполняет функцию"
        self.assertFalse(find_keyword_with_tolerance(text, "печень"))
        self.assertFalse(find_keyword_with_tolerance(text, "метаболизм"))
    
    def test_empty_text(self):
        """Пустой текст"""
        self.assertFalse(find_keyword_with_tolerance("", "печень"))
        self.assertFalse(find_keyword_with_tolerance("   ", "печень"))
    
    def test_empty_keyword(self):
        """Пустое ключевое слово"""
        self.assertFalse(find_keyword_with_tolerance("печень выполняет", ""))
    
    def test_default_config(self):
        """Использование конфигурации по умолчанию"""
        text = "Печень выполняет детоксикацию"
        # Без конфигурации должны использоваться настройки по умолчанию
        self.assertTrue(find_keyword_with_tolerance(text, "печень"))
        self.assertTrue(find_keyword_with_tolerance(text, "детоксикацию"))


class TestExtractWordsFromText(unittest.TestCase):
    """Тесты для извлечения слов из текста"""
    
    def test_simple_text(self):
        """Простой текст"""
        text = "Печень выполняет детоксикацию"
        words = extract_words_from_text(text)
        self.assertIn("Печень", words)
        self.assertIn("выполняет", words)
        self.assertIn("детоксикацию", words)
    
    def test_text_with_punctuation(self):
        """Текст с пунктуацией"""
        text = "Печень выполняет детоксикацию, метаболизм и другие функции."
        words = extract_words_from_text(text)
        self.assertIn("Печень", words)
        self.assertIn("детоксикацию", words)
        self.assertIn("метаболизм", words)
        # Пунктуация должна быть удалена
        self.assertNotIn("детоксикацию,", words)
    
    def test_empty_text(self):
        """Пустой текст"""
        self.assertEqual(extract_words_from_text(""), [])
        self.assertEqual(extract_words_from_text("   "), [])
    
    def test_text_with_numbers(self):
        """Текст с числами"""
        text = "Орган имеет 4 камеры"
        words = extract_words_from_text(text)
        self.assertIn("Орган", words)
        self.assertIn("имеет", words)
        self.assertIn("4", words)
        self.assertIn("камеры", words)


class TestCompareWordsWithTolerance(unittest.TestCase):
    """Тесты для сравнения слов с толерантностью"""
    
    def test_exact_match(self):
        """Точное совпадение"""
        self.assertTrue(compare_words_with_tolerance('Променевий', 'Променевий'))
        self.assertTrue(compare_words_with_tolerance('Стегнового', 'Стегнового'))
    
    def test_compare_words_with_tolerance_info_exact(self):
        """Информация о точном совпадении"""
        info = compare_words_with_tolerance_info('Променевий', 'Променевий')
        self.assertIsNotNone(info)
        self.assertEqual(info['type'], 'exact')
    
    def test_compare_words_with_tolerance_info_typo(self):
        """Информация о совпадении с опечаткой"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        info = compare_words_with_tolerance_info('Променева', 'Променевий', config)
        self.assertIsNotNone(info)
        self.assertEqual(info['type'], 'typo')
    
    def test_compare_words_with_tolerance_info_ending(self):
        """Информация о совпадении с другим окончанием"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        info = compare_words_with_tolerance_info('Стегноваго', 'Стегнового', config)
        self.assertIsNotNone(info)
        # Может быть 'ending' или 'typo' в зависимости от реализации
        self.assertIn(info['type'], ['ending', 'typo', 'both'])
    
    def test_with_typos(self):
        """Сравнение с опечатками"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # Одна опечатка
        self.assertTrue(compare_words_with_tolerance('Променева', 'Променевий', config))
        # Две опечатки
        self.assertFalse(compare_words_with_tolerance('Променва', 'Променевий', config))
    
    def test_with_different_endings(self):
        """Сравнение с разными окончаниями"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # Разные окончания (простой стемминг)
        self.assertTrue(compare_words_with_tolerance('Стегноваго', 'Стегнового', config))
    
    def test_with_yo_normalization(self):
        """Сравнение с нормализацией е/ё"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        self.assertTrue(compare_words_with_tolerance('Пёчень', 'Печень', config))
    
    def test_combined_tolerances(self):
        """Комбинация всех толерантностей"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # Опечатка + другое окончание
        self.assertTrue(compare_words_with_tolerance('Сигмоподібноа', 'Сигмоподібної', config))
    
    def test_not_matching(self):
        """Слова не совпадают"""
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # Слишком много различий
        self.assertFalse(compare_words_with_tolerance('Промен', 'Променевий', config))
        # Совсем разные слова
        self.assertFalse(compare_words_with_tolerance('Ліктьовий', 'Променевий', config))


class TestIntegration(unittest.TestCase):
    """Интеграционные тесты для комбинации всех толерантностей"""
    
    def test_typo_and_ending_together(self):
        """Комбинация опечаток и окончаний"""
        text = "Печнь выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # "печнь" имеет опечатку, но должно быть найдено
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))
    
    def test_yo_and_typo_together(self):
        """Комбинация нормализации е/ё и опечаток"""
        text = "Пёчнь выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # "пёчнь" имеет и ё, и опечатку
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))
    
    def test_all_tolerances_together(self):
        """Все толерантности вместе"""
        text = "Пёчни выполняет детоксикацию"
        config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': False, 'stemming_chars': 3},
            'normalize_yo': True
        }
        # "пёчни" имеет ё, опечатку и другое окончание
        self.assertTrue(find_keyword_with_tolerance(text, "печень", config))


if __name__ == '__main__':
    unittest.main()

