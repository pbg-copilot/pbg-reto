"""Fingerprint source relationships after applying the same private ID mapping."""
import argparse
import hashlib
import json
from pathlib import Path
from read_backup import rows_from_backup
from replica import Mask,natural_calendar_key

fields={
    'onboarding.accounts':['id','agency_id','setter_for_account_id'],
    'onboarding.agencies':['id','owner_account_id'],
    'onboarding.agency_team_leads':['agency_id','leader_account_id','member_account_id'],
    'analytics.agents':['account_id','agency_key'],
    'analytics.calls':['account_id','agency_key','attempt_id'],
    'analytics.day_rollup':['day_et','scope','scope_key'],
}
parser=argparse.ArgumentParser()
parser.add_argument('--private-dir',required=True)
parser.add_argument('--pg-restore',default='pg_restore')
args=parser.parse_args()
private=Path(args.private_dir).expanduser()
index=json.loads((private/'replica-index-v3.json').read_text())
mask=Mask((private/'mapping.key').read_bytes(),[])
mask.ids={k:v for k,v in index['ids'].items() if not natural_calendar_key(k)}
mask.emails=index['emails'];mask.phones=index['phones'];mask.secrets=set(index['secrets']);mask.build()
hashes={t:[] for t in fields}
for table,row in rows_from_backup(private/'source.dump',args.pg_restore,tables=[t.split('.')[1] for t in fields]):
    if table not in fields:continue
    values=[mask.transform(row.get(column),column) for column in fields[table]]
    value=json.dumps(values,ensure_ascii=False,separators=(',',':'))
    hashes[table].append(hashlib.sha256(value.encode()).hexdigest())
proofs={t:{'fields':fields[t],'rows':len(h),'sha256':hashlib.sha256(''.join(sorted(h)).encode()).hexdigest()} for t,h in hashes.items()}
Path('data/relationships.json').write_text(json.dumps(proofs,indent=2)+'\n')
print(json.dumps({'source_relationship_fingerprints':len(proofs)}))
