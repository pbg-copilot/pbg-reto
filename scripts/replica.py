"""Export the original PostgreSQL structure and business data for the local RETO.

Private input and mapping/encryption keys MUST remain outside the repository.
Only emails, identifiers, phones and authentication secrets are transformed.
No production connections are made. Requires cryptography and pyahocorasick.
"""
import argparse
import base64
import collections
import gzip
import hashlib
import hmac
import json
import re
import subprocess
import uuid
from functools import lru_cache
from pathlib import Path

import ahocorasick
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from read_backup import rows_from_backup

EMPTY_TABLES = {
    'onboarding.sessions', 'onboarding.password_resets', 'onboarding.envelope_otp',
    'onboarding.signing_handoffs', 'onboarding.agent_webrtc_credentials',
    'onboarding.vsl_verification', 'public.pbg_corporate_sessions',
    'public.pbg_import_originals',
}
EMAIL = re.compile(r'(?<![A-Za-z0-9._%+-])[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]{1,128}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}')
PHONE = re.compile(r'(?<![\w])(?:\+1[ .-]?|1[ .-])?\(?([2-9]\d{2})\)?[ .-](\d{3})[ .-](\d{4})(?!\d)|(?<![\w])\+\d{8,15}(?!\d)')
UUID = re.compile(r'(?<![a-zA-Z0-9])[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![a-zA-Z0-9])')
OPAQUE_ID = re.compile(r'(?<![\w])(?:(?:acct|agy|lead|call|attempt|session|doc|env|evt|cus|sub|pi|pm|price|prod|si|in|cs|ch|re|tr)_[A-Za-z0-9_-]{8,}|[a-fA-F0-9]{32})(?![\w])')
SECRET_VALUE = re.compile(r'(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{15,}|(?:sk|rk)_live_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})')
LOCAL_COMPLIANCE_KEY = hashlib.sha256(b'RETO local compliance encryption key v2').digest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def normalized(key):
    return re.sub(r'[^a-z0-9]', '', str(key).lower())


def identifier_key(key):
    key = normalized(key)
    return key in {'id', 'ids', 'slug', 'handle', 'cardhandle', 'account', 'owner', 'ownerkey', 'agencykey', 'scopekey', 'owneraccount', 'producer', 'agentkey', 'memberkey'} or key.endswith(('id', 'ids', 'slug'))


def phone_key(key):
    key = normalized(key)
    return any(x in key for x in ('phone', 'telephone', 'mobile', 'whatsapp', 'e164')) or key in {'cell', 'ringto', 'ringfrom', 'forwardto', 'callbackcatcher', 'clientnumber', 'fromnumber', 'tonumber', 'replacesnumber', 'numbere164'}


def secret_key(key):
    key = normalized(key)
    return any(x in key for x in ('password', 'passwd', 'secret', 'apikey', 'accesstoken', 'refreshtoken', 'connecttoken', 'tokenhash', 'codehash', 'privatekey', 'authorization', 'recordingpasscode', 'fulfillmenttoken', 'sipusername')) or key in {'token', 'credential', 'credentials', 'cookie', 'connectionstring', 'databaseurl', 'complianceenckey'}


def numeric_type(typ):
    return typ.split()[0].split('(')[0] in {'bigint', 'integer', 'smallint', 'numeric', 'double', 'real', 'boolean', 'date', 'time', 'timestamp', 'interval', 'bytea'}


def natural_calendar_key(value):
    # Calendar buckets are natural keys, not private person/entity identifiers.
    return bool(re.fullmatch(r'(?:19|20)\d{2}-\d{2}(?:-\d{2})?(?:[ T].*)?',value) or re.fullmatch(r'(?:19|20)\d{6}',value))


def business_enum_literals(schema_text):
    return set(re.findall(r"'((?:[^']|'')*)'::text", schema_text))


