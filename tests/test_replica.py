import sys,unittest,base64,json
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from replica import Mask,LOCAL_COMPLIANCE_KEY,business_enum_literals
class ReplicaTests(unittest.TestCase):
 def setUp(self):
  self.key=b'k'*32;self.aes=b'e'*32
  self.m=Mask(self.key,[self.aes])
 def test_business_fields_and_cross_references_survive(self):
  source={'id':'acct_abcdef0123456789','agency_id':'agy_example01','role':'agency_owner','name':'Ana Ejemplo','npn':'22386125','license_number':'FL998877','birth_date':'1980-02-03','premium':123.45,'status':'active','email':'ana@original.test','phone':'+14175550123','notes':'Llamar al +14175550123 o a ana@original.test','agency':{'id':'agy_example01','owner_account_id':'acct_abcdef0123456789'}}
  self.m.collect(source);self.m.build();result=self.m.transform(source)
  for key in ['role','name','npn','license_number','birth_date','premium','status']:self.assertEqual(result[key],source[key])
  self.assertEqual(result['agency_id'],result['agency']['id'])
  self.assertEqual(result['id'],result['agency']['owner_account_id'])
  self.assertNotIn('original.test',json.dumps(result));self.assertNotIn('4175550123',json.dumps(result))
  self.assertTrue(result['phone'].startswith('+999'))
 def test_encrypted_business_payload_is_masked_and_uses_local_key(self):
  source={'client_id':'client_abcdef123456','email':'cliente@original.test','phone':'4175550123','amount':280,'health':{'answer':'yes'},'password':'production-secret-value'}
  iv=b'i'*12;cipher=AESGCM(self.aes).encrypt(iv,json.dumps(source).encode(),None)
  packed='v1.'+base64.b64encode(iv).decode()+'.'+base64.b64encode(cipher).decode()
  self.m.collect(packed);self.m.build();result=self.m.transform(packed)
  _,iv,cipher=result.split('.')
  data=json.loads(AESGCM(LOCAL_COMPLIANCE_KEY).decrypt(base64.b64decode(iv),base64.b64decode(cipher),None))
  self.assertEqual(data['amount'],280);self.assertEqual(data['health'],source['health']);self.assertNotEqual(data['password'],source['password']);self.assertEqual(len(data['password']),64)
  self.assertTrue(data['email'].endswith('@reto.example'));self.assertNotEqual(data['client_id'],source['client_id'])
 def test_static_json_structure_is_preserved(self):
  source={'id':'default','default':{'status':'active','roles':['admin','agent','agency_owner']},'nullable':None,'enabled':True}
  self.m.collect(source);self.m.build();self.assertEqual(self.m.transform(source),source)
 def test_typo_in_email_domain_is_still_masked(self):
  self.m.build();result=self.m.text('Contact ana@yacht..com to confirm.')
  self.assertNotIn('yacht',result);self.assertIn('@reto.example',result)
 def test_malformed_email_chain_is_not_considered_already_masked(self):
  value='original@contacto.abcdef1234@reto.example'
  result=self.m.email(value)
  self.assertEqual(result.count('@'),1);self.assertTrue(result.endswith('@reto.example'))
 def test_provider_identifiers_are_masked_even_inside_notes(self):
  source={'default_payment_method':'pm_123456789abcdefg','note':'Invoice in_123456789abcdefg was paid.'}
  self.m.collect(source);self.m.build();result=self.m.transform(source)
  self.assertNotIn('pm_123456789abcdefg',json.dumps(result));self.assertNotIn('in_123456789abcdefg',json.dumps(result))
 def test_calendar_keys_never_replace_business_timestamps(self):
  source={'id':'2026-10-20','modified_at':'2026-10-20 22:17:16.950816+00','period':'2026-10','npn':'22386125'}
  self.m.collect(source);self.m.build();self.assertEqual(self.m.transform(source),source)
 def test_business_enum_literals_are_not_private_identifiers(self):
  literals=business_enum_literals("CHECK (status = ANY (ARRAY['in_progress'::text, 'done'::text]))")
  self.m.ids={'in_progress':'masked-value'}
  self.m.ids={k:v for k,v in self.m.ids.items() if k not in literals}
  self.m.build();self.assertEqual(self.m.transform('in_progress','status'),'in_progress')
if __name__=='__main__':unittest.main()
