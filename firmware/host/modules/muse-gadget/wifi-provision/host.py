import argparse,getpass,json,sys,time,warnings
import serial
from serial.tools import list_ports

parser = argparse.ArgumentParser(description='Send Wi-Fi settings to an identified StopWatch')
parser.add_argument('--port', required=True)
parser.add_argument('--usb-serial', required=True)
options = parser.parse_args()

def matched():
 return any(
  p.device == options.port and p.vid == 0x303a and p.pid == 0x1001
  and p.serial_number == options.usb_serial
  for p in list_ports.comports()
 )
if not sys.stdin.isatty() or not matched():
 print('UNAVAILABLE',flush=True);sys.exit(1)
line=''
payload=None
warnings.simplefilter('error',getpass.GetPassWarning)
try:
 line=getpass.getpass('PRIVATE WIFI INPUT: ')
 canary=line=='CANARY'
 if line=='CANARY': payload=bytearray(b'CANARY\n')
 else:
  data=json.loads(line)
  if not isinstance(data,dict) or set(data)!={'ssid','password'} or not all(isinstance(v,str) for v in data.values()):raise ValueError()
  if any('\0' in v or '\r' in v or '\n' in v for v in data.values()):raise ValueError()
  if not 1<=len(data['ssid'].encode())<=32 or not 8<=len(data['password'].encode())<=63:raise ValueError()
  payload=bytearray((json.dumps(data,ensure_ascii=True,separators=(',',':'))+'\n').encode());data.clear()
 line=''
 if len(payload)>511 or not matched():raise ValueError()
 allowed={b'MUSE WIFI INPUT READY',b'MUSE WIFI CANARY PASS',b'MUSE WIFI ACCOUNT UPDATED',b'MUSE WIFI FALLBACK SAVED',b'MUSE WIFI CONNECTED',b'MUSE WIFI CONNECT FAILED',b'MUSE WIFI REJECTED',b'MUSE WIFI UNAVAILABLE',b'MUSE WIFI TIMEOUT'}
 with serial.Serial(options.port,115200,timeout=.2,write_timeout=1) as port:
  port.reset_input_buffer();port.dtr=False;port.rts=True;time.sleep(.1);port.rts=False
  pending=bytearray();end=time.monotonic()+60;sent=False
  while time.monotonic()<end:
   pending.extend(port.read(1024))
   while b'\n' in pending:
    n=pending.index(10);record=bytes(pending[:n]).rstrip(b'\r');del pending[:n+1]
    if record not in allowed:continue
    print(record.decode(),flush=True)
    if record==b'MUSE WIFI INPUT READY' and not sent:
     for offset in range(0,len(payload),24):
      chunk=payload[offset:offset+24]
      try:
       if port.write(chunk)!=len(chunk):raise RuntimeError()
      finally:chunk[:]=b'\0'*len(chunk)
      time.sleep(.04)
     payload[:]=b'\0'*len(payload);sent=True
    elif sent and record==(b'MUSE WIFI CANARY PASS' if canary else b'MUSE WIFI CONNECTED'):sys.exit(0)
    elif record in {b'MUSE WIFI CONNECT FAILED',b'MUSE WIFI REJECTED',b'MUSE WIFI UNAVAILABLE',b'MUSE WIFI TIMEOUT'}:sys.exit(1)
   if len(pending)>4096:pending[:]=b''
  raise RuntimeError()
except Exception:
 print('FAILED',flush=True);sys.exit(1)
finally:
 line=''
 if payload is not None:payload[:]=b'\0'*len(payload)
