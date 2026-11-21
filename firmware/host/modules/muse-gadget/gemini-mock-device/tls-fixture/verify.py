"""Host checks only: verified TLS, wrong trust/name rejection, PCM identity and pacing."""
import base64, http.client, json, socket, ssl, threading, time
from prepare import OUT
from server import CIPHER, PCM, make_server

def context(trust=True):
    ctx=ssl.create_default_context(cafile=str(OUT/'fixture-ca.pem')) if trust else ssl.create_default_context()
    ctx.minimum_version=ctx.maximum_version=ssl.TLSVersion.TLSv1_2
    ctx.set_ciphers(CIPHER)
    return ctx

def main():
    server=make_server('127.0.0.1',0)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    port=server.server_port
    try:
        for trust,name in [(False,'127.0.0.1'),(True,'wrong.invalid')]:
            try:
                with socket.create_connection(('127.0.0.1',port)) as sock:
                    with context(trust).wrap_socket(sock,server_hostname=name): pass
                raise AssertionError('invalid trust or name accepted')
            except ssl.SSLCertVerificationError: pass
        for mode,size,count in [('burst','short',10),('burst','long',50),('realtime','short',10),('realtime','long',50)]:
            client=http.client.HTTPSConnection('127.0.0.1',port,context=context())
            client.connect();assert client.sock.version()=='TLSv1.2';assert client.sock.cipher()[0]==CIPHER
            start=time.monotonic();client.request('POST',f'/{mode}/{size}',b'{}');response=client.getresponse()
            assert response.status==200
            values=[];times=[]
            while line:=response.readline():
                if line.startswith(b'data: '): values.append(json.loads(line[6:]));times.append(time.monotonic())
            audio=[base64.b64decode(value['delta']['data']) for value in values if value['event_type']=='step.delta']
            assert audio==[PCM]*count and values[-1]['event_type']=='interaction.completed'
            if mode=='realtime': assert times[count-1]-times[0]>=(count-1)*.120-.1
            print(json.dumps({'test':mode,'size':size,'pcmBytes':sum(map(len,audio)),'elapsedMs':round((time.monotonic()-start)*1000)}))
            client.close()
        print('PASS: verified TLS1.2/cipher; untrusted CA and wrong SAN rejected; exact PCM and realtime pacing')
    finally: server.shutdown();server.server_close();thread.join()
if __name__=='__main__': main()
