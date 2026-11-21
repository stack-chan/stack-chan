import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock
spec=importlib.util.spec_from_file_location("sdk_host",Path(__file__).parent.parent/"host.py")
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
class Tests(unittest.TestCase):
 def test_validation(self):
  self.assertTrue(host.valid_token("mgst_"+"A"*43))
  for value in ["", "mgst_"+"A"*42, "mgst_"+"A"*42+"B", "mgst_"+"!"*43]:self.assertFalse(host.valid_token(value))
 def test_non_tty_never_prompts(self):
  with patch.object(sys,"argv",["host.py"]),patch.object(sys,"stdin",Mock(isatty=lambda:False)),patch.object(sys,"stdout",io.StringIO()) as out,patch.object(host.getpass,"getpass") as prompt:
   self.assertEqual(host.main(),1);prompt.assert_not_called();self.assertNotIn("mgst_",out.getvalue())
 def test_argument_error_does_not_echo(self):
  with patch.object(sys,"argv",["host.py","--token","PRIVATE_FIXTURE"]),patch.object(sys,"stderr",io.StringIO()) as out:
   with self.assertRaises(SystemExit):host.main()
   self.assertNotIn("PRIVATE_FIXTURE",out.getvalue())
 def test_canary_ack_is_not_save_ack(self):
  class Port:
   def __init__(self):self.n=0
   def read(self,_):self.n+=1;return b'MUSE SDK INPUT READY\n' if self.n==1 else b'MUSE SDK CANARY PASS\n'
   def reset_input_buffer(self):pass
   def write(self,data):return len(data)
  ticks=iter(range(100))
  with patch.object(host.time,'sleep'),patch.object(host.time,'monotonic',side_effect=lambda:next(ticks)):
   self.assertFalse(host.exchange(Port(),bytearray(b'SDK:mgst_'+b'A'*43+b'\n')))
 def test_short_write_fails_and_wipes_chunk(self):
  class Port:
   def reset_input_buffer(self):self.cleared=True
   def read(self,_):return b'MUSE SDK INPUT READY\n'
   def write(self,data):self.chunk=data;return len(data)-1
  port=Port()
  with patch.object(host.time,'sleep'):
   self.assertFalse(host.exchange(port,bytearray(b'CANARY\n')))
  self.assertTrue(port.cleared);self.assertEqual(port.chunk,bytearray(7))
 def test_wrong_usb_identity_refuses_before_prompt(self):
  with patch.object(sys,'argv',['host.py','--expected-serial','PUBLIC']),patch.object(sys,'stdin',Mock(isatty=lambda:True)),patch.object(host,'matching_device',return_value=False),patch.object(host.getpass,'getpass') as prompt,patch.object(sys,'stdout',io.StringIO()):
   self.assertEqual(host.main(),1);prompt.assert_not_called()
 def test_changed_usb_identity_refuses_after_prompt(self):
  import serial
  with patch.object(sys,'argv',['host.py','--expected-serial','PUBLIC']),patch.object(sys,'stdin',Mock(isatty=lambda:True)),patch.object(host,'matching_device',side_effect=[True,False]),patch('builtins.input',return_value='SAVE'),patch.object(host.getpass,'getpass',return_value='mgst_'+'A'*43),patch.object(serial,'Serial') as opened,patch.object(sys,'stdout',io.StringIO()):
   self.assertEqual(host.main(),1);opened.assert_not_called()
 def test_canary_exchange(self):
  class Port:
   def __init__(self):self.sent=bytearray();self.n=0
   def read(self,_):self.n+=1;return b'MUSE SDK INPUT READY\n' if self.n==1 else b'MUSE SDK CANARY PASS\n'
   def reset_input_buffer(self):pass
   def write(self,data):self.sent.extend(data);return len(data)
  port=Port()
  with patch.object(host.time,"sleep"):
   self.assertTrue(host.exchange(port,bytearray(b'CANARY\n')))
  self.assertEqual(port.sent,b'CANARY\n')
if __name__=='__main__':unittest.main()
