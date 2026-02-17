"""
Централизованные импорты для устранения дублирования

Используется в:
- desktop-app/trainer.py
- editor-app/editor.py

Устраняет 32 дублирующихся импорта:
- trainer.py: PIL (5 раз), random (5 раз), messagebox (7 раз)
- editor.py: traceback (9 раз), shutil (6 раз)

Использование:
    from task_system.core.imports import *
    # или
    from task_system.core.imports import tk, Image, json, random
"""

# ============================================================================
# UI БИБЛИОТЕКИ (tkinter)
# ============================================================================

import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog

# ============================================================================
# РАБОТА С ИЗОБРАЖЕНИЯМИ (PIL/Pillow)
# ============================================================================

from PIL import Image, ImageTk, ImageDraw

# ============================================================================
# СТАНДАРТНАЯ БИБЛИОТЕКА PYTHON
# ============================================================================

# Работа с данными
import json
import os
import sys
import shutil
import subprocess

# Время и дата
import time
import datetime

# Математика и копирование
import math
from copy import deepcopy

# Утилиты
import logging
import glob
import hashlib
import random
import traceback
import re

# ============================================================================
# ЭКСПОРТ ВСЕХ ИМПОРТОВ
# ============================================================================

__all__ = [
    # UI библиотеки
    'tk',
    'ttk',
    'messagebox',
    'filedialog',
    'simpledialog',
    
    # PIL
    'Image',
    'ImageTk',
    'ImageDraw',
    
    # Стандартная библиотека
    'json',
    'os',
    'sys',
    'shutil',
    'subprocess',
    'time',
    'datetime',
    'math',
    'deepcopy',
    'logging',
    'glob',
    'hashlib',
    'random',
    'traceback',
    're',
]

