"""Check the SDK-generated artifact graph, not source literals. Run after mcconfig without -m."""
import argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parent
FIRMWARE=ROOT.parents[4]
parser=argparse.ArgumentParser();parser.add_argument('variant',choices=['burst-js','burst-native','realtime-js','realtime-native','combined-js','combined-native', 'endurance-native']);parser.add_argument('--name');args=parser.parse_args()
path=FIRMWARE/'dist/tmp/esp32/m5stack_stopwatch/release'/(args.name or ('gemini-tls-'+args.variant))/'makefile'
text=path.read_text()
rules={line.split(': ',1)[0]:line.split(': ',1)[1] for line in text.splitlines() if ': ' in line and not line.startswith(('\t',' '))}
checks={'gemini-worker-entry':'/tls-fixture/worker-entry.js','fixture-tls-trust':'/tls-fixture/trust.js','fixture-production-worker-entry':'/tls-fixture/.generated/production-worker-entry.js','gemini-worker-scan':'/tls-fixture/scan-js.js' if args.variant.endswith('-js') else '/voice/gemini-worker-scan.js'}
if args.variant == 'endurance-native':
    checks['main']='/tls-fixture/endurance.js'
    checks['fixture-pcm-check']='/tls-fixture/pcm-check.js'
    assert 'pcm-check.c' in text
for module,suffix in checks.items():
    target=f'$(MODULES_DIR)/{module}.xsb'
    assert rules[target].endswith(suffix),(target,rules.get(target))
    assert target+'\\' in text or target+'\n' in text, target
assert '$(RESOURCES_DIR)/fixture-ca.der' in rules
assert '$(DATA_DIR)/fixture-ca.der' not in text
assert (ROOT/'.generated/production-worker-entry.js').read_bytes()==(ROOT.parents[2]/'voice/gemini-worker-entry.js').read_bytes(), 'production copy is stale'
assert 'server-key.pem' not in text and 'fixture-ca.pem' not in text
print('PASS generated artifact graph:',args.variant,path)
