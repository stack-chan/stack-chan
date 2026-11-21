"""Generate isolated test manifests and local-only credentials; no SDK/source mutation."""
import argparse, datetime, ipaddress, json, os
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parent
OUT = ROOT / '.generated'

def private_ipv4(value):
    ip = ipaddress.IPv4Address(value)
    if not (ip.is_loopback or any(ip in ipaddress.ip_network(net) for net in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))):
        raise ValueError('Use a specific RFC1918 or loopback IPv4 address, never wildcard/public')
    return ip

def prepare(host, port):
    ip = private_ipv4(host)
    OUT.mkdir(exist_ok=True)
    ca_path = OUT / 'fixture-ca.pem'
    # Never replace an existing fixture identity silently; use the same CA for both A/B builds.
    if not ca_path.exists():
        now = datetime.datetime.now(datetime.timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'StopWatch local fixture CA')])
        ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(days=1))
              .not_valid_after(now+datetime.timedelta(days=14)).add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
              .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), False)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), False).sign(ca_key, hashes.SHA256()))
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        leaf = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, str(ip))]))
                .issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-datetime.timedelta(days=1)).not_valid_after(now+datetime.timedelta(days=7))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ip), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), False)
                .sign(ca_key, hashes.SHA256()))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
        (OUT/'fixture-ca.der').write_bytes(ca.public_bytes(serialization.Encoding.DER))
        (OUT/'server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
        (OUT/'server-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        # The signing key is intentionally not persisted; only server-local leaf key remains.
    leaf = x509.load_pem_x509_certificate((OUT/'server.pem').read_bytes())
    if ip not in leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.IPAddress):
        raise ValueError('Existing certificate does not cover host; preserve this identity and use a separate fixture directory')
    def rebase(v, source):
        if isinstance(v, dict): return {k: rebase(x, source) for k,x in v.items()}
        if isinstance(v, list): return [rebase(x, source) for x in v]
        if isinstance(v, str) and v.startswith(('./','../')):
            return Path(os.path.relpath((source.parent/v).resolve(), OUT)).as_posix()
        return v
    # Moddable takes the first module declaration and deduplicates same-source aliases.
    # Replace declarations in a cloned include graph, not in a late top-level override.
    production = ROOT.parents[2]/'voice/gemini-worker-entry.js'
    (OUT/'production-worker-entry.js').write_bytes(production.read_bytes())
    main = (ROOT.parent/'main.js').read_text(encoding='utf-8').replace('run < 5', 'run < 1')
    main = main.replace("run % 2 ? ['full', 'decode-only'] : ['decode-only', 'full']", "['full']")
    (OUT/'main.js').write_text(main, encoding='utf-8')
    combined = main.replace("const marker =", "let fixturePacing = 'burst'\nconst marker =")
    combined = combined.replace('JSON.stringify(value)', "JSON.stringify({ ...value, mode: value.mode ? `${value.mode}-${fixturePacing}` : fixturePacing })")
    combined = combined.replace('`${endpoint}/${size}`', '`${endpoint}/${fixturePacing}/${size}`')
    combined = combined.replace('run < 1', 'run < 2').replace("for (const size of ['short', 'long'])", "fixturePacing = run ? 'realtime' : 'burst'\n        for (const size of ['short', 'long'])")
    (OUT/'main-combined.js').write_text(combined, encoding='utf-8')
    for pacing in ('burst','realtime','combined','endurance'):
        for scan in (('native',) if pacing == 'endurance' else ('js','native')):
            cloned = {}
            def clone(source):
                source = source.resolve()
                if source.is_dir(): source = source/'manifest.json'
                if source in cloned: return cloned[source]
                filename = f'chain-{pacing}-{scan}-{len(cloned)}.json'
                cloned[source] = './'+filename
                original = json.loads(source.read_text(encoding='utf-8'))
                manifest = rebase(original, source)
                def include(value):
                    if isinstance(value,list): return [include(x) for x in value]
                    if isinstance(value,str) and value.startswith(('./','../')):
                        return clone(source.parent/value)
                    return value
                if 'include' in original: manifest['include'] = include(original['include'])
                modules = manifest.get('modules', {})
                if 'gemini-worker-entry' in modules:
                    modules['gemini-worker-entry'] = '../worker-entry'
                    modules['fixture-tls-trust'] = '../trust'
                    modules['fixture-production-worker-entry'] = './production-worker-entry'
                if scan == 'js' and 'gemini-worker-scan' in modules:
                    modules['gemini-worker-scan'] = '../scan-js'
                (OUT/filename).write_text(json.dumps(manifest,indent=2)+'\n')
                return './'+filename
            top = clone(ROOT.parent/'manifest.json')
            manifest = json.loads((OUT/top).read_text())
            manifest['build']['NAME'] = f'gemini-tls-{pacing}-{scan}'
            manifest['modules']['main'] = '../endurance' if pacing == 'endurance' else './main-combined' if pacing == 'combined' else './main'
            if pacing == 'endurance': manifest['modules']['fixture-pcm-check'] = '../pcm-check'
            manifest['modules']['mock-config'] = f'./config-{pacing}'
            manifest.setdefault('resources', {}).setdefault('*', []).append('./fixture-ca.der')
            (OUT/f'manifest-{pacing}-{scan}.json').write_text(json.dumps(manifest,indent=2)+'\n')
        (OUT/f'config-{pacing}.js').write_text('export default '+json.dumps(f'https://{ip}:{port}' + ('' if pacing in ('combined','endurance') else f'/{pacing}'))+'\n')
    print(json.dumps({'generated':str(OUT),'host':str(ip),'port':port,'certificateSHA256':x509.load_pem_x509_certificate(ca_path.read_bytes()).fingerprint(hashes.SHA256()).hex()}))

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,default=18766)
    args=parser.parse_args();prepare(args.host,args.port)
