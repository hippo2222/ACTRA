/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.resolve('frontend/Microcards/microcards.html'), 'utf8');
const js = fs.readFileSync(path.resolve('frontend/Microcards/microcards.js'), 'utf8');
const mainLogic = fs.readFileSync(path.resolve('frontend/assets/MainLogic.js'), 'utf8');
// PremiumPromoModal stores its Russian copy as \uXXXX escapes — decode so the
// assertions can read the human text regardless of escape vs raw form.
const premiumPromoSrc = fs
    .readFileSync(path.resolve('frontend/assets/PremiumPromoModal.js'), 'utf8')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const catalogSrc = fs.readFileSync(path.resolve('frontend/Catalog/catalog.js'), 'utf8');

const locales = {
    ru: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/ru.json'), 'utf8')),
    en: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/en.json'), 'utf8')),
    uk: JSON.parse(fs.readFileSync(path.resolve('frontend/assets/locales/uk.json'), 'utf8')),
};

function resolveKey(obj, dottedKey) {
    return dottedKey.split('.').reduce(
        (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
        obj
    );
}

const NEW_I18N_KEYS = [
    'microcards.filter_archived',
    'microcards.archive_filter_label',
    'microcards.archive_notice_title',
    'microcards.archive_notice_copy',
    'microcards.archive_notice_cta',
    'microcards.badge_archived',
    'microcards.archived_locked_cta',
    'microcards.limit_badge',
    'microcards.premium_limit_title',
    'microcards.premium_limit_lead',
    'microcards.premium_limit_toast',
    'microcards.premium_archived_toast',
];

describe('Microcards premium (F1) — page wiring', () => {
    it('loads the shared PremiumPromoModal on the microcards page', () => {
        expect(html).toContain('assets/PremiumPromoModal.js');
    });

    it('renders the deck-limit badge, archive notice and archive filter shells', () => {
        expect(html).toContain('id="mcLimitBadge"');
        expect(html).toContain('id="mcArchiveNotice"');
        expect(html).toContain('id="mcArchiveNoticeCopy"');
        expect(html).toContain('id="mcArchiveFilter"');
        expect(html).toContain('data-mcfilter="all"');
        expect(html).toContain('data-mcfilter="archived"');
    });

    it('wires the archive-notice CTA to the microcards premium-promo variant', () => {
        expect(html).toContain('data-premium-promo-feature="microcards-limit"');
    });
});

describe('Microcards premium (F1) — runtime behaviour', () => {
    it('handles the two premium 409 codes centrally in apiCall', () => {
        expect(js).toContain('function handlePremiumBlock');
        expect(js).toContain('workspace_limit_reached');
        expect(js).toContain('premium_archived_content');
        // The premium block must mark the error handled so callers skip their own toast.
        expect(js).toContain('err.handled = true');
    });

    it('loads the workspace-limits summary and tracks archived deck ids', () => {
        expect(js).toContain('loadDecksLimitSummary');
        expect(js).toContain('/api/workspace-limits/summary');
        expect(js).toContain('refreshArchivedDeckState');
        expect(js).toContain('function isDeckArchived');
        expect(js).toContain('archivedDeckIds');
    });

    it('gives archived deck cards a read-only treatment and a locked CTA', () => {
        expect(js).toContain('mc-deck-card--premium-archived');
        expect(js).toContain('notifyArchivedDeck');
        expect(js).toContain("t('microcards.badge_archived'");
    });

    it('exposes the archive filter setter and a ?filter=archived deep link', () => {
        expect(js).toContain('function setMcFilter');
        expect(js).toContain("setMcFilter,");
        expect(js).toContain("params.get('filter')");
        expect(js).toContain("filterParam === 'archived'");
    });

    it('opens the premium promo (not a raw toast) when the deck limit blocks creation', () => {
        expect(js).toContain('function openMicrocardsPremiumPromo');
        expect(js).toContain('window.PremiumPromo');
    });
});

describe('Microcards premium (F2) — main-page archive banner', () => {
    it('registers a decks archive segment that deep-links to the archive filter', () => {
        expect(mainLogic).toContain("key: 'decks'");
        expect(mainLogic).toContain('/microcards?filter=archived');
        expect(mainLogic).toContain('main.qa_open_microcards');
        expect(mainLogic).toContain('main.form_deck_1');
    });

    it('translates the deck plural forms and the open-microcards CTA in ru / en / uk', () => {
        const keys = ['main.form_deck_1', 'main.form_deck_2', 'main.form_deck_5', 'main.qa_open_microcards'];
        const missing = [];
        keys.forEach((key) => {
            ['ru', 'en', 'uk'].forEach((lang) => {
                const value = resolveKey(locales[lang], key);
                if (typeof value !== 'string' || value.trim().length === 0) missing.push(`${lang}: ${key}`);
            });
        });
        expect(missing).toEqual([]);
    });
});

describe('Microcards premium (F3) — shared promo modal', () => {
    it('mentions flashcard decks in the no-limits feature', () => {
        expect(premiumPromoSrc).toContain('колод микрокарточек');
    });

    it('exposes a microcards-limit trigger variant with its own copy', () => {
        expect(premiumPromoSrc).toContain("feature === 'microcards-limit'");
        expect(premiumPromoSrc).toContain('Больше колод микрокарточек в Premium');
    });
});

describe('Microcards premium (F5) — settings premium section', () => {
    it('mentions flashcard decks in the premium description across ru / en / uk', () => {
        const needles = { ru: 'микрокарточек', en: 'flashcard decks', uk: 'мікрокарток' };
        Object.entries(needles).forEach(([lang, needle]) => {
            const desc = resolveKey(locales[lang], 'settings.premium_description');
            expect(typeof desc).toBe('string');
            expect(desc).toContain(needle);
        });
    });
});

describe('Microcards premium (F6) — catalog deck import limit', () => {
    it('maps the deck entity in the catalog workspace-limit helper', () => {
        expect(catalogSrc).toContain("kind === 'deck' ? 'decks'");
    });

    it('routes a blocked flashcard import to the deck limit + decks label', () => {
        expect(catalogSrc).toContain("item?.content_type === 'flashcard_deck' ? 'deck'");
        expect(catalogSrc).toContain('catalog.summary_type_flashcards');
    });

    it('translates the flashcards summary label in ru / en / uk', () => {
        ['ru', 'en', 'uk'].forEach((lang) => {
            const value = resolveKey(locales[lang], 'catalog.summary_type_flashcards');
            expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
        });
    });
});

describe('Microcards premium (F4) — welcome premium section', () => {
    it('lists flashcard decks among the limited materials in ru / en / uk', () => {
        const needles = { ru: 'колод микрокарточек', en: 'flashcard decks', uk: 'колод мікрокарток' };
        Object.entries(needles).forEach(([lang, needle]) => {
            const copy = resolveKey(locales[lang], 'wl.k084');
            expect(typeof copy).toBe('string');
            expect(copy).toContain(needle);
        });
    });
});

describe('Microcards premium (F1) — i18n coverage', () => {
    it('translates every new microcards premium string in ru / en / uk', () => {
        const missing = [];
        NEW_I18N_KEYS.forEach((key) => {
            ['ru', 'en', 'uk'].forEach((lang) => {
                const value = resolveKey(locales[lang], key);
                if (typeof value !== 'string' || value.trim().length === 0) {
                    missing.push(`${lang}: ${key}`);
                }
            });
        });
        expect(missing).toEqual([]);
    });

    it('keeps placeholder tokens consistent across locales for the limit badge', () => {
        ['ru', 'en', 'uk'].forEach((lang) => {
            const badge = resolveKey(locales[lang], 'microcards.limit_badge');
            ['{own}', '{ownLim}', '{tot}', '{totLim}'].forEach((tok) => {
                expect(badge).toContain(tok);
            });
        });
    });
});
