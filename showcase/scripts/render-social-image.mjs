import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// Optional regeneration command: node scripts/render-social-image.mjs.
// The exported PNG is committed; normal builds do not need a browser.
const publicDir = new URL('../public/', import.meta.url);
const logo = await readFile(new URL('munos-logo.svg', publicDir), 'utf8');
const lettering = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const font = (await readFile(new URL('SpaceGrotesk.ttf', publicDir))).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><style>@font-face{font-family:Space;src:url(data:font/ttf;base64,${font})}</style><rect width="1200" height="630" fill="#F4F8FA"/><g transform="translate(112 145) scale(1.12)">${lettering}</g><text x="403" y="396" font-family="Space,Arial,sans-serif" font-size="26" fill="#426478">Conference Management System</text></svg>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(svg);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'html,body{margin:0;padding:0}svg{display:block}' });
  const image = await page.screenshot({ type: 'png' });
  await writeFile(new URL('social-preview.png', publicDir), image);
  console.log('Exported 1200 × 630 social-preview.png from the current vector logo.');
} finally {
  await browser.close();
}
