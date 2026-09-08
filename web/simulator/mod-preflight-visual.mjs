import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

// From firmware/, build host/app/__tests__/mod-preflight/{app-fixture,startup-fixture}/manifest.json
// with npm run mod:build -- <manifest> --mode=release.
const fixture = resolve('../firmware/dist/bin/esp32/release/app-fixture/app-fixture.xsa')
let bytes = Array.from(readFileSync(fixture))
const startupBytes = Array.from(readFileSync('../firmware/dist/bin/esp32/release/startup-fixture/startup-fixture.xsa'))
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
      predicate: (message) => message.text().includes('[main] app ready'),
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
    'the app must not evaluate'
  )
  assert.equal(
    bootEvents.some((value) => value.includes('[main] app ready')),
    false
  )
  assert.equal(
    bootEvents.some((value) => /XS abort|PAGE_ERROR/.test(value)),
    false
  )

  // A retired generation must be rejected by the compiled host even when the installer is bypassed.
  const legacySource = Buffer.from(startupBytes).toString('latin1')
  const retired = legacySource.replace(/("appApiVersion"\s*:\s*)2/, (_match, prefix) => `${prefix}1`)
  assert.notEqual(retired, legacySource, 'the fixture declares app API 2')
  bytes = Array.from(Buffer.from(retired, 'latin1'))
  bootEvents.length = 0
  await Promise.all([
    boot.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] error This host requires app API 2'),
      timeout: 45_000,
    }),
    boot.reload({ waitUntil: 'networkidle' }),
  ])
  assert.equal(
    bootEvents.some((value) => value.includes('UNTRUSTED_')),
    false,
    'retired archives evaluate neither config nor app'
  )
  assert.equal(
    bootEvents.some((value) => /XS abort|PAGE_ERROR/.test(value)),
    false
  )

  // The same module bodies are now valid. They still must wait for host setup.
  bytes = startupBytes
  bootEvents.length = 0
  await Promise.all([
    boot.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] start'),
      timeout: 45_000,
    }),
    boot.reload({ waitUntil: 'networkidle' }),
  ])
  const screen = boot.locator('canvas[aria-hidden="true"]')
  await screen.evaluate((canvas) => {
    Object.assign(canvas.style, {
      display: 'block',
      position: 'fixed',
      left: '0',
      top: '0',
      width: '320px',
      height: '240px',
      opacity: '0',
      pointerEvents: 'none',
    })
  })
  const box = await screen.boundingBox()
  assert.ok(box)
  const tap = async (x, y) => {
    const coordinates = { clientX: box.x + x, clientY: box.y + y }
    await screen.dispatchEvent('mousedown', coordinates)
    await screen.dispatchEvent('mouseup', coordinates)
    await boot.waitForTimeout(150)
  }
  await tap(160, 210)
  await boot.waitForTimeout(8100)
  assert.equal(
    bootEvents.some((value) => value.includes('UNTRUSTED_') || value.includes('[main] app context created')),
    false,
    'settings pauses boot before evaluating the MOD entry, even past the auto-boot deadline'
  )
  // Back creates a fresh splash. Re-entering settings must still defer the MOD.
  await tap(22, 22)
  await tap(160, 210)
  assert.equal(
    bootEvents.some((value) => value.includes('UNTRUSTED_')),
    false
  )
  await Promise.all([
    boot.waitForEvent('console', {
      predicate: (message) => message.text().includes('[main] app ready'),
      timeout: 20_000,
    }),
    tap(22, 22),
  ])
  for (const marker of ['UNTRUSTED_MOD_EVALUATED', 'UNTRUSTED_APP_STARTED']) {
    assert.equal(bootEvents.filter((value) => value.includes(marker)).length, 1, `${marker} runs once after setup`)
  }
  const eventIndex = (marker) => bootEvents.findIndex((value) => value.includes(marker))
  assert.ok(eventIndex('UNTRUSTED_MOD_EVALUATED') < eventIndex('UNTRUSTED_APP_STARTED'))
  assert.equal(
    bootEvents.some((value) => /XS abort|PAGE_ERROR|\[main\] error/.test(value)),
    false
  )
  await bootContext.close()
  console.log('MOD preflight rejects retired and future APIs; host settings defer valid MOD evaluation until boot')
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
