import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { validateMuseNativeTlsConfig } from './muse-native-tls-config.mjs'

const names = [
  'CONFIG_MBEDTLS_HAVE_TIME', 'CONFIG_MBEDTLS_HAVE_TIME_DATE',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE', 'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_FULL',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY', 'CONFIG_MBEDTLS_X509_TRUSTED_CERT_CALLBACK',
]
const secure = names.map(name => `#define ${name} 1`).join('\n') + '\n'
function fixture(t) {
  const project = mkdtempSync(join(tmpdir(), 'muse-native-tls-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  mkdirSync(join(project, 'build/config'), { recursive: true })
  const write = (resolved = secure, requested = 'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY=y\nCONFIG_MBEDTLS_HAVE_TIME_DATE=y\n') => {
    writeFileSync(join(project, 'sdkconfig.mc'), requested)
    writeFileSync(join(project, 'build/config/sdkconfig.h'), resolved)
  }
  write()
  return { write, check: () => validateMuseNativeTlsConfig({ project, selector: '--setup-native-speech' }) }
}
test('cross-signed option requires both generated defaults and resolved IDF config', t => {
  const f = fixture(t)
  assert.doesNotThrow(f.check)
  f.write(secure, 'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY=n\n')
  assert.throws(f.check, /generated defaults/)
  for (const name of names) {
    f.write(secure.replace(`#define ${name} 1`, `/* ${name} disabled */`))
    assert.throws(f.check, /setting missing/)
  }
})
test('rejects verification bypass and unapproved trust source settings', t => {
  const f = fixture(t)
  for (const name of ['CONFIG_ESP_TLS_INSECURE', 'CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY', 'CONFIG_MBEDTLS_ALLOW_WEAK_CERTIFICATE_VERIFICATION', 'CONFIG_MBEDTLS_CUSTOM_CERTIFICATE_BUNDLE', 'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEPRECATED_LIST']) {
    f.write(secure + `#define ${name} 1\n`)
    assert.throws(f.check, /setting forbidden/)
  }
})
test('earlier setup and offline builds do not read or modify TLS config', () => {
  for (const selector of ['--setup', '--cascaded-offline', '--gemini-mock'])
    assert.doesNotThrow(() => validateMuseNativeTlsConfig({ project: 'does-not-exist', selector }))
})

test('certificate validity dates fail closed in defaults and resolved config', t => {
  const f = fixture(t)
  const cross = 'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY=y\n'
  for (const date of ['', 'CONFIG_MBEDTLS_HAVE_TIME_DATE=n\n', '# CONFIG_MBEDTLS_HAVE_TIME_DATE is not set\n', 'CONFIG_MBEDTLS_HAVE_TIME_DATE=y\nCONFIG_MBEDTLS_HAVE_TIME_DATE=n\n']) {
    f.write(secure, cross + date)
    assert.throws(f.check, /generated defaults/)
  }
  f.write(secure.replace('#define CONFIG_MBEDTLS_HAVE_TIME_DATE 1', '/* validity dates disabled */'))
  assert.throws(f.check, /CONFIG_MBEDTLS_HAVE_TIME_DATE/)
  f.write()
  assert.doesNotThrow(f.check)
})
