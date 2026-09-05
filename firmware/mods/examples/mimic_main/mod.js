import Timer from 'timer'

/** Advertise the current pose after claiming the local DNS-SD host name. */
function onContextCreated(robot) {
  const dnssd = new device.network.dnssd.io(device.network.dnssd)
  let advertisement
  dnssd.claim({
    host: 'stackchan',
    /** Start advertising only after the host name has been claimed. */
    onReady() {
      advertisement = dnssd.advertise({
        host: 'stackchan',
        name: 'stackchan',
        serviceType: '_http._tcp',
        port: 80,
        txt: new Map([
          ['yaw', '0.0'],
          ['pitch', '0.0'],
        ]),
      })
    },
    /** Report a name conflict without advertising an unclaimed host. */
    onError() {
      trace('DNS-SD: stackchan.local is unavailable\n')
    },
  })
  Timer.repeat(() => {
    if (!advertisement) return
    const { y, p } = robot.pose.body.rotation
    advertisement.updateTXT(
      new Map([
        ['yaw', String(y)],
        ['pitch', String(p)],
      ]),
    )
  }, 100)
}
export default { onContextCreated, autoLoop: false }
