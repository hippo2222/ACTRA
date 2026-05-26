#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'frontend', 'assets', 'locales');

// New entries for testui_q nested namespace
const NEW_KEYS = {
  options_title:          { ru: 'Варианты',                       en: 'Options',              uk: 'Варіанти' },
  your_choice_badge:      { ru: 'Ваш выбор',                      en: 'Your choice',          uk: 'Ваш вибір' },
  reference_badge:        { ru: 'Эталон',                         en: 'Reference',            uk: 'Еталон' },
  no_data:                { ru: 'Нет данных для отображения.',     en: 'No data to display.',  uk: 'Немає даних для відображення.' },
  fit_btn:                { ru: 'Подогнать',                       en: 'Fit',                  uk: 'Підігнати' },
  close_btn:              { ru: 'Закрыть',                         en: 'Close',                uk: 'Закрити' },
  answer_option_alt:      { ru: 'Вариант ответа',                  en: 'Answer option',        uk: 'Варіант відповіді' },
  review_selected_correct:{ ru: 'Выбрано верно',                   en: 'Selected correctly',   uk: 'Вибрано вірно' },
  review_correct_option:  { ru: 'Правильный',                      en: 'Correct',              uk: 'Правильний' },
};

const FILES = ['ru', 'en', 'uk'];

let allOk = true;
for (const lang of FILES) {
  const filePath = path.join(LOCALES_DIR, lang + '.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (!data['testui_q']) {
    console.error(`ERROR: ${lang}.json has no testui_q namespace`);
    allOk = false;
    continue;
  }

  let added = 0;
  let skipped = 0;
  for (const [key, translations] of Object.entries(NEW_KEYS)) {
    if (key in data['testui_q']) {
      console.log(`  SKIP ${lang}: testui_q.${key} already exists`);
      skipped++;
    } else {
      data['testui_q'][key] = translations[lang];
      added++;
    }
  }

  const updated = JSON.stringify(data, null, 2) + '\n';
  try { JSON.parse(updated); } catch (e) {
    console.error(`ERROR: ${lang}.json invalid JSON: ${e.message}`);
    allOk = false;
    continue;
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`OK: ${lang}.json — added ${added} keys to testui_q, total top-level: ${Object.keys(data).length}`);
}

if (allOk) console.log('\nAll locale files updated successfully.');
else process.exit(1);
