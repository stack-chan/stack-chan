"""Prepared save adapter; no CLI, automatic receiver, or implicit approval."""
from host import exchange


def save_received(owner, envelope, *, approved=False, port_name=None,
                  expected_serial=None, list_ports=None, serial_factory=None):
    clear = bytearray()
    payload = bytearray()
    try:
        if approved is not True or not port_name or not expected_serial:
            return False
        if list_ports is None or serial_factory is None:
            return False
        matches = [port for port in list_ports()
                   if port.device == port_name and port.vid == 0x303A
                   and port.pid == 0x1001 and port.serial_number == expected_serial]
        if len(matches) != 1:
            return False
        with serial_factory(port_name, 115200, timeout=.2, write_timeout=1) as port:
            clear = owner.consume(envelope)
            payload.extend(b"SDK:")
            payload.extend(clear)
            payload.extend(b"\n")
            return exchange(port, payload)
    except Exception:
        return False
    finally:
        clear[:] = b"\0" * len(clear)
        payload[:] = b"\0" * len(payload)
        owner.close()
