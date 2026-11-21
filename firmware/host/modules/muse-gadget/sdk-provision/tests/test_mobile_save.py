import importlib.util
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from mobile_save import save_received
class Tests(unittest.TestCase):
 def arguments(self):
  return dict(approved=True,port_name='TESTPORT',expected_serial='PUBLIC-ID',list_ports=lambda:[SimpleNamespace(device='TESTPORT',vid=0x303A,pid=0x1001,serial_number='PUBLIC-ID')],serial_factory=Mock())
 def test_not_approved_does_not_decrypt_or_open(self):
  owner=Mock();args=self.arguments();args['approved']=False
  self.assertFalse(save_received(owner,{},**args));owner.consume.assert_not_called();args['serial_factory'].assert_not_called();owner.close.assert_called_once()
 def test_wrong_device_does_not_decrypt(self):
  owner=Mock();args=self.arguments();args['expected_serial']='OTHER'
  self.assertFalse(save_received(owner,{},**args));owner.consume.assert_not_called();args['serial_factory'].assert_not_called()
 def test_success_wipes_both_buffers(self):
  owner=Mock();clear=bytearray(b'mgst_'+b'A'*43);owner.consume.return_value=clear;args=self.arguments()
  args['serial_factory'].return_value.__enter__=Mock(return_value=object());args['serial_factory'].return_value.__exit__=Mock(return_value=False)
  captured=[]
  def exchange(port,payload): captured.append(payload);self.assertTrue(payload.startswith(b'SDK:'));return True
  with patch('mobile_save.exchange',exchange):self.assertTrue(save_received(owner,{},**args))
  self.assertEqual(clear,bytearray(48));self.assertEqual(captured[0],bytearray(53));owner.close.assert_called_once()
 def test_exception_is_fixed_failure_and_wipes(self):
  owner=Mock();owner.consume.side_effect=ValueError('DO NOT LOG');args=self.arguments()
  args['serial_factory'].return_value.__enter__=Mock(return_value=object());args['serial_factory'].return_value.__exit__=Mock(return_value=False)
  self.assertFalse(save_received(owner,{},**args));owner.close.assert_called_once()
if __name__=='__main__':unittest.main()
