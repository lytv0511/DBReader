import { describe, it, expect } from 'vitest';
import { WIKI_SECTIONS, getWikiSection } from '../lib/wiki';
import { t, resolveLang } from '../lib/i18n';

describe('wiki documentation', () => {
  const ids = new Set(WIKI_SECTIONS.map((s) => s.id));

  it('has unique section ids', () => {
    expect(ids.size).toBe(WIKI_SECTIONS.length);
  });

  it('has at least 15 sections', () => {
    expect(WIKI_SECTIONS.length).toBeGreaterThanOrEqual(15);
  });

  it('every title and body key resolves in every supported language', () => {
    const languages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de'];
    for (const lang of languages) {
      for (const s of WIKI_SECTIONS) {
        const title = t(resolveLang(lang as never), s.titleKey);
        expect(title, `${s.titleKey} in ${lang} should not fall back to the raw key`).not.toBe(s.titleKey);
        for (const b of s.blocks) {
          for (const k of b.keys) {
            const text = t(resolveLang(lang as never), k);
            expect(text, `${k} in ${lang} should not fall back to the raw key`).not.toBe(k);
          }
        }
      }
    }
  });

  it('every related link points to an existing section', () => {
    for (const s of WIKI_SECTIONS) {
      for (const r of s.related) {
        expect(getWikiSection(r), `related '${r}' of '${s.id}' must exist`).not.toBeNull();
      }
    }
  });

  it('sections have at least one block', () => {
    for (const s of WIKI_SECTIONS) {
      expect(s.blocks.length, s.id).toBeGreaterThan(0);
    }
  });
});
