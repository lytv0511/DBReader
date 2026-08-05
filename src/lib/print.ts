import { printWebview } from './db';

const PRINT_STYLE_ID = 'dbr-print-style';

function printCSS(): string {
  return `
    .dbr-print-root { display: none; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
      #root { display: none !important; }
      .dbr-print-root { display: block !important; }
      .report-page { height: 297mm !important; overflow: visible !important; margin: 0 !important; box-shadow: none !important; page-break-after: auto !important; }
    }
  `;
}

export async function printDom(selector: string): Promise<void> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (nodes.length === 0) return;

  document.querySelectorAll('.dbr-print-root').forEach((el) => el.remove());
  document.getElementById(PRINT_STYLE_ID)?.remove();

  const container = document.createElement('div');
  container.className = 'dbr-print-root';
  for (const n of nodes) container.appendChild(n.cloneNode(true));
  document.body.appendChild(container);

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = printCSS();
  document.head.appendChild(style);

  try {
    await printWebview();
  } catch {
    window.print();
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    style.remove();
    container.remove();
  }
}
