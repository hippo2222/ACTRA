import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; box-sizing: border-box; }
      h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
      p.desc { font-size: 13px; color: #94a3b8; margin-top: 0; margin-bottom: 20px; line-height: 1.4; }
      .grid-options { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .option-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
      .option-title { font-size: 14px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
      .tag-status { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; }
      .tag-bad { background: #7f1d1d; color: #fca5a5; }
      .tag-good { background: #064e3b; color: #6ee7b7; }

      .matrix-table { width: 100%; border-collapse: separate; border-spacing: 8px; font-size: 11px; }
      .th-col-header { padding: 8px 10px; border-radius: 8px; text-align: left; font-weight: 600; }
      .th-col-1 { background: rgba(59, 130, 246, 0.15); border-top: 3.5px solid #3b82f6; border-left: 1px solid rgba(59,130,246,0.3); border-right: 1px solid rgba(59,130,246,0.3); border-bottom: 1px solid rgba(59,130,246,0.3); color: #93c5fd; }
      .th-col-2 { background: rgba(217, 119, 6, 0.15); border-top: 3.5px solid #d97706; border-left: 1px solid rgba(217,119,6,0.3); border-right: 1px solid rgba(217,119,6,0.3); border-bottom: 1px solid rgba(217,119,6,0.3); color: #fcd34d; }

      .td-tier { width: 120px; padding: 10px 8px; border-radius: 8px; font-weight: 600; font-size: 11px; line-height: 1.3; }
      .td-cell { padding: 10px; border-radius: 8px; background: #0f172a; border: 1px solid #334155; position: relative; }
      .cell-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-bottom: 5px; font-family: monospace; }
      .cell-tag-c1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
      .cell-tag-c2 { background: rgba(217, 119, 6, 0.2); color: #fbbf24; border: 1px solid rgba(217,119,6,0.3); }
      .cell-text { font-size: 11px; color: #cbd5e1; }

      /* Problem Colors */
      .tier-current-1 { background: rgba(2, 132, 199, 0.2); border-left: 4px solid #0284c7; color: #7dd3fc; }
      .tier-current-2 { background: rgba(124, 58, 237, 0.2); border-left: 4px solid #7c3aed; color: #c4b5fd; }
      .tier-current-3 { background: rgba(217, 119, 6, 0.2); border-left: 4px solid #d97706; color: #fde68a; }
      .cell-conflict { border-top: 3px solid #d97706 !important; }

      /* Solution Colors */
      .tier-sol-1 { background: rgba(71, 85, 105, 0.35); border-left: 4px solid #94a3b8; color: #f1f5f9; }
      .tier-sol-2 { background: rgba(87, 83, 78, 0.35); border-left: 4px solid #a8a29e; color: #f5f5f4; }
      .tier-sol-3 { background: rgba(51, 65, 85, 0.45); border-left: 4px solid #64748b; color: #e2e8f0; }
      .badge-arabic { background: rgba(255,255,255,0.15); padding: 1px 5px; border-radius: 4px; font-family: monospace; font-size: 10px; margin-right: 4px; color: #fff; }
    </style>
  </head>
  <body>
    <h1>Когнитивная эргономика 2D-таблицы: Дифференциация Уровней и Колонок</h1>
    <p class="desc">Сравнение: почему одинаковые радужные цвета на обеих осях путают мозг, и как дифференцировать И уровни, И колонки без интерференции.</p>

    <div class="grid-options">
      <!-- Card 1: Problem -->
      <div class="option-card">
        <div class="option-title">
          <span>Вариант 1: Радуга на X и на Y</span>
          <span class="tag-status tag-bad">КОНФЛИКТ В ЯЧЕЙКЕ 3.1</span>
        </div>
        <table class="matrix-table">
          <tr>
            <td></td>
            <td class="th-col-header th-col-1">I КОЛОНКА<br>Пневмоторакс</td>
            <td class="th-col-header th-col-2">II КОЛОНКА<br>Ателектаз</td>
          </tr>
          <tr>
            <td class="td-tier tier-current-1">1. Плевра<br><span style="font-size:9px; opacity:0.8;">[Синий цвет]</span></td>
            <td class="td-cell" style="border-top: 3px solid #0284c7;">
              <div class="cell-tag cell-tag-c1">• I</div>
              <div class="cell-text">Коллапс легкого</div>
            </td>
            <td class="td-cell" style="border-top: 3px solid #0284c7;">
              <div class="cell-tag cell-tag-c2">• II</div>
              <div class="cell-text">Нет изменений</div>
            </td>
          </tr>
          <tr>
            <td class="td-tier tier-current-2">2. Ткань<br><span style="font-size:9px; opacity:0.8;">[Фиолетовый]</span></td>
            <td class="td-cell" style="border-top: 3px solid #7c3aed;">
              <div class="cell-tag cell-tag-c1">• I</div>
              <div class="cell-text">Гиперпрозрачность</div>
            </td>
            <td class="td-cell" style="border-top: 3px solid #7c3aed;">
              <div class="cell-tag cell-tag-c2">• II</div>
              <div class="cell-text">Затемнение доли</div>
            </td>
          </tr>
          <tr>
            <td class="td-tier tier-current-3">3. Средостение<br><span style="font-size:9px; opacity:0.8;">[Янтарный!]</span></td>
            <td class="td-cell cell-conflict" style="box-shadow: 0 0 0 1px #d97706;">
              <div class="cell-tag cell-tag-c1">• I (Синий!)</div>
              <div class="cell-text" style="color:#fca5a5; font-size:10px;">⚠️ Янтарная кромка уровня + синий бейдж колонки. В пуле S1 студент тянет ее в янтарный ателектаз!</div>
            </td>
            <td class="td-cell cell-conflict">
              <div class="cell-tag cell-tag-c2">• II (Янтарь)</div>
              <div class="cell-text">Сдвиг в больную сторону</div>
            </td>
          </tr>
        </table>
        <p style="font-size:11px; color:#f87171; margin-top:14px; margin-bottom:0; line-height:1.4;">❌ В ячейке 3.1 янтарный цвет уровня спорит с синим цветом пневмоторакса. Студент видит в пуле янтарный таб и ложно считает, что обе карточки относятся к ателектазу.</p>
      </div>

      <!-- Card 2: Solution -->
      <div class="option-card" style="border-color: #059669;">
        <div class="option-title" style="color:#34d399;">
          <span>Вариант 2: Ортогональная дифференциация</span>
          <span class="tag-status tag-good">РЕКОМЕНДУЕТСЯ</span>
        </div>
        <table class="matrix-table">
          <tr>
            <td></td>
            <td class="th-col-header th-col-1">I КОЛОНКА<br>Пневмоторакс</td>
            <td class="th-col-header th-col-2">II КОЛОНКА<br>Ателектаз</td>
          </tr>
          <tr>
            <td class="td-tier tier-sol-1"><span class="badge-arabic">1</span> Плевральная полость</td>
            <td class="td-cell" style="border-top: 3.5px solid #3b82f6;"><div class="cell-tag cell-tag-c1">• I · Пневмоторакс</div><div class="cell-text">Коллапс легкого</div></td>
            <td class="td-cell" style="border-top: 3.5px solid #d97706;"><div class="cell-tag cell-tag-c2">• II · Ателектаз</div><div class="cell-text">Нет изменений</div></td>
          </tr>
          <tr>
            <td class="td-tier tier-sol-2"><span class="badge-arabic">2</span> Легочная ткань</td>
            <td class="td-cell" style="border-top: 3.5px solid #3b82f6;"><div class="cell-tag cell-tag-c1">• I · Пневмоторакс</div><div class="cell-text">Гиперпрозрачность</div></td>
            <td class="td-cell" style="border-top: 3.5px solid #d97706;"><div class="cell-tag cell-tag-c2">• II · Ателектаз</div><div class="cell-text">Затемнение доли</div></td>
          </tr>
          <tr>
            <td class="td-tier tier-sol-3"><span class="badge-arabic">3</span> Тень средостения</td>
            <td class="td-cell" style="border-top: 3.5px solid #3b82f6;"><div class="cell-tag cell-tag-c1">• I · Пневмоторакс</div><div class="cell-text">Сдвиг в здоровую сторону</div></td>
            <td class="td-cell" style="border-top: 3.5px solid #d97706;"><div class="cell-tag cell-tag-c2">• II · Ателектаз</div><div class="cell-text">Сдвиг в больную сторону</div></td>
          </tr>
        </table>
        <p style="font-size:11px; color:#34d399; margin-top:14px; margin-bottom:0; line-height:1.4;">✅ <b>И уровни, И колонки полностью различимы:</b> Уровни отличаются по номерам [1], [2], [3] и тональным ступеням (Slate / Stone / Zinc). А цвет карточки ВСЕГДА и однозначно означает нозологию: Синий = Пневмоторакс, Янтарь = Ателектаз.</p>
      </div>
    </div>
  </body>
  </html>
  `;

  await page.setContent(html);
  await page.screenshot({ path: "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/chromatic_interference_comparison.png" });
  await browser.close();
  console.log("Comparison screenshot generated successfully!");
}

run();
