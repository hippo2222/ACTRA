"""
VersionChecker - Проверка совместимости версий

Проверяет совместимость версий плагинов с версией ядра системы
используя Semantic Versioning и формат спецификации версий (pip-style).
"""

import re
from typing import List, Tuple, Optional
from packaging import version as packaging_version
from packaging.specifiers import SpecifierSet


class VersionChecker:
    """
    Класс для проверки совместимости версий.
    
    Поддерживает формат спецификации версий в стиле pip:
    - ">=1.0.0,<2.0.0"
    - "==1.2.3"
    - "~=1.0.0" (эквивалентно >=1.0.0,<2.0.0)
    """
    
    @staticmethod
    def is_compatible(version_spec: str, core_version: str) -> bool:
        """
        Проверяет совместимость версии ядра с требованиями плагина.
        
        Args:
            version_spec: Спецификация версии в формате pip (например ">=1.0.0,<2.0.0")
            core_version: Текущая версия ядра (например "1.0.0")
        
        Returns:
            True, если версия ядра удовлетворяет требованиям
        
        Raises:
            ValueError: Если формат версии или спецификации некорректен
        """
        try:
            # Используем packaging для парсинга спецификации
            specifier_set = SpecifierSet(version_spec)
            return specifier_set.contains(core_version)
        except Exception as e:
            raise ValueError(f"Invalid version spec or core version: {version_spec}, {core_version}. Error: {e}")
    
    @staticmethod
    def parse_version(version_string: str) -> Optional[Tuple[int, int, int]]:
        """
        Парсит строку версии в кортеж (major, minor, patch).
        
        Args:
            version_string: Строка версии (например "1.2.3")
        
        Returns:
            Кортеж (major, minor, patch) или None, если не удалось распарсить
        """
        try:
            match = re.match(r'^(\d+)\.(\d+)\.(\d+)(?:[-.]([a-zA-Z0-9]+))?(?:\+([a-zA-Z0-9]+))?$', version_string)
            if match:
                return (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except Exception:
            pass
        return None
    
    @staticmethod
    def compare_versions(version1: str, version2: str) -> int:
        """
        Сравнивает две версии.
        
        Args:
            version1: Первая версия
            version2: Вторая версия
        
        Returns:
            -1, если version1 < version2
            0, если version1 == version2
            1, если version1 > version2
        """
        try:
            v1 = packaging_version.parse(version1)
            v2 = packaging_version.parse(version2)
            if v1 < v2:
                return -1
            elif v1 > v2:
                return 1
            else:
                return 0
        except Exception:
            # Если не удалось распарсить, возвращаем 0 (равны)
            return 0
    
    @staticmethod
    def validate_version_format(version_string: str) -> bool:
        """
        Проверяет корректность формата версии.
        
        Args:
            version_string: Строка версии для проверки
        
        Returns:
            True, если формат корректен
        """
        try:
            packaging_version.parse(version_string)
            return True
        except Exception:
            return False
    
    @staticmethod
    def validate_spec_format(spec_string: str) -> bool:
        """
        Проверяет корректность формата спецификации версии.
        
        Args:
            spec_string: Спецификация версии для проверки
        
        Returns:
            True, если формат корректен
        """
        try:
            SpecifierSet(spec_string)
            return True
        except Exception:
            return False





