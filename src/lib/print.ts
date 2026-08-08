import { printReport } from './db';
import { save } from '@tauri-apps/plugin-dialog';

const IS_WINDOWS =
  typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent || '');

async function collectCSS(): Promise<string[]> {
  const css: string[] = [];
  for (const el of Array.from(
    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'),
  )) {
    if (el instanceof HTMLLinkElement) {
      try {
        const res = await fetch(el.href);
        if (res.ok) {
          css.push(await res.text());
          continue;
        }
      } catch {
        /* fall through to @import */
      }
      css.push(`@import url('${el.href}');`);
    } else {
      css.push(el.textContent || '');
    }
  }
  return css;
}

const PRINT_WINDOW_CSS = `
  html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; color: #111111 !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-page { width: 210mm !important; max-width: 210mm !important; height: 1122px !important; min-height: 1122px !important; overflow: hidden !important; margin: 0 auto !important; box-shadow: none !important; }
  .report-scroll, .no-print, .report-measure { display: none !important; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
`;

export async function printDom(selector: string): Promise<void> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (nodes.length === 0) return;

  const css = await collectCSS();
  const body = nodes.map((n) => n.outerHTML).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DBReader</title><style>${css.join('\n')}</style><style>${PRINT_WINDOW_CSS}</style></head><body>${body}</body></html>`;

  if (IS_WINDOWS) {
    const path = await save({
      title: 'Save report as PDF',
      defaultPath: 'dbreader-report.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (path === null) return;
    await printReport(html, path);
    return;
  }

  try {
    await printReport(html);
  } catch {
    window.print();
  }
}
