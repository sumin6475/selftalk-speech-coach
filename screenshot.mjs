import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'temporary screenshots');

if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Auto-increment screenshot number
const existing = fs.readdirSync(dir).filter(f => f.startsWith('screenshot-') && f.endsWith('.png'));
const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0', 10));
const next = nums.length ? Math.max(...nums) + 1 : 1;
const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const filepath = path.join(dir, filename);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
await new Promise(r => setTimeout(r, 1000)); // wait for animations to settle
await page.screenshot({ path: filepath, fullPage: false });
await browser.close();

console.log(`Saved: ${filepath}`);
