"""Finalize an already generated local replica after resuming an interrupted export."""
import argparse
import hashlib
import json
from pathlib import Path
from replica import Mask,finalize_outputs,natural_calendar_key,business_enum_literals

parser=argparse.ArgumentParser()
parser.add_argument('--private-dir',required=True)
args=parser.parse_args()
private=Path(args.private_dir).expanduser().resolve()
mask=Mask((private/'mapping.key').read_bytes(),[])
index=json.loads((private/'replica-index-v3.json').read_text())
mask.emails=index['emails']
import gzip
literals=business_enum_literals(gzip.decompress(Path('data/postgres/00-schema.sql.gz').read_bytes()).decode())
mask.ids={before:after for before,after in index['ids'].items() if not natural_calendar_key(before) and before not in literals}
out=Path('data/postgres')
changed=finalize_outputs(out,mask)
manifest=json.loads(Path('data/manifest.json').read_text())
for file in manifest['files']:
    path=Path('data')/file['path']
    file['bytes']=path.stat().st_size
    file['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
Path('data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(out/'SHA256SUMS').write_text(''.join(f['sha256']+'  '+Path(f['path']).name+'\n' for f in manifest['files']))
print(json.dumps({'url_contact_and_credential_shards_updated':changed}))
