// Called by the minimal boot entry before importing the application or UI.
export default function detachModArchive() {
  native('xs_stackchan_detach_mod_archive').call(null)
}
