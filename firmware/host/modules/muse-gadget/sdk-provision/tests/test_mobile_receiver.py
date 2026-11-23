import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
ROOT=Path(__file__).parent.parent
sys.path.insert(0,str(ROOT))
import mobile_receiver as receiver
class Tests(unittest.TestCase):
 def test_default_refuses_before_key(self):
  with patch.object(sys,'argv',['receiver','--port','TEST','--expected-serial','PUBLIC','--envelope-file','unused']),patch.object(receiver,'OneShotEnvelope') as key,patch.object(sys,'stdout',io.StringIO()) as out:
   self.assertEqual(receiver.main(),1);key.assert_not_called();self.assertIn('APPROVAL REQUIRED',out.getvalue())
 def test_cipher_file_only_passes_to_callback(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'cipher';p.write_text(json.dumps({'v':1,'session':'public','ciphertext':'public'}));owner=Mock();save=Mock(return_value=True)
   self.assertTrue(receiver.receive(owner,p,save));save.assert_called_once_with(owner,{'v':1,'session':'public','ciphertext':'public'});owner.close.assert_called_once()
 def test_bad_or_large_file_never_saves(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'cipher'
   for value in ['{"v":1,"v":1}', 'A'*4097, '{']:
    p.write_text(value);owner=Mock();save=Mock()
    self.assertFalse(receiver.receive(owner,p,save));save.assert_not_called();owner.close.assert_called_once()
 def test_timeout_closes(self):
  owner=Mock();path=Mock();path.exists.return_value=False;save=Mock();ticks=iter([0,0,601])
  self.assertFalse(receiver.receive(owner,path,save,clock=lambda:next(ticks),sleep=lambda _:None));save.assert_not_called();owner.close.assert_called_once()
if __name__=='__main__':unittest.main()