class Mask:
    def __init__(self, key, compliance_keys):
        self.key = key
        self.ciphers = [AESGCM(k) for k in compliance_keys]
        self.local_cipher = AESGCM(LOCAL_COMPLIANCE_KEY)
        self.ids, self.emails, self.phones, self.secrets = {}, {}, {}, set()
        self.accounts = []
        self.stats = collections.Counter()
        self.auto = None

    def digest(self, value):
        return hmac.new(self.key, str(value).encode(), hashlib.sha256).digest()

    def id(self, value):
        if natural_calendar_key(value):
            return value
        if value not in self.ids:
            if value.isdecimal():
                size = len(value)
                self.ids[value] = str(10**(size-1) + int.from_bytes(self.digest('id:' + value)[:8],'big') % (9*10**(size-1)))
            else:
                self.ids[value] = str(uuid.UUID(bytes=self.digest('id:' + value)[:16], version=4))
        return self.ids[value]

    def phone(self, value):
        if str(value).startswith('+999'):
            return str(value)
        digits = re.sub(r'\D', '', str(value))
        if len(digits) == 11 and digits.startswith('1'):
            digits = digits[1:]
        if len(digits) < 7 or len(digits) > 15:
            return str(value)
        if digits not in self.phones:
            self.phones[digits] = '+999' + str(int.from_bytes(self.digest('phone:' + digits)[:8], 'big') % 10**12).zfill(12)
        return self.phones[digits]

    def email(self, value):
        key = value.lower()
        if key.count('@') == 1 and key.endswith('@reto.example'):
            return value
        if key not in self.emails:
            self.emails[key] = 'contacto.' + self.digest('email:' + key).hex()[:24] + '@reto.example'
        return self.emails[key]

    def decrypt(self, text):
        _, iv, data = text.split('.')
        for cipher in self.ciphers:
            try:
                return json.loads(cipher.decrypt(base64.b64decode(iv), base64.b64decode(data), None))
            except Exception:
                continue
        raise ValueError('Historical payload uses an unavailable key')

    def collect(self, value, key=''):
        if isinstance(value, dict):
            for k, v in value.items():
                if UUID.fullmatch(str(k)):
                    self.id(k)
                self.collect(v, k)
        elif isinstance(value, list):
            for v in value:
                self.collect(v, key)
        elif isinstance(value, str):
            if secret_key(key) and value and len(value) >= 8:
                self.secrets.add(value)
                return
            if value.startswith('v1.') and len(value.split('.')) == 3:
                try:
                    self.collect(self.decrypt(value))
                except ValueError:
                    pass
                return
            if value.startswith(('{', '[')):
                try:
                    self.collect(json.loads(value), key)
                    return
                except json.JSONDecodeError:
                    pass
            opaque = len(value)<=1000 and bool(UUID.fullmatch(value) or re.fullmatch(r'[a-fA-F0-9]{16,64}', value) or re.fullmatch(r'[A-Za-z0-9]+[_-][A-Za-z0-9_.-]{5,}', value) or value.isdecimal() or (':' in value and len(value)>24))
            slug_key = normalized(key).endswith(('slug','handle')) or normalized(key) in {'agencykey'}
            if identifier_key(key) and (opaque or slug_key) and value and len(value) >= 6 and len(value) <= 1000 and not any(c.isspace() for c in value) and not EMAIL.fullmatch(value):
                if not value.startswith(('http://','https://','/')):
                    self.id(value)
            for match in UUID.finditer(value):
                self.id(match[0])
            for match in OPAQUE_ID.finditer(value):
                self.id(match[0])
            if phone_key(key):
                self.phone(value)

    def build(self):
        self.text.cache_clear()
        self.auto = ahocorasick.Automaton()
        for original, replacement in self.ids.items():
            if not original.isalpha():
                self.auto.add_word(original, (original, replacement))
        for original in self.secrets:
            self.auto.add_word(original, (original, '[LOCAL_SECRET_REMOVED]'))
        for digits, replacement in self.phones.items():
            variants = [digits, '+' + digits]
            if len(digits) == 10:
                variants += ['1' + digits, '+1' + digits]
            for original in variants:
                self.auto.add_word(original, (original, replacement))
        self.auto.make_automaton()

    @lru_cache(maxsize=32768)
    def text(self, text):
        # Longest non-overlapping match; boundaries avoid changing ordinary word substrings.
        found = []
        for end, (original, replacement) in (self.auto.iter(text) if len(self.auto) else []):
            start = end - len(original) + 1
            if start and (text[start-1].isalnum() or text[start-1] == '_'):
                continue
            if end+1 < len(text) and (text[end+1].isalnum() or text[end+1] == '_'):
                continue
            found.append((start, -len(original), end+1, replacement))
        if found:
            at, parts = 0, []
            for start, _, end, replacement in sorted(found):
                if start < at:
                    continue
                parts.extend((text[at:start], replacement))
                at = end
            text = ''.join(parts) + text[at:]
        if '@' in text:
            text = EMAIL.sub(lambda m: self.email(m[0]), text)
        text = PHONE.sub(lambda m: self.phone(m[0]), text)
        text = SECRET_VALUE.sub('[LOCAL_SECRET_REMOVED]', text)
        text = re.sub(r'((?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[\"\x27]?\s*[:=]\s*[\"\x27])[^\"\x27\n]+', r'\1LOCAL_REMOVED', text, flags=re.I)
        # Never carry URL-embedded passwords or bearer query credentials into the demo.
        text = re.sub(r'([?&](?:token|access_token|api_key|secret|password)=)[^&\s\"<>]+', r'\1LOCAL_REMOVED', text, flags=re.I)
        return text

    def transform(self, value, key=''):
        if isinstance(value, dict):
            return {self.ids.get(k,self.text(k)): self.transform(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [self.transform(v, key) for v in value]
        if not isinstance(value, str):
            if isinstance(value,int) and not isinstance(value,bool) and identifier_key(key) and len(str(value)) >= 6:
                return int(self.ids.get(str(value),str(value)))
            if isinstance(value, (int, float)) and phone_key(key) and len(str(value)) >= 7:
                return int(self.phone(str(value)).lstrip('+'))
            return value
        if secret_key(key):
            # Inert, unique replacements also satisfy original NOT NULL/UNIQUE
            # constraints on business viewer/signing tokens. No original token
            # or its hash survives, and no replacement token is issued.
            return self.digest('inert-secret:'+normalized(key)+':'+value).hex() if value else value
        if normalized(key) in {'npn','licensenumber','agentnumber','agencynumber','agentstatelicense','eopolicynumber','policynumber'}:
            return value
        if value.startswith('v1.') and len(value.split('.')) == 3:
            try:
                plain = self.transform(self.decrypt(value))
            except ValueError:
                self.stats['unreadable_historical_ciphertexts_retained'] += 1
                return value
            iv = self.digest('local-iv:' + value)[:12]
            cipher = self.local_cipher.encrypt(iv, compact(plain).encode(), None)
            self.stats['reencrypted_payloads'] += 1
            return 'v1.' + base64.b64encode(iv).decode() + '.' + base64.b64encode(cipher).decode()
        if value.startswith(('{', '[')):
            try:
                return compact(self.transform(json.loads(value)))
            except json.JSONDecodeError:
                pass
        if phone_key(key) and 7 <= len(re.sub(r'\D', '', value)) <= 15 and not re.search(r'[A-Za-z]', value):
            return self.phone(value)
        if identifier_key(key) and value in self.ids:
            return self.ids[value]
        return self.text(value)


def escape_copy(value):
    if value is None:
        return r'\N'
    return str(value).replace('\\', '\\\\').replace('\t', r'\t').replace('\n', r'\n').replace('\r', r'\r')


def finalize_outputs(directory, mask):
    """Handle contacts and credentials encoded inside URLs, also in local ciphertext."""
    from urllib.parse import quote, unquote
    query = re.compile(r'([?&](?:amp;)?(?:pwd|passcode|token|access_token|refresh_token|api_key|password|secret|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s\"\x27<>\\]+',re.I)
    encoded_email = re.compile(r'(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,128}%40[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}',re.I)
    packed = re.compile(r'v1\.[A-Za-z0-9+/=]{12,24}\.[A-Za-z0-9+/=]+')
    local = AESGCM(LOCAL_COMPLIANCE_KEY)
    changes = 0
    def urls(text):
        text=query.sub(lambda m:m[1]+'LOCAL_REMOVED',text)
        text=encoded_email.sub(lambda m:quote(mask.email(unquote(m[0])),safe=''),text)
        # Historical malformed contacts can contain two @ signs. Mask the whole chain.
        text=re.sub(r'(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+(?:@[A-Za-z0-9._%+\-]+){2,}',lambda m:mask.email(m[0]),text)
        return EMAIL.sub(lambda m:mask.email(m[0]),text)
    def scope_rows(match):
        header,columns,rows,end=match.groups()
        names=[c.strip().strip('"') for c in columns.split(',')]
        position=names.index('scope_key')
        output=[]
        for line in rows.splitlines(keepends=True):
            fields=line.rstrip('\n').split('\t')
            value=fields[position]
            if value in mask.ids:
                fields[position]=mask.ids[value]
            output.append('\t'.join(fields)+'\n')
        return header+''.join(output)+end
    def encrypted(match):
        value=match[0]
        try:
            _,iv,cipher=value.split('.')
            plain=local.decrypt(base64.b64decode(iv),base64.b64decode(cipher),None).decode()
        except Exception:
            return value
        updated=urls(plain)
        if updated==plain:
            return value
        json.loads(updated)  # Never damage a serialized business payload.
        iv=hashlib.sha256(('RETO URL masking:'+value).encode()).digest()[:12]
        cipher=local.encrypt(iv,updated.encode(),None)
        return 'v1.'+base64.b64encode(iv).decode()+'.'+base64.b64encode(cipher).decode()
    for path in sorted(directory.glob('*.sql.gz')):
        original=gzip.decompress(path.read_bytes()).decode()
        updated=urls(packed.sub(encrypted,original))
        updated=re.sub(r'(COPY analytics\.day_rollup \((.*?)\) FROM stdin;\n)(.*?)(\\\.\n)',scope_rows,updated,flags=re.S)
        if updated!=original:
            path.write_bytes(gzip.compress(updated.encode(),mtime=0))
            changes+=1
    return changes


class Shards:
    def __init__(self, directory):
        self.directory, self.number, self.size = directory, 0, 0
        self.stream = None
        self.table = None

    def open(self):
        self.number += 1
        self.stream = gzip.GzipFile(filename=str(self.directory / f'10-data-{self.number:03}.sql.gz'), mode='wb', mtime=0)
        self.size = 0

    def close_table(self):
        if self.table:
            self.stream.write(b'\\.\n\n')
            self.table = None

    def write(self, table, row):
        if self.stream is None:
            self.open()
        if self.table != table or self.size > 64*1024*1024:
            self.close_table()
            if self.size > 64*1024*1024:
                self.stream.close()
                self.open()
            self.table = table
            header = 'COPY ' + table + ' (' + ', '.join('"' + k + '"' for k in row) + ') FROM stdin;\n'
            self.stream.write(header.encode())
        line = ('\t'.join(escape_copy(v) for v in row.values()) + '\n').encode()
        self.stream.write(line)
        self.size += len(line)

    def finish(self, sequences):
        self.close_table()
        for statement in sequences:
            self.stream.write(statement.encode())
        self.stream.close()


def schema(pg_restore, source, section):
    result = subprocess.run([pg_restore, '--schema-only', '--section='+section, '--no-owner', '--no-privileges', '--file=-', str(source)], capture_output=True, check=True, text=True)
    # pg_restore 17 adds a session setting PostgreSQL 16 does not recognize.
    return result.stdout.replace('SET transaction_timeout = 0;\n', '')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-dir', required=True)
    parser.add_argument('--pg-restore', default='pg_restore')
    parser.add_argument('--output', default='data/postgres')
    args = parser.parse_args()
    private = Path(args.private_dir).expanduser().resolve()
    if private.is_relative_to(Path(__file__).resolve().parents[1]):
        raise RuntimeError('Private input must be outside the repository')
    source = private / 'source.dump'
    provenance = json.loads((private/'backup-metadata.json').read_text())
    keys = [base64.b64decode(k) for k in json.loads((private/'compliance-keys.json').read_text())]
    mask = Mask((private/'mapping.key').read_bytes(), keys)
    raw = lambda **kw: rows_from_backup(source, args.pg_restore, **kw)
    original_accounts = []
    for table, row in raw(tables=['accounts', 'agencies']):
        if table == 'onboarding.accounts':
            original_accounts.append(row)
        elif table == 'onboarding.agencies':
            mask.ids[row['id']] = str(uuid.UUID(bytes=mask.digest('agency:' + row['id'])[:16], version=4))
    for i, account in enumerate(sorted(original_accounts, key=lambda x: x['id']), 1):
        original = account['id']
        mask.ids[original] = str(uuid.UUID(bytes=mask.digest('agent:' + original)[:16], version=4))
        email = f'agente{i:03}@reto.example'
        mask.emails[account['email'].lower()] = email
        mask.accounts.append({'id': mask.ids[original], 'username': f'agente{i:03}', 'email': email, 'role': account['role']})
    pre, post = schema(args.pg_restore, source, 'pre-data'), schema(args.pg_restore, source, 'post-data')
    column_types = {}
    for m in re.finditer(r'CREATE TABLE ([\w.]+) \((.*?)\n\);', pre, re.S):
        columns = {}
        for line in m[2].splitlines():
            match = re.match(r'\s*"?(\w+)"?\s+(.*)', line)
            if match and match[1] != 'CONSTRAINT':
                columns[match[1]] = match[2].rstrip(',')
        column_types[m[1]] = columns
    counts = collections.Counter({t: 0 for t in column_types})
    cache = private/'replica-index-v3.json'
    if cache.exists():
        index=json.loads(cache.read_text())
        if index.get('source_backup_sha256') != provenance['sha256']:
            raise RuntimeError('Private identifier index belongs to another backup; move it aside before regeneration')
        mask.ids=index['ids'];mask.emails=index['emails'];mask.phones=index['phones'];mask.secrets=set(index['secrets'])
        counts.update(index['counts'])
        print('Using private identifier index',flush=True)
    else:
        print('Pass 1: indexing identifiers and validating encrypted payloads', flush=True)
        for table, row in raw():
            counts[table] += 1
            if counts[table] == 1 and sum(c > 0 for c in counts.values()) % 20 == 0:
                print('Indexed through '+table,flush=True)
            if table in EMPTY_TABLES:
                continue
            for key, value in row.items():
                if value is not None and not numeric_type(column_types[table][key]):
                    mask.collect(value, key)
        cache.write_text(compact({'source_backup_sha256':provenance['sha256'],'ids':mask.ids,'emails':mask.emails,'phones':mask.phones,'secrets':list(mask.secrets),'counts':dict(counts)}))
        cache.chmod(0o600)
    literals = business_enum_literals(pre)
    mask.ids={before:after for before,after in mask.ids.items() if not natural_calendar_key(before) and before not in literals}
    mask.build()
    print(compact({'tables':len(column_types), 'source_rows':sum(counts.values()), 'identifier_mappings':len(mask.ids)}), flush=True)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    if list(out.glob('*.sql.gz')):
        raise RuntimeError('Use an empty output directory to avoid stale shards')
    for name, text in [('00-schema.sql.gz', pre), ('90-constraints.sql.gz', post)]:
        (out/name).write_bytes(gzip.compress(text.encode(), mtime=0))
    output_counts = collections.Counter({t: 0 for t in column_types})
    sequences, writer = [], Shards(out)
    preserve_hash = hashlib.sha256()
    kept = collections.Counter()
    salt = mask.digest('local-password-salt').hex()[:32]
    password_hash = 'scrypt$' + salt + '$' + hashlib.scrypt(b'123456',salt=salt.encode(),n=16384,r=8,p=1,dklen=64).hex()
    print('Pass 2: exporting all original tables and columns', flush=True)
    for table, row in raw(on_statement=sequences.append):
        if table in EMPTY_TABLES:
            continue
        result = {}
        for key, value in row.items():
            if value is None or numeric_type(column_types[table][key]):
                result[key] = value
            elif key == 'password_hash':
                result[key] = password_hash
            elif key == 'body_b64' and value:
                # This snapshot has a tiny PDF test fixture, not a client scan.
                data = base64.b64decode(value)
                if EMAIL.search(data.decode('latin1')) or PHONE.search(data.decode('latin1')):
                    raise RuntimeError('Embedded binary contains contact data; requires explicit document redaction')
                result[key] = value
            else:
                result[key] = mask.transform(value, key)
            if result[key] == value:
                kept[table] += 1
                preserve_hash.update(compact([table, key, value]).encode())
        # Settings values inherit the sensitivity of their setting's name.
        if secret_key(row.get('key', '')) and 'value' in result:
            result['value'] = ''
        writer.write(table, result)
        output_counts[table] += 1
    writer.finish(sequences)
    finalize_outputs(out,mask)
    provenance = json.loads((private/'backup-metadata.json').read_text())
    files = []
    for path in sorted(out.glob('*.sql.gz')):
        files.append({'path':'postgres/'+path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (out/'SHA256SUMS').write_text(''.join(f['sha256']+'  '+Path(f['path']).name+'\n' for f in files))
    manifest = {'format_version':2,'source':'AWS PostgreSQL backup','source_backup_at':provenance['timestamp'],
        'source_backup_sha256':provenance['sha256'],'schemas':sorted({t.split('.')[0] for t in column_types}),
        'table_count':len(column_types),'source_rows':sum(counts.values()),'exported_rows':sum(output_counts.values()),
        'source_table_counts':dict(counts),'table_counts':dict(output_counts),'original_column_definitions':column_types,
        'empty_security_tables':sorted(EMPTY_TABLES),'preserved_scalar_values':dict(kept),'preserved_values_sha256':preserve_hash.hexdigest(),
        'role_counts':dict(collections.Counter(a['role'] for a in mask.accounts)),
        'transformed':['emails','opaque text IDs and their references','phones','local passwords','production authentication secrets'],
        'preserved':['names','addresses','birth dates','NPN and license numbers','business amounts','dates','statuses','roles','agency ownership','notes and transcripts','all business rows and original table structure'],
        'encrypted_payloads_rekeyed':mask.stats['reencrypted_payloads'],
        'unreadable_historical_ciphertexts_retained':mask.stats['unreadable_historical_ciphertexts_retained'],'files':files,
        'media_note':'S3/R2 objects are not in the database backup. Their metadata and paths are retained with masked identifiers; no production media is downloaded.'}
    (out.parent/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (out.parent/'test-users.json').write_text(json.dumps(mask.accounts,ensure_ascii=False,indent=2)+'\n')
    (out.parent/'local-compliance-key.txt').write_text(base64.b64encode(LOCAL_COMPLIANCE_KEY).decode()+'\n')
    print(compact({'exported_rows':sum(output_counts.values()), 'tables':len(column_types),'shards':len(files),'compressed_bytes':sum(f['bytes'] for f in files),'roles':manifest['role_counts']}),flush=True)


if __name__ == '__main__':
    main()
