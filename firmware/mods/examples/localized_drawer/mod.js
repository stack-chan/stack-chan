const DRAWER_KEY = 'localized-drawer:language'

export function onContextCreated(context) {
  // Use the host-owned capability so mcrun's modLocals resources are resolved
  // with the same locale as the host UI.
  const { localize } = context.i18n
  context.ui.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: localize('localizedDrawer.label'),
    callback(nextContext) {
      nextContext.ui.closeDrawer()
    },
  })
}
