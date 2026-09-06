import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

window.addEventListener('error', (e) => {
  showErr(String(e.message || e.error), e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  showErr('unhandledrejection: ' + String(e.reason));
});

function showErr(msg: string, loc?: string) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f00;color:#fff;font:bold 14px monospace;padding:8px;white-space:pre-wrap;word-break:break-all;';
  el.textContent = 'ERR: ' + msg + (loc ? ' @ ' + loc : '');
  document.body.appendChild(el);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
