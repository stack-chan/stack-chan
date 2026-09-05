function onContextCreated(robot) {
  const dnssd = new device.network.dnssd.io(device.network.dnssd)
  function follow(service) {
    if (service.name !== 'stackchan') return
    const y = Number(service.txt?.get('yaw'))
    const p = Number(service.txt?.get('pitch'))
    if (Number.isFinite(y) && Number.isFinite(p)) robot.motion.setPose({ rotation: { y, p, r: 0 } }, 0.1)
  }
  dnssd.discover({ serviceType: '_http._tcp', onFound: follow, onUpdate: follow })
}
export default { onContextCreated }
