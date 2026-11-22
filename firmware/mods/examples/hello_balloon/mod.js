export function onContextCreated(context) {
  context.showBalloon('Hello from a MOD!')
  trace('[hello_balloon] balloon shown\n')
}
