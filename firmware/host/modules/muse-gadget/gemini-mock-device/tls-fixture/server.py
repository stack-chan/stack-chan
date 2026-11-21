"""LAN-only TLS 1.2 synthetic SSE fixture. Never logs or forwards request bodies."""
import argparse, base64, http.server, json, ssl, time
from pathlib import Path
from prepare import OUT, private_ipv4
PCM = bytes(range(256))*22 + bytes(range(128))
def event(value): return ('data: '+json.dumps(value,separators=(',',':'))+'\n\n').encode()
AUDIO = event({'event_type':'step.delta','delta':{'type':'audio','mime_type':'audio/L16;rate=24000','data':base64.b64encode(PCM).decode()}})
DONE = event({'event_type':'interaction.completed','interaction':{'status':'completed'}}) + b'event: done\ndata: [DONE]\n\n'
CIPHER = 'ECDHE-RSA-AES128-GCM-SHA256'
JITTER = (0, .015, -.010, .005, -.010)
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self,*args): pass
    def do_POST(self):
        if self.headers.get('authorization') or self.headers.get('x-goog-api-key'):
            self.send_error(403); return
        route=self.path.strip('/').split('/')
        if len(route)!=2 or route[0] not in ('burst','realtime','stall','cut','missing','slow') or route[1] not in ('short','long','extended'):
            self.send_error(404); return
        length=int(self.headers.get('content-length','0'))
        if length<0 or length>32768 or self.headers.get('transfer-encoding'):
            self.send_error(413); return
        self.rfile.read(length)
        count={'short':10,'long':50,'extended':200}[route[1]]
        started=time.monotonic();sent=0;previous=None;max_gap=0
        try:
            self.send_response(200);self.send_header('Content-Type','text/event-stream')
            self.send_header('Transfer-Encoding','chunked');self.send_header('Connection','close');self.end_headers()
            for index in range(count):
                if route[0] in ('realtime','stall','cut','slow'):
                    target=started+index*(.240 if route[0]=='slow' else .120)+JITTER[index%len(JITTER)]
                    time.sleep(max(0,target-time.monotonic()))
                if route[0]=='stall' and index==count//2: time.sleep(.350)
                if route[0]=='cut' and index==count//2:
                    self.wfile.write(('%X\r\n'%len(AUDIO)).encode()+AUDIO[:len(AUDIO)//2]);self.wfile.flush()
                    self.close_connection=True
                    print(json.dumps({'phase':'cut','pcmBytes':sent}),flush=True)
                    return
                now=time.monotonic()
                if previous is not None: max_gap=max(max_gap,now-previous)
                previous=now
                self.wfile.write(('%X\r\n'%len(AUDIO)).encode()+AUDIO+b'\r\n');self.wfile.flush();sent+=len(PCM)
            if route[0]!='missing': self.wfile.write(('%X\r\n'%len(DONE)).encode()+DONE+b'\r\n')
            self.wfile.write(b'0\r\n\r\n');self.wfile.flush()
            print(json.dumps({'phase':'served','pacing':route[0],'events':count,'pcmBytes':sent,'elapsedMs':round((time.monotonic()-started)*1000),'maxSendGapMs':round(max_gap*1000),'tls':self.connection.version(),'cipher':self.connection.cipher()[0]}),flush=True)
            time.sleep(self.server.close_delay_ms / 1000)
        except (ConnectionError,OSError):
            print(json.dumps({'phase':'disconnect','pcmBytes':sent}),flush=True)

def make_server(host,port,close_delay_ms=0):
    if not 0 <= close_delay_ms <= 20000: raise ValueError("close delay outside fixture limit")
    private_ipv4(host)
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version=context.maximum_version=ssl.TLSVersion.TLSv1_2
    context.set_ciphers(CIPHER);context.set_ecdh_curve('prime256v1')
    context.load_cert_chain(OUT/'server.pem',OUT/'server-key.pem')
    context.set_alpn_protocols(['http/1.1'])
    server=http.server.ThreadingHTTPServer((host,port),Handler)
    server.close_delay_ms=close_delay_ms
    server.socket=context.wrap_socket(server.socket,server_side=True)
    return server
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,default=18766)
    parser.add_argument('--close-delay-ms',type=int,default=0);args=parser.parse_args();server=make_server(args.host,args.port,args.close_delay_ms)
    print(json.dumps({'phase':'ready','host':args.host,'port':server.server_port,'pcmBytes':len(PCM),'cipher':CIPHER,'tls':'TLSv1.2'}),flush=True)
    server.serve_forever()
