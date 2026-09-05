"""Reproduce the firmware inventory from the reviewed Git commit; excludes build output."""
from pathlib import Path
from collections import Counter, defaultdict
import hashlib
import json
import re
import subprocess

here = Path(__file__).resolve().parent
root = Path(subprocess.check_output(
    ['git', 'rev-parse', '--show-toplevel'], cwd=here, text=True).strip())
commit = json.loads((here / 'sources.json').read_text())['commit']
paths = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', commit, '--', 'firmware'],
    cwd=root, text=True).splitlines()
source_exts = {'.ts', '.js', '.mjs', '.c', '.h'}
source = [p for p in paths if Path(p).suffix in source_exts and '/vendor/' not in p]

def role(p):
    if '/typings/' in p or p.endswith('.d.ts'):
        return 'type_declarations'
    if '/__tests__/' in p or '/testing/' in p or '.test.' in p or '.architecture.' in p:
        return 'tests_and_support'
    if '/scripts/' in p or '/benchmarks/' in p:
        return 'development_tools'
    if '/mods/' in p:
        return 'examples'
    return 'host_implementation'

groups = defaultdict(lambda: {'files': 0, 'physical_lines': 0})
lengths = {}
hashes = defaultdict(list)
for p in source:
    data = subprocess.check_output(['git', 'show', f'{commit}:{p}'], cwd=root)
    count = len(data.splitlines())
    lengths[p] = count
    groups[role(p)]['files'] += 1
    groups[role(p)]['physical_lines'] += count
    hashes[hashlib.sha256(data).hexdigest()].append(p)

modules = {}
module_names = sorted({p.split('/')[3] for p in paths
                       if p.startswith('firmware/host/modules/') and len(p.split('/')) > 4})
for name in module_names:
    if name.startswith('_'):
        continue
    prefix = f'firmware/host/modules/{name}/'
    candidates = [p for p in source if p.startswith(prefix)]
    modules[name] = {
        'all_source_files': len(candidates),
        'all_source_lines': sum(lengths[p] for p in candidates),
        'implementation_lines': sum(lengths[p] for p in candidates if role(p) == 'host_implementation'),
    }

examples = [p for p in paths if re.match(r'firmware/mods/examples/[^/]+/(?:mod|miniapp)\.(?:ts|js)$', p)]
result = {
    'commit': commit,
    'scope': 'git-tracked firmware files; lines include comments and blank lines; not logical LOC',
    'tracked_files': len(paths),
    'top_level_files': dict(Counter(p.split('/')[1] for p in paths)),
    'source_files_excluding_vendor': len(source),
    'source_lines_excluding_vendor': sum(lengths.values()),
    'roles': groups,
    'module_source': modules,
    'mod_or_miniapp_entrypoints': len(examples),
    'entrypoint_extensions': dict(Counter(Path(p).suffix for p in examples)),
    'largest_implementation_files': sorted(
        [{'path': p, 'physical_lines': n} for p, n in lengths.items() if role(p) == 'host_implementation'],
        key=lambda x: x['physical_lines'], reverse=True)[:20],
    'exact_duplicate_source_groups': [ps for ps in hashes.values() if len(ps) > 1],
    'manifest_named_files': len([p for p in paths if 'manifest' in Path(p).name and p.endswith('.json')]),
}
destination = Path(__file__).with_name('inventory.json')
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['tracked_files', 'source_files_excluding_vendor', 'source_lines_excluding_vendor', 'roles', 'mod_or_miniapp_entrypoints', 'entrypoint_extensions', 'manifest_named_files']}, ensure_ascii=False, indent=2))
