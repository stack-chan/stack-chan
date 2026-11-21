import base64,importlib.util,json,pathlib,unittest,urllib.request,os
spec=importlib.util.spec_from_file_location('fixture',pathlib.Path(__file__).with_name('server.py'));fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
class FixtureTest(unittest.TestCase):
 def test_pcm(self):
  self.assertEqual(len(fixture.PCM),5760)
  self.assertEqual(sum(fixture.PCM),726208)
 def test_audio_event(self):
  data=json.loads(fixture.AUDIO[6:])
  self.assertEqual(base64.b64decode(data['delta']['data'],validate=True),fixture.PCM)
 def test_real_http_bytes(self):
  for path,count in [('short',10),('long',50)]:
   with urllib.request.urlopen(urllib.request.Request('http://'+os.environ.get('MOCK_TTS_HOST','127.0.0.1')+':18765/'+path,data=b'{}'),timeout=10) as response:
    self.assertEqual(response.status,200)
    chunks=response.read().split(b'\n\n')
   events=[json.loads(chunk[6:]) for chunk in chunks if chunk]
   self.assertEqual(len(events),count+1)
   self.assertEqual(events[-1]['interaction']['status'],'completed')
   pcm=b''.join(base64.b64decode(e['delta']['data'],validate=True) for e in events[:-1])
   self.assertEqual(pcm,fixture.PCM*count)
if __name__=='__main__':unittest.main()
