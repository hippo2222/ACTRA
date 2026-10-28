import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const loginRes = await context.request.post('http://127.0.0.1:8000/api/auth/login', {
    data: { identifier: 'devuser', password: 'password123' },
    headers: { Origin: 'http://127.0.0.1:8000' }
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8000/editor/Main_Dashboard.html');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light-a');
    window.dashboard.showCreateTaskModal();
    window.dashboard.syncTaskTypePicker();
  });
  await page.waitForTimeout(400);
  await page.click('.editor-task-type-card[data-type="test"]');
  await page.waitForTimeout(300);

  const data = await page.evaluate(() => {
    const container = document.querySelector('.editor-studio-archetypes');
    const cRect = container.getBoundingClientRect();
    const cStyle = window.getComputedStyle(container);

    const cards = Array.from(document.querySelectorAll('.editor-task-type-card')).map(card => {
      const r = card.getBoundingClientRect();
      const s = window.getComputedStyle(card);
      return {
        type: card.dataset.type,
        isActive: card.classList.contains('is-active'),
        rect: { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right },
        offsetFromContainerLeft: r.left - cRect.left,
        borderLeft: s.borderLeft,
        boxShadow: s.boxShadow,
        outline: s.outline,
        margin: s.margin,
        padding: s.padding
      };
    });

    return {
      containerRect: { 
        left: cRect.left, 
        top: cRect.top, 
        width: cRect.width, 
        height: cRect.height, 
        clientWidth: container.clientWidth, 
        scrollWidth: container.scrollWidth, 
        scrollLeft: container.scrollLeft 
      },
      containerPadding: { 
        left: cStyle.paddingLeft, 
        right: cStyle.paddingRight, 
        top: cStyle.paddingTop, 
        bottom: cStyle.paddingBottom 
      },
      cards
    };
  });
  console.log(JSON.stringify(data, null, 2));

  // Also take high-res crop of the archetypes column
  const archetypesEl = await page.$('.editor-studio-archetypes');
  if (archetypesEl) {
    await archetypesEl.screenshot({ 
      path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_debug_archetypes_light.png' 
    });
  }

  // Also take screenshot of the entire modal
  const modalEl = await page.$('.editor-dialog-shell-studio');
  if (modalEl) {
    await modalEl.screenshot({ 
      path: 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_debug_modal_light.png' 
    });
  }

  await browser.close();
})();
