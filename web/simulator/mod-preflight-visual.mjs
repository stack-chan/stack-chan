import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

// Build with: npm run mod:build -- host/app/__tests__/mod-preflight/app-fixture/manifest.json --mode=release
const fixture = resolve('../firmware/dist/bin/esp32/release/app-fixture/app-fixture.xsa')
const bytes = Array.from(readFileSync(fixture))
const { baseUrl, server } = await startPreview({ port: Number(process.env.STACKCHAN_MOD_TEST_PORT ?? 8102) })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  })
  const context = await browser.newContext()
  await context.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const page = await context.newPage()
  const events = []
  page.on('console', (message) => events.push(message.text()))
  await Promise.all([
    page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] app behaviors ready'),
      timeout: 45_000,
    }),
    page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' }),
  ])
  await page.getByLabel('MODを追加', { exact: true }).setInputFiles(fixture)
  await page
    .getByText(/MOD requires host API 999/)
    .first()
    .waitFor()
  assert.equal(
    events.some((value) => value.includes('UNTRUSTED_')),
    false
  )
  await context.close()

  // Bypass the browser installer deliberately to exercise the compiled host's
  // guard against an already installed archive, before both config and app import.
  const bootContext = await browser.newContext()
  await bootContext.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const boot = await bootContext.newPage()
  const bootEvents = []
  boot.on('console', (message) => bootEvents.push(message.text()))
  boot.on('pageerror', (error) => bootEvents.push(`PAGE_ERROR ${error.message}`))
  await boot.route(/\/simulator\/mc\.js(?:\?|$)/, async (route) => {
    const original = new URL(route.request().url())
    if (original.searchParams.has('preflightOriginal')) return route.continue()
    original.searchParams.set('preflightOriginal', '1')
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
      import factory from ${JSON.stringify(original.href)};
      export default async function(options) {
        const mc = await factory(options);
        const launch = mc._fxMainLaunch;
        mc._fxMainLaunch = (width, height, archive) => {
          if (archive) mc._free(archive);
          const bytes = new Uint8Array(${JSON.stringify(bytes)});
          const pointer = mc._malloc(bytes.length);
          mc.HEAPU8.set(bytes, pointer);
          return launch(width, height, pointer);
        };
        return mc;
      }`,
    })
  })
  await Promise.all([
    boot.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] error MOD requires host API 999'),
      timeout: 45_000,
    }),
    boot.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' }),
  ])
  await boot.getByText('MODを起動できません。MODを更新してください', { exact: true }).waitFor()
  await boot.screenshot({ path: resolve('../firmware/dist/mod-preflight-recovery.png') })
  assert.equal(
    bootEvents.some((value) => value.includes('UNTRUSTED_')),
    false,
    'neither mod/config nor mod may evaluate'
  )
  assert.equal(
    bootEvents.some((value) => value.includes('[main] app behaviors ready')),
    false
  )
  assert.equal(
    bootEvents.some((value) => /XS abort|PAGE_ERROR/.test(value)),
    false
  )
  await bootContext.close()
  console.log(
    'MOD storage and compiled host reject future APIs before config or app evaluation; recovery ignores MOD resources'
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
