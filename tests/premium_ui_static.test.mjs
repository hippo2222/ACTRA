import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

describe('premium UI wiring', () => {
  it('renders a premium section on settings', () => {
    const html = read('frontend/Settings/settings.html');
    const js = read('frontend/Settings/settings.js');

    expect(html).toContain('id="premium"');
    expect(html).toContain('settings-premium-body');
    expect(js).toContain('/api/billing/status');
    expect(js).not.toContain('/api/billing/orders');
    expect(js).toContain('createPremiumOrder');
    expect(js).toContain('triggerPaddleCheckout');
  });

  it('renders plan badges in global header and profile menu', () => {
    const header = read('frontend/assets/GlobalHeader.js');
    const menu = read('frontend/assets/SharedProfileModal.js');

    expect(header).toContain('data-global-plan-badge');
    expect(header).toContain('effective_plan');
    expect(menu).toContain('sharedProfilePremium');
    expect(menu).toContain('PremiumPromo.open');
    expect(menu).toContain('checkout');
  });

  it('intercepts free-user navigation to full premium pages from main', () => {
    const mainLogic = read('frontend/assets/MainLogic.js');
    const mainHtml = read('frontend/MainScreen/Main.html');

    expect(mainLogic).toContain('PREMIUM_GATED_UI_PAGES');
    expect(mainLogic).toContain('/calendar');
    expect(mainLogic).toContain('/statistics');
    expect(mainLogic).toContain('showPremiumNavigationGate');
    expect(mainLogic).toContain('PremiumPromo.open');
    expect(mainHtml).toContain('/assets/PremiumPromoModal.js');
  });

  it('shows the premium archive signal on the main screen', () => {
    const mainLogic = read('frontend/assets/MainLogic.js');
    const mainHtml = read('frontend/MainScreen/Main.html');

    expect(mainHtml).toContain('id="main-premium-archive-card"');
    expect(mainHtml).toContain('id="main-premium-archive-open"');
    expect(mainHtml).toContain('var(--color-component-pill-warning-bg');
    expect(mainLogic).toContain('loadPremiumArchiveBanner');
    expect(mainLogic).toContain('/api/workspace-limits/summary');
    expect(mainLogic).toContain('/complexes?filter=archived');
    expect(mainLogic).toContain('main-premium-archive-breakdown');
    expect(mainLogic).toContain('Верните материалы из архива Premium');
  });

  it('explains published archived content policy in publication dialogs', () => {
    const theoryCenter = read('frontend/Editor/theory_center.js');
    const complexBuilder = read('frontend/Complexes/create.html');
    const complexes = (read('frontend/Complexes/index.html') + '\n' + read('frontend/Complexes/complexes.js'));

    [theoryCenter, complexBuilder, complexes].forEach((source) => {
      expect(source).toContain('Источник находится в архиве Premium');
      expect(source).toContain('isCatalogVisibilityExpansion');
      expect(source).toContain('Новая версия недоступна');
      expect(source).toContain('можно только сузить доступ');
    });
    expect(theoryCenter).toContain('Опубликованная версия остаётся доступной');
    expect(complexBuilder).toContain('Опубликованная версия остаётся доступной');
    expect(complexes).toContain('Опубликованная версия остаётся доступной');
  });

  it('provides a shared premium promo modal with prices and limit triggers', () => {
    const promo = read('frontend/assets/PremiumPromoModal.js');
    const editor = read('frontend/Editor/dashboard.js');
    const complexBuilder = read('frontend/Complexes/create.html');
    const complexes = (read('frontend/Complexes/index.html') + '\n' + read('frontend/Complexes/complexes.js'));
    const settings = read('frontend/Settings/settings.html');

    expect(promo).toContain('window.PremiumPromo');
    expect(promo).toContain('$4.99');
    expect(promo).toContain('$7.99');
    expect(promo).toContain('$19.99');
    expect(promo).toContain('premium_promo_period_30d_note');
    const ruLoc = read('frontend/assets/locales/ru.json');
    expect(ruLoc).toContain('выгоднее');
    expect(promo).not.toContain('data-premium-order-days');
    expect(editor).toContain('data-premium-promo-feature="tasks-limit"');
    expect(complexBuilder).toContain("data-premium-promo-feature', 'complexes-limit'");
    expect(complexes).toContain('data-premium-promo-feature", "complexes-limit"');
    expect(settings).toContain('PremiumPromoModal.js');
  });

  it('closes the shared premium promo modal from the acknowledgement button', () => {
    const promo = read('frontend/assets/PremiumPromoModal.js').replace(/\r\n/g, '\n');

    expect(promo).toContain("const settings = event.target.closest('[data-premium-promo-settings]');");
    expect(promo).toContain(`if (settings) {
                close();
                return;
            }`);
  });
});
