import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const available = ['make', 'cc'].every((tool) => spawnSync(tool, ['--version']).status === 0)

test('ECMA Files selects its partition while legacy File retains its own mount', { skip: !available }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-files-partition-'))
  const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json')))
  const write = (name, source) => writeFileSync(path.join(directory, name), source)
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout.trim()
  }
  try {
    write(
      'esp_partition.h',
      `
typedef int esp_partition_type_t;
typedef int esp_partition_subtype_t;
typedef struct { const char *label; } esp_partition_t;
const esp_partition_t *esp_partition_find_first(int, int, const char *);
`,
    )
    write('mc.defines.h', '#define MODDEF_FILES_PARTITION "journal"\n')
    // A synthetic API consumer exercises the compiler integration without
    // copying SDK code. Duplicate table names also catch an unscoped rename.
    write(
      'consumer.c',
      `
#include "esp_partition.h"
const int gLFSErrors[] = {0};
const char *ENTRY(void) { return esp_partition_find_first(1, 2, "storage")->label; }
`,
    )
    write(
      'main.c',
      `
#include "esp_partition.h"
#include <stdio.h>
const char *legacy(void); const char *ecma(void);
const esp_partition_t *esp_partition_find_first(int type, int subtype, const char *label) {
  static esp_partition_t partition; partition.label = label; return &partition;
}
int main(void) { puts(legacy()); puts(ecma()); }
`,
    )
    mkdirSync(path.join(directory, 'objects'))
    write(
      'Makefile',
      `
C_FLAGS = ${manifest.platforms.esp32.build.C_FLAGS}
all: objects/modLittlefs.c.o objects/files-littlefs.c.o
objects/modLittlefs.c.o: consumer.c
\tcc -I. $(C_FLAGS) -DENTRY=legacy -c $< -o $@
objects/files-littlefs.c.o: consumer.c
\tcc -I. $(C_FLAGS) -DENTRY=ecma -c $< -o $@
`,
    )
    run('make', ['--no-print-directory'])
    const link = () =>
      run('cc', [
        '-I.',
        path.join(here, 'files-partition.c'),
        'main.c',
        'objects/modLittlefs.c.o',
        'objects/files-littlefs.c.o',
        '-o',
        'check',
      ])
    link()
    assert.equal(run('./check', []), 'storage\njournal')
    write('mc.defines.h', '')
    link()
    assert.equal(run('./check', []), 'storage\nstorage')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
