import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

describe('Premium Billing & Settings Frontend Integration', () => {
  it('contains correct Russian declension logic for remaining premium days', () => {
    const js = read('frontend/Settings/settings.js');
    expect(js).toContain('formatRuCount');
    expect(js).toContain("wt('settings.premium_days_1', 'день')");
    expect(js).toContain("wt('settings.premium_days_2', 'дня')");
    expect(js).toContain("wt('settings.premium_days_5', 'дней')");
  });

  it('binds period buttons to createPremiumOrder and triggers Paddle Checkout', () => {
    const settingsJs = read('frontend/Settings/settings.js');
    const promoJs = read('frontend/assets/PremiumPromoModal.js');

    expect(settingsJs).toContain("data-premium-period");
    expect(settingsJs).toContain("createPremiumOrder");
    expect(settingsJs).toContain("triggerPaddleCheckout");
    expect(settingsJs).toContain("actra:paddle:checkout_completed");

    expect(promoJs).toContain("window.Paddle.Initialize");
    expect(promoJs).toContain("actra:paddle:checkout_completed");
    expect(promoJs).toContain("triggerPaddleCheckout");
  });

  it('properly calculates and formats premium access labels', () => {
    const js = read('frontend/Settings/settings.js');
    expect(js).toContain('formatPremiumAccessLabel');
    expect(js).toContain('Math.ceil(msLeft / (24 * 60 * 60 * 1000))');
    expect(js).toContain("wt('settings.premium_active_until', 'Premium до {date}')");
  });
});
