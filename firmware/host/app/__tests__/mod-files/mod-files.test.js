import Files from 'embedded:storage/files'
import { listModFiles, readModFile } from 'mod-files'
import { validateXsaArchive } from 'mod-installer'
import { equal } from 'testing/assert'

// POSIX scratch directory only; never touches an attached SD card.
const fixture = 'stackchan-mod-files-test-731'
if (!Files.createDirectory(fixture)) throw new Error('scratch directory already exists')
const root = Files.openDirectory({ path: fixture })
try {
  root.createDirectory('mods')
  const archive = new Uint8Array([0, 0, 0, 20, 88, 83, 95, 65, 0, 0, 0, 12, 86, 69, 82, 83, 17, 9, 2, 0])
  const file = root.openFile({ path: 'mods/demo.xsa', mode: 'w' })
  try {
    file.write(archive, 0)
  } finally {
    file.close()
  }
  root.createDirectory('mods/directory.xsa')
  equal(listModFiles(root).join(','), 'demo.xsa', 'standard Files lists only regular MOD files')
  const bytes = readModFile(root, 'demo.xsa', archive.byteLength)
  equal(new Uint8Array(bytes).join(','), archive.join(','), 'standard Files reads exact bytes')
  equal(validateXsaArchive(bytes, 20, [17, 7, 17, 9]).byteLength, 20, 'v10 accepts XS17.9 MOD')
  let rejected = false
  try {
    validateXsaArchive(bytes, 20, [17, 7, 17, 8])
  } catch {
    rejected = true
  }
  equal(rejected, true, 'SDK9.5 rejects XS17.9 MOD')
  rejected = false
  try {
    readModFile(root, 'demo.xsa', 19)
  } catch {
    rejected = true
  }
  equal(rejected, true, 'read bound applied before allocation')
} finally {
  root.delete('mods/demo.xsa')
  root.delete('mods/directory.xsa')
  root.delete('mods')
  root.close()
  Files.delete(fixture)
}
trace('ok\n')
