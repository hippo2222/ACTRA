import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('publication modal content', () => {
  it('does not mention personal copies in publication flows', () => {
    const files = [
      'frontend/Editor/theory_editor.js',
      'frontend/Editor/theory_center.js',
      'frontend/Complexes/create.html',
      'frontend/Complexes/index.html',
    ];
    const outdatedPhrases = [
      /Уже добавленные личные копии/i,
      /личные копии в чужих библиотеках/i,
      /не обновляет существующие копии автоматически/i,
    ];

    files.forEach((file) => {
      const source = readFile(file);
      outdatedPhrases.forEach((phrase) => {
        expect(source).not.toMatch(phrase);
      });
    });
  });

  it('uses stronger semantic feedback tones in publication dialogs', () => {
    const theoryCenter = readFile('frontend/Editor/theory_center.js');
    const complexCreate = readFile('frontend/Complexes/create.html');
    const complexIndex = readFile('frontend/Complexes/index.html');

    expect(theoryCenter).toContain('border-success-light bg-success-lighter text-success-text');
    expect(complexCreate).toContain("box.classList.add('border-info-light', 'bg-info-lighter', 'text-info-text');");
    expect(complexCreate).toContain("box.classList.add('border-error-light', 'bg-error-lighter', 'text-error-text');");
    expect(complexIndex).toContain('border-success-light bg-success-lighter text-success-text');
  });
});
