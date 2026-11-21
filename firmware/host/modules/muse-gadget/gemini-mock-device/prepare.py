"""Derive the mock build from the real StopWatch bindings without copying resources."""
import json,os,pathlib,sys
root=pathlib.Path(__file__).resolve().parent
base=root.parent/'setup-device'
def rebase(value):
 if isinstance(value,dict):return {key:rebase(item) for key,item in value.items()}
 if isinstance(value,list):return [rebase(item) for item in value]
 if isinstance(value,str) and value.startswith(('./','../')):
  return pathlib.Path(os.path.relpath((base/value).resolve(),root)).as_posix()
 return value
manifest=rebase(json.loads((base/'manifest.json').read_text()))
manifest['build']['NAME']='gemini-mock-stopwatch'
manifest['modules']['main']='./main'
manifest['modules']['mock-config']='./mock-config'
endpoint=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:18765'
if not endpoint.startswith('http://'):raise ValueError('This fixture requires plain HTTP, no credentials')
(root/'mock-config.js').write_text('export default '+json.dumps(endpoint)+'\n',newline='\n')
manifest['modules']['offline-heap']='../__tests__/cascaded-device/heap'
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',newline='\n')
