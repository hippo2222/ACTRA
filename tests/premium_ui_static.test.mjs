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
    expect(js).toContain('/api/billing/orders');
  });

  it('renders plan badges in global header and profile menu', () => {
    const header = read('frontend/assets/GlobalHeader.js');
    const menu = read('frontend/assets/SharedProfileModal.js');

    expect(header).toContain('data-global-plan-badge');
    expect(header).toContain('effective_plan');
    expect(menu).toContain('sharedProfilePremium');
    expect(menu).toContain('/ui/settings#premium');
  });

  it('intercepts free-user navigation to full premium pages from main', () => {
    const mainLogic = read('frontend/assets/MainLogic.js');
    const mainHtml = read('frontend/MainScreen/Main.html');

    expect(mainLogic).toContain('PREMIUM_GATED_UI_PAGES');
    expect(mainLogic).toContain('/ui/calendar');
    expect(mainLogic).toContain('/ui/statistics');
    expect(mainLogic).toContain('showPremiumNavigationGate');
    expect(mainLogic).toContain('PremiumPromo.open');
    expect(mainHtml).toContain('/assets/PremiumPromoModal.js');
  });

  it('provides a shared premium promo modal with prices and limit triggers', () => {
    const promo = read('frontend/assets/PremiumPromoModal.js');
    const editor = read('frontend/Editor/dashboard.js');
    const complexBuilder = read('frontend/Complexes/create.html');
    const complexes = read('frontend/Complexes/index.html');
    const settings = read('frontend/Settings/settings.html');

    expect(promo).toContain('window.PremiumPromo');
    expect(promo).toContain('$7.99');
    expect(promo).toContain('$14.99');
    expect(promo).toContain('$37.99');
    expect(promo).toContain('\\u0432\\u044b\\u0433\\u043e\\u0434\\u043d\\u0435\\u0435');
    expect(promo).not.toContain('data-premium-order-days');
    expect(editor).toContain('data-premium-promo-feature="tasks-limit"');
    expect(complexBuilder).toContain("data-premium-promo-feature', 'complexes-limit'");
    expect(complexes).toContain('data-premium-promo-feature", "complexes-limit"');
    expect(settings).toContain('PremiumPromoModal.js');
  });
});
