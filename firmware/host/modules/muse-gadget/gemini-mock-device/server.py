import http.server,json,time,os
PCM=bytes(range(256))*22+bytes(range(128))
def event(value):return ('data: '+json.dumps(value,separators=(',',':'))+'\n\n').encode()
import base64
AUDIO=event({'event_type':'step.delta','delta':{'type':'audio','mime_type':'audio/l16;rate=24000','data':base64.b64encode(PCM).decode()}})
DONE=event({'event_type':'interaction.completed','interaction':{'status':'completed'}})
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  started=time.monotonic();sent=0
  try:
   length=int(self.headers.get('content-length','0'))
   if length>32768: self.send_error(413);return
   self.rfile.read(length)
   count=50 if self.path=='/long' else 10
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Transfer-Encoding','chunked');self.send_header('Connection','close');self.end_headers()
   for part in [AUDIO]*count+[DONE]:
    self.wfile.write(('%X\r\n'%len(part)).encode()+part+b'\r\n');self.wfile.flush();sent+=len(part)
   self.wfile.write(b'0\r\n\r\n');self.wfile.flush()
   print(json.dumps({'phase':'served','events':count,'bytes':sent,'ms':round((time.monotonic()-started)*1000)}),flush=True)
  except (ConnectionError,OSError):print(json.dumps({'phase':'disconnect','bytes':sent}),flush=True)
if __name__=='__main__':
 print(json.dumps({'phase':'ready','pcmBytes':len(PCM),'eventBytes':len(AUDIO)}),flush=True)
 http.server.ThreadingHTTPServer((os.environ.get('MOCK_TTS_HOST','127.0.0.1'),18765),Handler).serve_forever()
