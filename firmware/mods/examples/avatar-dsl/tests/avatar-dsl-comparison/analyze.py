# SPDX-License-Identifier: Apache-2.0
import argparse
import csv
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description='Analyze the paired Avatar DSL instrument benchmark')
parser.add_argument('log', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
OUT = args.output
OUT.mkdir(parents=True, exist_ok=True)
records = [json.loads(line) for line in args.log.read_text(encoding='utf8').splitlines()]
keys = next(row['line'][len('instruments key: '):].split(',') for row in records if row['line'].startswith('instruments key: '))
phases, benches, checks, errors = [], [], [], []
active = None
complete = False
for row in records:
    line = row['line']
    if re.search(r'CHECK FAIL|startup failed|Guru Meditation|Backtrace|abort\(', line):
        errors.append(row)
    if match := re.search(r'\[AVDS-COMPARE\] CHECK (PASS|FAIL) (.*)', line):
        checks.append(dict(passed=match[1] == 'PASS', label=match[2]))
    if '[AVDS-COMPARE] COMPLETE' in line:
        complete = True
    if match := re.search(r'\[AVDS-COMPARE\] (START|VM_BENCH|PHASE_BEGIN|SAMPLE|PHASE_END) (\{.*\})', line):
        kind, data = match[1], json.loads(match[2])
        if kind == 'START':
            settings = data
        elif kind == 'VM_BENCH':
            benches.append(data)
        elif kind == 'PHASE_BEGIN':
            assert active is None
            active = dict(begin=data, hostBegin=row['t'], instrument=[], samples=[])
        elif kind == 'SAMPLE':
            assert active is not None
            active['samples'].append(dict(hostT=row['t'], **data))
        elif kind == 'PHASE_END':
            assert active is not None
            begin = active['begin']
            for key in ('backend', 'preset', 'dynamic', 'repeat'):
                assert begin[key] == data[key]
            samples = active['instrument'][1:-1]
            assert len(samples) >= 5
            seconds = samples[-1]['t'] - samples[0]['t']
            frame_count = sum(sample['counters']['Frames drawn'] for sample in samples[1:])
            weights = [samples[i]['t'] - samples[i-1]['t'] for i in range(1,len(samples))]
            cpu = {key: sum(sample['counters'][key] * weight for sample, weight in zip(samples[1:],weights)) / sum(weights) for key in ('CPU 0','CPU 1')}
            delta, draw = data['delta'], data['drawDelta']
            assert delta['evaluations'] > 0 and draw['passes'] > 0 and draw['pairs'] > 0 and draw['unmatched'] == 0
            phase = dict(backend=data['backend'], preset=data['preset'], dynamic=data['dynamic'], repeat=data['repeat'],
                         actualMs=data['actualMs'], writes=data['writes'], delta=delta, drawDelta=draw,
                         instrumentFrames=frame_count, instrumentSeconds=seconds, instrumentSamples=len(samples),
                         actualFps=frame_count/seconds, cpu0=cpu['CPU 0'], cpu1=cpu['CPU 1'],
                         vmMs=delta['vmUs']/delta['evaluations']/1000,
                         geometryMs=delta['geometryUs']/delta['evaluations']/1000,
                         vmPlusGeometryMs=(delta['vmUs']+delta['geometryUs'])/delta['evaluations']/1000,
                         rasterMs=draw['rasterUs']/draw['passes']/1000,
                         submissionMs=draw['submitUs']/draw['passes']/1000,
                         drawPassFps=draw['passes']*1000/data['actualMs'],
                         instrumentWindow=samples,
                         sampleTiming=active['samples'])
            phases.append(phase)
            active = None
    if active and line.startswith('instruments: '):
        match = re.fullmatch(r'instruments: ([0-9,-]+)',line)
        if match:
            values = list(map(int, match[1].split(',')))
            assert len(values) == len(keys), 'Incomplete instrument row'
            active['instrument'].append(dict(t=row['t'], counters=dict(zip(keys,values))))

def aggregate(rows):
    seconds = sum(row['instrumentSeconds'] for row in rows)
    count = sum(row['delta']['evaluations'] for row in rows)
    draws = sum(row['drawDelta']['passes'] for row in rows)
    return dict(actualFps=sum(row['instrumentFrames'] for row in rows)/seconds,
                fpsRuns=[row['actualFps'] for row in rows],
                cpu0=sum(row['cpu0']*row['instrumentSeconds'] for row in rows)/seconds,
                cpu1=sum(row['cpu1']*row['instrumentSeconds'] for row in rows)/seconds,
                vmMs=sum(row['delta']['vmUs'] for row in rows)/count/1000,
                geometryMs=sum(row['delta']['geometryUs'] for row in rows)/count/1000,
                vmPlusGeometryMs=sum(row['delta']['vmUs']+row['delta']['geometryUs'] for row in rows)/count/1000,
                rasterMs=sum(row['drawDelta']['rasterUs'] for row in rows)/draws/1000,
                submissionMs=sum(row['drawDelta']['submitUs'] for row in rows)/draws/1000,
                drawPassFps=draws*1000/sum(row['actualMs'] for row in rows),
                evaluations=count, draws=draws, instrumentSeconds=seconds)

comparisons = []
for preset in ('default','omega','aokko'):
    for dynamic in (False,True):
        group = dict(preset=preset, dynamic=dynamic)
        for backend in ('js','native'):
            rows = [phase for phase in phases if phase['backend']==backend and phase['preset']==preset and phase['dynamic']==dynamic]
            assert len(rows)==2, (preset,dynamic,backend,len(rows))
            group[backend] = aggregate(rows)
        group['fpsRatio'] = group['native']['actualFps']/group['js']['actualFps']
        group['vmRatio'] = group['js']['vmMs']/group['native']['vmMs']
        comparisons.append(group)
result = dict(oldVersion='55d7785cedbb2cc386952850051db679b20c395f (optimized JS backend)',
              newVersion='5dbc157320f0c660f29ebfcd1c2d2712bb326cf6 (native backend)',
              settings=settings, hostConfigIdentical=True, sharedHostBinary=True,
              complete=complete, automaticChecks=len(checks), checks=checks, errors=errors,
              comparisons=comparisons, vmBench=benches, phases=phases,
              methods=dict(fps='Sum SDK Frames drawn counters divided by monotonic capture elapsed seconds between corresponding samples; discard first/last samples at phase boundaries and omit first kept counter.',
                           cpu='SDK samples the running task on each core every 1250 us and returns integer-truncated non-idle percent. Weight by actual duration of each SDK sample. Whole application and all tasks, not isolated MOD CPU; decimal aggregate values do not imply sub-percent single-sample precision.',
                           preparation='VM plus geometry/presentation operation CPU time per evaluation. JS wrappers use the same ESP microsecond clock as native counters.',
                           raster='Both backends use the same outer Piu container with paired no-pixel Poco callbacks for every raster band; summed raster work divided by face draw passes. Excludes panel transfer.',
                           submission='Outer Piu container traversal / command-list generation per face draw pass; distinct from raster execution.',
                           input='Same function of actual elapsed time; 33 ms timer callbacks can skip deadlines under load. Built-in animation schedulers retain each implementation behavior.'),
              limitations=['SDK Frames drawn / Piu passes are not an external panel or camera FPS measurement.', 'Instrumented diagnostic host; servo locked none, Wi-Fi empty overrides, head LED null.', 'Two sequential measurements per condition on one physical device; reverse backend order in the second repeat.', 'Per-frame execution counters cover the full measured phase, whereas SDK FPS/CPU use the interior steady window.', 'The native renderer retains its internal raster timing markers in addition to the common outer probe.'])
(OUT/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
with (OUT/'comparison.csv').open('w',newline='') as file:
    columns=['preset','dynamic','backend','actualFps','drawPassFps','cpu0','cpu1','vmMs','geometryMs','vmPlusGeometryMs','rasterMs','submissionMs','evaluations','draws','instrumentSeconds']
    writer=csv.DictWriter(file,fieldnames=columns)
    writer.writeheader()
    for comparison in comparisons:
        for backend in ('js','native'):
            writer.writerow({key:value for key,value in dict(preset=comparison['preset'],dynamic=comparison['dynamic'],backend=backend,**comparison[backend]).items() if key in columns})
print(json.dumps(dict(complete=complete,checks=len(checks),errors=errors,comparisons=comparisons,vmBench=benches),indent=2))
assert complete and len(phases)==24 and not errors and checks and all(check['passed'] for check in checks)
