#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'frontend', 'assets', 'locales');

// New flat keys for Open Answer Editor Textual Reasoning.html
const NEW_KEYS = {
  ru: {
    'open_answer_editor.page_title':             'ACTRA — Редактор открытых ответов',
    'open_answer_editor.back_title':             'Библиотека заданий',
    'open_answer_editor.header_title_default':   'Редактирование задания',
    'open_answer_editor.show_tutorial':          'Показать обучение',
    'open_answer_editor.save_btn':               'Сохранить',
    'open_answer_editor.question_label':         'Вопрос',
    'open_answer_editor.question_placeholder':   'Введите формулировку вопроса или описание кейса...',
    'open_answer_editor.reference_label':        'Эталонный ответ',
    'open_answer_editor.reference_placeholder':  'Введите текст правильного ответа...',
    'open_answer_editor.reference_hint':         'Выберите слова или фразы, обязательные для правильного ответа',
    'open_answer_editor.split_keywords_btn':     'Разбить на ключевые слова',
    'open_answer_editor.keywords_title':         'Ключевые слова',
    'open_answer_editor.hint_label':             'Подсказка (необязательно)',
    'open_answer_editor.hint_placeholder':       'Добавьте подсказку, которую увидит пользователь при необходимости...',
    'open_answer_editor.requirements_title':     'Требования к ответу',
    'open_answer_editor.check_order_label':      'Проверять порядок слов',
    'open_answer_editor.check_order_hint':       'Ключевые слова должны встречаться в эталонном порядке.',
    'open_answer_editor.max_length_label':       'Максимальная длина ответа',
    'open_answer_editor.max_length_placeholder': 'Оставьте пустым, если ответ можно вводить без лимита',
    'open_answer_editor.max_length_hint':        'Необязательная настройка. Если задать лимит, в тренажёре появится счётчик символов и ограничение на ввод.',
    'open_answer_editor.images_title':           'Изображения',
    'open_answer_editor.images_hint':            'Прикрепите до трех изображений. Они автоматически сохранятся вместе с заданием.',
    'open_answer_editor.add_image_label':        'Добавить изображение',
  },
  en: {
    'open_answer_editor.page_title':             'ACTRA — Open Answer Editor',
    'open_answer_editor.back_title':             'Task Library',
    'open_answer_editor.header_title_default':   'Editing task',
    'open_answer_editor.show_tutorial':          'Show tutorial',
    'open_answer_editor.save_btn':               'Save',
    'open_answer_editor.question_label':         'Question',
    'open_answer_editor.question_placeholder':   'Enter the question text or case description...',
    'open_answer_editor.reference_label':        'Reference answer',
    'open_answer_editor.reference_placeholder':  'Enter the correct answer text...',
    'open_answer_editor.reference_hint':         'Select words or phrases required for the correct answer',
    'open_answer_editor.split_keywords_btn':     'Split into keywords',
    'open_answer_editor.keywords_title':         'Keywords',
    'open_answer_editor.hint_label':             'Hint (optional)',
    'open_answer_editor.hint_placeholder':       'Add a hint the user will see if needed...',
    'open_answer_editor.requirements_title':     'Answer requirements',
    'open_answer_editor.check_order_label':      'Check word order',
    'open_answer_editor.check_order_hint':       'Keywords must appear in the reference order.',
    'open_answer_editor.max_length_label':       'Maximum answer length',
    'open_answer_editor.max_length_placeholder': 'Leave empty if there is no character limit',
    'open_answer_editor.max_length_hint':        'Optional setting. If set, a character counter and input limit will appear in the trainer.',
    'open_answer_editor.images_title':           'Images',
    'open_answer_editor.images_hint':            'Attach up to three images. They will be saved automatically with the task.',
    'open_answer_editor.add_image_label':        'Add image',
  },
  uk: {
    'open_answer_editor.page_title':             'ACTRA — Редактор відкритих відповідей',
    'open_answer_editor.back_title':             'Бібліотека завдань',
    'open_answer_editor.header_title_default':   'Редагування завдання',
    'open_answer_editor.show_tutorial':          'Показати навчання',
    'open_answer_editor.save_btn':               'Зберегти',
    'open_answer_editor.question_label':         'Питання',
    'open_answer_editor.question_placeholder':   'Введіть формулювання питання або опис кейсу...',
    'open_answer_editor.reference_label':        'Еталонна відповідь',
    'open_answer_editor.reference_placeholder':  'Введіть текст правильної відповіді...',
    'open_answer_editor.reference_hint':         'Виберіть слова або фрази, обов\'язкові для правильної відповіді',
    'open_answer_editor.split_keywords_btn':     'Розбити на ключові слова',
    'open_answer_editor.keywords_title':         'Ключові слова',
    'open_answer_editor.hint_label':             'Підказка (необов\'язково)',
    'open_answer_editor.hint_placeholder':       'Додайте підказку, яку побачить користувач при необхідності...',
    'open_answer_editor.requirements_title':     'Вимоги до відповіді',
    'open_answer_editor.check_order_label':      'Перевіряти порядок слів',
    'open_answer_editor.check_order_hint':       'Ключові слова повинні зустрічатися в еталонному порядку.',
    'open_answer_editor.max_length_label':       'Максимальна довжина відповіді',
    'open_answer_editor.max_length_placeholder': 'Залиште порожнім, якщо відповідь можна вводити без ліміту',
    'open_answer_editor.max_length_hint':        'Необов\'язкове налаштування. Якщо задати ліміт, у тренажері з\'явиться лічильник символів та обмеження на введення.',
    'open_answer_editor.images_title':           'Зображення',
    'open_answer_editor.images_hint':            'Прикріпіть до трьох зображень. Вони автоматично збережуться разом із завданням.',
    'open_answer_editor.add_image_label':        'Додати зображення',
  }
};

const FILES = ['ru', 'en', 'uk'];

let allOk = true;
for (const lang of FILES) {
  const filePath = path.join(LOCALES_DIR, lang + '.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const keysToAdd = NEW_KEYS[lang];
  let added = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(keysToAdd)) {
    if (key in data) {
      console.log(`  SKIP ${lang}: ${key} already exists`);
      skipped++;
    } else {
      data[key] = value;
      added++;
    }
  }

  // Re-serialize — preserves all existing keys and newly added ones
  // We need to maintain the file structure: flat keys + nested objects
  // JSON.stringify with 2-space indent handles both
  const updated = JSON.stringify(data, null, 2) + '\n';

  // Validate round-trip
  try {
    JSON.parse(updated);
  } catch (e) {
    console.error(`ERROR: ${lang}.json result is invalid JSON: ${e.message}`);
    allOk = false;
    continue;
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`OK: ${lang}.json — added ${added} keys, skipped ${skipped}, total keys: ${Object.keys(data).length}`);
}

if (allOk) {
  console.log('\nAll locale files updated successfully.');
} else {
  process.exit(1);
}
