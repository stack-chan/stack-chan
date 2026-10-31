import assert from 'node:assert/strict'

/**
 * Run against the actual built editor. The caller supplies its Playwright page
 * and local /avatar-dsl/ URL. Serial is replaced before any application script;
 * neither this helper nor the loaded editor can request a physical device.
 */
export async function runTransferBrowserChecks(page, editorUrl, { timeout = 30000 } = {}) {
  await page.addInitScript(() => {
    window.__avatarTransferMock = { requests: 0, enumerationRequests: 0 }
    Object.defineProperty(navigator, 'serial', {
      configurable: false,
      value: Object.freeze({
        async requestPort() {
          window.__avatarTransferMock.requests++
          throw new DOMException('Mock device selection cancelled; no hardware access', 'NotFoundError')
        },
        async getPorts() {
          window.__avatarTransferMock.enumerationRequests++
          return []
        },
      }),
    })
  })
  await page.goto(editorUrl)
  await page.waitForFunction(() => !document.getElementById('transfer').disabled, undefined, { timeout })

  const requestCount = () => page.evaluate(() => window.__avatarTransferMock.requests)
  const waitForStage = () =>
    page.waitForFunction(() => document.getElementById('confirmation').open, undefined, { timeout })

  // Preparing uses real C/WASM validation and real WASM archive building.
  await page.locator('#transfer').click()
  await waitForStage()
  assert.equal(await requestCount(), 0, 'staging must not open the device chooser')
  assert.equal(await page.locator('#compatible-host').isChecked(), false)
  assert.equal(await page.locator('#confirm-transfer').isDisabled(), true)
  assert.match(await page.locator('#transfer-snapshot').textContent(), /Revision/)
  await page.locator('#cancel-transfer').click()
  assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
  assert.equal(await requestCount(), 0, 'cancelling a pending request must not access USB')

  await page.locator('#transfer').click()
  await waitForStage()

  // Bypass the visible UI's disabled state deliberately: the controller itself
  // must still reject a synthetic acknowledgment and a genuine button click.
  await page.evaluate(() => {
    const checkbox = document.getElementById('compatible-host')
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    document.getElementById('confirm-transfer').disabled = false
  })
  await page.locator('#confirm-transfer').click()
  assert.equal(await requestCount(), 0, 'trusted button click cannot promote a synthetic host acknowledgment')
  assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), true)

  await page.evaluate(() => {
    const checkbox = document.getElementById('compatible-host')
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.locator('#compatible-host').check()
  assert.equal(await page.locator('#confirm-transfer').isDisabled(), false)

  // A real checkbox interaction still cannot authorize programmatic clicks.
  await page.evaluate(() => {
    const button = document.getElementById('confirm-transfer')
    button.click()
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  assert.equal(await requestCount(), 0, 'synthetic confirmation cannot access USB')

  await page.locator('#confirm-transfer').click()
  await page.waitForFunction(() => window.__avatarTransferMock.requests === 1, undefined, { timeout })
  await page.waitForFunction(() => document.getElementById('transfer-status').textContent === 'cancelled', undefined, {
    timeout,
  })
  assert.equal(await page.locator('#confirmation').evaluate((dialog) => dialog.open), false)
  assert.equal(await page.locator('#source').isDisabled(), false)
  assert.equal(await page.locator('#compatible-host').isChecked(), false)
  assert.equal(await page.evaluate(() => window.__avatarTransferMock.enumerationRequests), 0)

  return {
    stagedWithoutDeviceAccess: true,
    cancellationWithoutDeviceAccess: true,
    syntheticAcknowledgmentRejected: true,
    syntheticConfirmationRejected: true,
    trustedConfirmationRequestsMockChooser: true,
    mockChooserCalls: await requestCount(),
    physicalDeviceAccess: false,
  }
}
