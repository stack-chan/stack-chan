# SPDX-License-Identifier: Apache-2.0
import argparse
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description='Separate Avatar DSL loop costs from timestamped instrument traces')
parser.add_argument('log', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
records = [json.loads(line) for line in args.log.read_text().splitlines()]
keys = next(row['line'][len('instruments key: '):].split(',') for row in records if row['line'].startswith('instruments key: '))
phases, checks, errors = [], [], []
active = None
complete = False
for row in records:
    line = row['line']
    if re.search(r'CHECK FAIL|startup failed|Guru Meditation|Backtrace|abort\(', line):
        errors.append(row)
    if '[AVDS-PROFILE] CHECK PASS' in line:
        checks.append(line)
    if '[AVDS-PROFILE] COMPLETE' in line:
        complete = True
    if match := re.search(r'\[AVDS-PROFILE\] (START|PHASE_BEGIN|PHASE_END) (\{.*\})', line):
        kind, data = match[1], json.loads(match[2])
        if kind == 'START':
            settings = data
        elif kind == 'PHASE_BEGIN':
            assert active is None
            active = dict(identity=data, samples=[])
        else:
            assert active is not None
            for key in ('preset', 'dynamic', 'repeat'):
                assert active['identity'][key] == data[key]
            samples = active['samples'][1:-1]
            assert len(samples) >= 5
            seconds = samples[-1]['t'] - samples[0]['t']
            frames = sum(sample['counters']['Frames drawn'] for sample in samples[1:])
            weights = [samples[i]['t'] - samples[i-1]['t'] for i in range(1, len(samples))]
            data['instrumentSeconds'] = seconds
            data['instrumentFrames'] = frames
            data['actualFps'] = frames / seconds
            for core in (0, 1):
                data['cpu'+str(core)] = sum(sample['counters']['CPU '+str(core)]*weight for sample, weight in zip(samples[1:], weights)) / seconds
            data['steadySamples'] = samples
            assert data['native']['evaluations'] > 0 and data['raster']['passes'] > 0
            assert data['raster']['unmatched'] == 0 and data['display']['ends'] > 0
            phases.append(data)
            active = None
    if active and line.startswith('instruments: '):
        values = list(map(int, line[len('instruments: '):].split(',')))
        assert len(keys) == len(values)
        active['samples'].append(dict(t=row['t'], counters=dict(zip(keys, values))))

def aggregate(rows):
    totals = {group: {key: sum(row[group][key] for row in rows) for key in rows[0][group]} for group in ('native', 'raster', 'state', 'display')}
    n, r, s, d = [totals[group] for group in ('native', 'raster', 'state', 'display')]
    seconds = sum(row['instrumentSeconds'] for row in rows)
    elapsed = sum(row['actualMs'] for row in rows)
    frames = d['ends']
    stages = dict(input=s['inputUs'], state=s['stateUs'], context=n['contextUs'], vm=n['vmUs'], geometry=n['geometryUs'], submission=r['submitUs'], nativeSubmission=n['rasterSubmitUs'], raster=r['rasterUs'], lcdBegin=d['beginUs'], lcdSendWait=d['sendUs'], lcdEnd=d['endUs'])
    per_draw = {key: value/frames/1000 for key, value in stages.items()}
    per_draw['unaccounted'] = elapsed/frames - sum(per_draw.values())
    return dict(actualFps=sum(row['instrumentFrames'] for row in rows)/seconds,
                fpsRuns=[row['actualFps'] for row in rows],
                cpu0=sum(row['cpu0']*row['instrumentSeconds'] for row in rows)/seconds,
                cpu1=sum(row['cpu1']*row['instrumentSeconds'] for row in rows)/seconds,
                periodMs=elapsed/frames, driverCycleMs=d['cycleUs']/d['cycleCount']/1000,
                stageMsPerDraw=per_draw,
                stateMsPerWrite=s['stateUs']/max(1, s['writes'])/1000,
                vmMsPerEvaluation=n['vmUs']/n['evaluations']/1000,
                geometryMsPerEvaluation=n['geometryUs']/n['evaluations']/1000,
                displayWallMsPerDraw=d['displayUs']/frames/1000,
                sendsPerDraw=d['sends']/frames, syncSends=d['syncSends'], asyncSends=d['asyncSends'],
                bytesPerDraw=d['bytes']/frames,
                copiesPerEvaluation=n['copiedBytes']/n['evaluations'],
                outlinesPerEvaluation=n['geometryChanges']/n['evaluations'],
                totals=totals)

groups = []
for preset in ('default', 'omega', 'aokko'):
    for dynamic in (False, True):
        rows = [phase for phase in phases if phase['preset'] == preset and phase['dynamic'] == dynamic]
        assert len(rows) == 2
        groups.append(dict(preset=preset, dynamic=dynamic, **aggregate(rows)))
assert complete and len(phases) == 12 and not errors and len(checks) == 37
result = dict(complete=complete, checks=len(checks), errors=errors, settings=settings, groups=groups, phases=phases,
              methods=dict(fps='SDK frame counters divided by actual monotonic serial elapsed time; omit boundary intervals.',
                           stages='Full-phase exclusive XS-thread API durations, normalized by completed driver frames. State includes native state-binding time; it is not added twice. Synthetic input generation is separate.',
                           lcd='Original C pixel-out dispatch passed through with unchanged buffer pointers, lengths, sync/async flags and driver waits. send includes queue/copy and waits; DMA may overlap raster. No extra flush or delay is introduced.',
                           period='Measured phase elapsed divided by completed display-end calls. Driver cycle is consecutive end-call spacing, not physical panel scan rate.',
                           remainder='Unaccounted wall time includes framework callbacks, event scheduling, bookkeeping and idle/wait. It is not assigned to idle solely from subtraction.',
                           copies='Explicit memcpy byte totals in face context/state/command publication, excluding SDK/VM internal copies and construction.'))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(dict(complete=complete, checks=len(checks), groups=groups), indent=2))
