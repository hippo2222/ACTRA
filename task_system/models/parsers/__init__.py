"""
Парсеры для импорта заданий из текстовых файлов
"""

from .open_answer_parser import OpenAnswerParser
from .sequence_parser import SequenceParser
from .click_text_parser import ClickTextParser
from .click_words_parser import ClickWordsParser
from .test_import_parser import TestImportParser

__all__ = [
    'OpenAnswerParser',
    'SequenceParser',
    'ClickTextParser',
    'ClickWordsParser',
    'TestImportParser'
]
