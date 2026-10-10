import { Directory } from 'embedded:x-files-implementation'

// SDK Files root bootstrap, deferred until GPIO35 is handed to SD. Keeping
// bootstrap out of module evaluation lets a failed mount be retried this boot.
// Files/FAT/VFS still own all mounting, unmounting and IO implementation.
export default function openSDRoot() {
  const files = new (Native('xs_directoryvfs_destructor'))()
  Object.setPrototypeOf(files, Directory.prototype)
  native('xs_directoryvfs_bootstrap').call(undefined, files, undefined)
  return files
}
