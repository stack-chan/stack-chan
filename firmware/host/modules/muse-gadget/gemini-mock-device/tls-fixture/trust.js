import Resource from 'Resource'
import CertificateManager from 'ssl/cert'

// This module is mapped only by the local TLS fixture manifest, in the Worker VM.
CertificateManager.register(new Resource('fixture-ca.der'))
