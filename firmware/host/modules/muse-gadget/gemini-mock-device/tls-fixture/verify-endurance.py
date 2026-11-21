"""Loopback-only checks for endurance fault injection, exact pattern and bounded timing."""
import http.client,json,threading,time
from server import make_server,PCM,DONE
from verify import context
def main():
    server=make_server('127.0.0.1',0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        for route,count in [('burst/extended',200),('stall/short',10),('missing/short',10),('cut/short',5),('burst/short',10),('slow/short',10)]:
            client=http.client.HTTPSConnection('127.0.0.1',server.server_port,context=context(),timeout=30)
            started=time.monotonic();client.request('POST','/'+route,b'{}');response=client.getresponse()
            assert response.status==200
            body=bytearray();truncated=False
            try:
                while block:=response.read(1):body.extend(block)
            except http.client.IncompleteRead:truncated=True
            if route.startswith('cut/'):
                assert truncated and body.count(b'"event_type":"step.delta"')>=count
                assert DONE not in body
            else:
                import base64
                events=[json.loads(line[6:]) for line in body.splitlines() if line.startswith(b'data: ')]
                frames=[base64.b64decode(x['delta']['data']) for x in events if x['event_type']=='step.delta']
                assert frames==[PCM]*count and not truncated
                assert (DONE in body)==(not route.startswith('missing/'))
            elapsed=time.monotonic()-started
            if route.startswith('stall/'):assert elapsed>=1.0
            if route.startswith('slow/'):assert elapsed>=2.0
            print(json.dumps({'route':route,'passed':True,'elapsedMs':round(elapsed*1000),'bytes':len(body),'truncated':truncated}))
            client.close()
    finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':main()
