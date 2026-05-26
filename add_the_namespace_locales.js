#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, 'frontend', 'assets', 'locales');

const THE_RU = {
  k001: "Редактор теории",
  k002: "Пишите теорию как отдельный материал, который можно переиспользовать в разных темах и комплексах.",
  k003: "Не опубликована",
  k004: "Назад",
  k005: "Центр теории",
  k006: "К комплексам",
  k007: "Новая теория",
  k008: "Сохранить",
  k009: "Библиотека",
  k010: "Теории",
  k011: "Поиск теории",
  k012: "Личная библиотека",
  k013: "Загружаем библиотеку теорий...",
  k014: "Материал",
  k015: "Готово к редактированию",
  k016: "Здесь вы редактируете сам материал. Использование в темах и комплексах управляется отдельно через Центр теории.",
  k017: "Название теории",
  k018: "Размер:",
  k019: "Теория сохраняется как отдельный материал и может использоваться в нескольких местах без дублирования содержимого.",
  k020: "Поиск по названию или ID",
  k021: "Например: КТ органов грудной клетки",
  k022: "Показать обучение",
  k023: "Жирный (Ctrl+B)",
  k024: "Курсив (Ctrl+I)",
  k025: "Подчёркнутый (Ctrl+U)",
  k026: "Заголовок 1",
  k027: "Заголовок 2",
  k028: "Маркированный список",
  k029: "Нумерованный список",
  k030: "По левому краю",
  k031: "По центру",
  k032: "По правому краю",
  k033: "По ширине",
  k034: "Цвет текста",
  k035: "Добавить изображение",
  k036: "Сверху и снизу",
  k037: "Обтекание справа",
  k038: "Обтекание слева",
  k039: "Повернуть влево",
  k040: "Повернуть вправо",
  k041: "Отразить по горизонтали"
};

const THE_EN = {
  k001: "Theory Editor",
  k002: "Write theory as a standalone material that can be reused across different topics and complexes.",
  k003: "Not published",
  k004: "Back",
  k005: "Theory Hub",
  k006: "To Complexes",
  k007: "New Theory",
  k008: "Save",
  k009: "Library",
  k010: "Theories",
  k011: "Search theory",
  k012: "Personal library",
  k013: "Loading theory library...",
  k014: "Material",
  k015: "Ready to edit",
  k016: "Here you edit the material itself. Usage in topics and complexes is managed separately through the Theory Hub.",
  k017: "Theory title",
  k018: "Size:",
  k019: "Theory is saved as a standalone material and can be used in multiple places without duplicating content.",
  k020: "Search by title or ID",
  k021: "e.g. CT of the chest organs",
  k022: "Show tutorial",
  k023: "Bold (Ctrl+B)",
  k024: "Italic (Ctrl+I)",
  k025: "Underline (Ctrl+U)",
  k026: "Heading 1",
  k027: "Heading 2",
  k028: "Bulleted list",
  k029: "Numbered list",
  k030: "Align left",
  k031: "Align center",
  k032: "Align right",
  k033: "Justify",
  k034: "Text color",
  k035: "Add image",
  k036: "Above and below",
  k037: "Float right",
  k038: "Float left",
  k039: "Rotate left",
  k040: "Rotate right",
  k041: "Flip horizontally"
};

const THE_UK = {
  k001: "Редактор теорії",
  k002: "Пишіть теорію як окремий матеріал, який можна повторно використовувати в різних темах та комплексах.",
  k003: "Не опублікована",
  k004: "Назад",
  k005: "Центр теорії",
  k006: "До комплексів",
  k007: "Нова теорія",
  k008: "Зберегти",
  k009: "Бібліотека",
  k010: "Теорії",
  k011: "Пошук теорії",
  k012: "Особиста бібліотека",
  k013: "Завантажуємо бібліотеку теорій...",
  k014: "Матеріал",
  k015: "Готово до редагування",
  k016: "Тут ви редагуєте сам матеріал. Використання в темах та комплексах керується окремо через Центр теорії.",
  k017: "Назва теорії",
  k018: "Розмір:",
  k019: "Теорія зберігається як окремий матеріал і може використовуватися в кількох місцях без дублювання вмісту.",
  k020: "Пошук за назвою або ID",
  k021: "Наприклад: КТ органів грудної клітки",
  k022: "Показати навчання",
  k023: "Жирний (Ctrl+B)",
  k024: "Курсив (Ctrl+I)",
  k025: "Підкреслений (Ctrl+U)",
  k026: "Заголовок 1",
  k027: "Заголовок 2",
  k028: "Маркований список",
  k029: "Нумерований список",
  k030: "По лівому краю",
  k031: "По центру",
  k032: "По правому краю",
  k033: "По ширині",
  k034: "Колір тексту",
  k035: "Додати зображення",
  k036: "Зверху і знизу",
  k037: "Обтікання справа",
  k038: "Обтікання зліва",
  k039: "Повернути вліво",
  k040: "Повернути вправо",
  k041: "Відзеркалити горизонтально"
};

// Build the JSON block for the `the` namespace
function buildTheBlock(dict) {
  const entries = Object.entries(dict)
    .map(([k, v]) => `    "${k}": ${JSON.stringify(v)}`)
    .join(',\n');
  return `  "the": {\n${entries}\n  }`;
}

// The anchor is the last two chars of the current file: `\n}\n`
// We need to turn `  }\n}\n` (close of se namespace + close of root) into
// `  },\n  "the": { ... }\n}\n`
const ANCHOR = '  }\n}\n';
const FILES = [
  { file: 'ru.json', dict: THE_RU },
  { file: 'en.json', dict: THE_EN },
  { file: 'uk.json', dict: THE_UK }
];

let allOk = true;
for (const { file, dict } of FILES) {
  const filePath = path.join(LOCALES_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf8');

  if (!raw.endsWith(ANCHOR)) {
    console.error(`ERROR: ${file} does not end with expected anchor. Last 80 chars: ${JSON.stringify(raw.slice(-80))}`);
    allOk = false;
    continue;
  }

  if (raw.includes('"the"')) {
    console.log(`SKIP: ${file} already contains "the" namespace`);
    continue;
  }

  // Replace closing `  }\n}\n` with `  },\n  "the": { ... }\n}\n`
  const theBlock = buildTheBlock(dict);
  const updated = raw.slice(0, -ANCHOR.length) + '  },\n' + theBlock + '\n}\n';

  // Validate JSON
  try {
    JSON.parse(updated);
  } catch (e) {
    console.error(`ERROR: ${file} result is invalid JSON: ${e.message}`);
    allOk = false;
    continue;
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  const keyCount = Object.keys(JSON.parse(updated)).length;
  console.log(`OK: ${file} updated — now ${keyCount} top-level keys, "the" has ${Object.keys(dict).length} keys`);
}

if (allOk) {
  console.log('\nAll locale files updated successfully.');
} else {
  console.log('\nSome files had errors — check output above.');
  process.exit(1);
}
