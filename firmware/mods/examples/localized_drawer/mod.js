const DRAWER_KEY = 'localized-drawer:language'

export function onContextCreated(context) {
  const { localize } = context.i18n
  context.ui.drawer.addDrawerButton({
    key: DRAWER_KEY,
    label: localize('localizedDrawer.label'),
    callback(nextContext) {
      nextContext.ui.closeDrawer()
    },
  })
}
