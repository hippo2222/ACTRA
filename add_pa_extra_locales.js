#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'frontend', 'assets', 'locales');

// New entries for pa nested namespace
const NEW_KEYS = {
  status_idle:  { ru: 'Режим ожидания',  en: 'Idle',    uk: 'Режим очікування' },
  status_saved: { ru: 'Сохранено',        en: 'Saved',   uk: 'Збережено' },
};

const FILES = ['ru', 'en', 'uk'];

let allOk = true;
for (const lang of FILES) {
  const filePath = path.join(LOCALES_DIR, lang + '.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (!data['pa']) {
    console.error(`ERROR: ${lang}.json has no pa namespace`);
    allOk = false;
    continue;
  }

  let added = 0;
  let skipped = 0;
  for (const [key, translations] of Object.entries(NEW_KEYS)) {
    if (key in data['pa']) {
      console.log(`  SKIP ${lang}: pa.${key} already exists`);
      skipped++;
    } else {
      data['pa'][key] = translations[lang];
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
  console.log(`OK: ${lang}.json — added ${added} keys to pa, total top-level: ${Object.keys(data).length}`);
}

if (allOk) console.log('\nAll locale files updated successfully.');
else process.exit(1);
