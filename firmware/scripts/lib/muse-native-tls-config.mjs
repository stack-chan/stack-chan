import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const required = [
  'CONFIG_MBEDTLS_HAVE_TIME',
  'CONFIG_MBEDTLS_HAVE_TIME_DATE',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_FULL',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY',
  'CONFIG_MBEDTLS_X509_TRUSTED_CERT_CALLBACK',
]
const forbidden = [
  'CONFIG_ESP_TLS_INSECURE',
  'CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY',
  'CONFIG_MBEDTLS_ALLOW_WEAK_CERTIFICATE_VERIFICATION',
  'CONFIG_MBEDTLS_CUSTOM_CERTIFICATE_BUNDLE',
  'CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEPRECATED_LIST',
]

// Check both Moddable's requested defaults and IDF's resolved config, not only a manifest.
// An old sdkconfig or a later board override must not silently disable chain verification.
export function validateMuseNativeTlsConfig({ project, selector }) {
  if (!['--setup-native-speech', '--setup-rate-replay'].includes(selector)) return
  const requested = readFileSync(join(project, 'sdkconfig.mc'), 'utf8')
  for (const name of ['CONFIG_MBEDTLS_CERTIFICATE_BUNDLE_CROSS_SIGNED_VERIFY', 'CONFIG_MBEDTLS_HAVE_TIME_DATE']) {
    const settings = requested.split(/\r?\n/).filter(line => line.startsWith(`${name}=`))
    if (settings.length !== 1 || settings[0] !== `${name}=y`)
      throw new Error(`Native speech TLS setting missing or ambiguous in generated defaults: ${name}`)
  }
  const resolved = readFileSync(join(project, 'build/config/sdkconfig.h'), 'utf8')
  for (const name of required) {
    if (!new RegExp(`^#define ${name} 1\\r?$`, 'm').test(resolved))
      throw new Error(`Native speech TLS setting missing: ${name}`)
  }
  for (const name of forbidden) {
    if (new RegExp(`^#define ${name}(?:\\s|$)`, 'm').test(resolved))
      throw new Error(`Native speech TLS setting forbidden: ${name}`)
  }
}
