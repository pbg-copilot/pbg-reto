"""Check exported SQL against PRIVATE original identifiers, contacts and secrets.

Prints counts only. Never prints original source values or private keys.
"""
import argparse
import base64
import collections
import gzip
import hashlib
import json
import re
from pathlib import Path
import ahocorasick
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from replica import LOCAL_COMPLIANCE_KEY,natural_calendar_key

parser=argparse.ArgumentParser()
parser.add_argument('--private-dir',required=True)
args=parser.parse_args()
index=json.loads((Path(args.private_dir).expanduser()/'replica-index-v3.json').read_text())
lookup=ahocorasick.Automaton()
for original in index['ids']:
    if len(original)>=16 and not original.isdecimal() and not original.isalpha() and not natural_calendar_key(original):lookup.add_word(original,(original,'identifier'))
for original in index['secrets']:
    if len(original)>=16:lookup.add_word(original,(original,'secret'))
for original in index['phones']:
    if len(original)>=10:lookup.add_word(original,(original,'phone'))
lookup.make_automaton()
findings=collections.Counter()
cipher=AESGCM(LOCAL_COMPLIANCE_KEY)
packed=re.compile(r'v1\.[A-Za-z0-9+/=]{12,24}\.[A-Za-z0-9+/=]+')

def inspect(text):
    for end,(original,kind) in lookup.iter(text):
        start=end-len(original)+1
        if start and (text[start-1].isalnum() or text[start-1]=='_'):continue
        if end+1<len(text) and (text[end+1].isalnum() or text[end+1]=='_'):continue
        findings[kind]+=1

for path in sorted(Path('data/postgres').glob('*.sql.gz')):
    with gzip.open(path,'rt') as stream:
        for line in stream:
            inspect(line)
            for match in packed.finditer(line):
                try:
                    _,iv,data=match[0].split('.')
                    plain=cipher.decrypt(base64.b64decode(iv),base64.b64decode(data),None).decode()
                except Exception:continue
                inspect(plain)
manifest=json.loads(Path('data/manifest.json').read_text())
report={'source_backup_sha256':manifest['source_backup_sha256'],
        'dataset_files_sha256':hashlib.sha256(''.join(f['sha256'] for f in manifest['files']).encode()).hexdigest(),
        'original_patterns_checked':len(lookup),'original_value_findings':dict(findings)}
Path('data/privacy-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
if findings:raise SystemExit('Original values found; review privately before publication')
