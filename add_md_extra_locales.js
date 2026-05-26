#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'frontend', 'assets', 'locales');

// New entries for md nested namespace
const NEW_KEYS = {
  library_crumb:       { ru: 'Библиотека',                                                                                 en: 'Library',                                                              uk: 'Бібліотека' },
  theory_meta_hint:    { ru: 'Настройте обучающие материалы для этой темы (Менеджер теории).',                             en: 'Configure learning materials for this topic (Theory Manager).',         uk: 'Налаштуйте навчальні матеріали для цієї теми (Менеджер теорії).' },
  sync_summary_loading:{ ru: 'Сводка синхронизации появится после загрузки.',                                              en: 'Sync summary will appear after loading.',                               uk: 'Зведення синхронізації з\'явиться після завантаження.' },
};

const FILES = ['ru', 'en', 'uk'];

let allOk = true;
for (const lang of FILES) {
  const filePath = path.join(LOCALES_DIR, lang + '.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (!data['md']) {
    console.error(`ERROR: ${lang}.json has no md namespace`);
    allOk = false;
    continue;
  }

  let added = 0;
  let skipped = 0;
  for (const [key, translations] of Object.entries(NEW_KEYS)) {
    if (key in data['md']) {
      console.log(`  SKIP ${lang}: md.${key} already exists`);
      skipped++;
    } else {
      data['md'][key] = translations[lang];
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
  console.log(`OK: ${lang}.json — added ${added} keys to md, total top-level: ${Object.keys(data).length}`);
}

if (allOk) console.log('\nAll locale files updated successfully.');
else process.exit(1);
