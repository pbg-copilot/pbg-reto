"""Create the distributable challenge dataset from a PRIVATE backup extraction.

Only allowlisted business fields are exported. Authentication material, billing,
media, free text, filenames, provider links and old state backups never leave the
private source. IDs are replaced with a keyed mapping kept outside the repository.
"""
import argparse
import collections
import gzip
import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

STATES = set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split())
FIRST = ['Camila', 'Mateo', 'Valentina', 'Daniel', 'Lucía', 'Gabriel', 'Mariana', 'Nicolás', 'Elena', 'Diego', 'Sofía', 'Andrés', 'Isabel', 'Samuel', 'Julia', 'Tomás']
LAST = ['Torres', 'Rivera', 'Vega', 'Castro', 'Soto', 'Molina', 'Rojas', 'Luna', 'Silva', 'Reyes', 'Romero', 'Flores', 'Medina', 'Cruz', 'Paz', 'León']
STAGES = {'new', 'contacted', 'appointment', 'quoted', 'application', 'sold', 'closed', 'lost', 'won', 'nurture', 'followup', 'cita', 'nuevo', 'contactado'}


class Builder:
    def __init__(self, key):
        self.key = key
        self.seed = {k: [] for k in ['agencies', 'agents', 'clients', 'licenses', 'quotes', 'appointments', 'notes', 'source_records']}
        self.agents, self.clients, self.names = {}, {}, {}
        self.counts = collections.Counter()

    def number(self, value):
        return int.from_bytes(hmac.new(self.key, str(value).encode(), hashlib.sha256).digest()[:8], 'big')

    def uid(self, value):
        raw = hmac.new(self.key, str(value).encode(), hashlib.sha256).digest()[:16]
        return str(uuid.UUID(bytes=raw, version=4))

    def name(self, value):
        n = self.number(value)
        return FIRST[n % len(FIRST)] + ' ' + LAST[(n // len(FIRST)) % len(LAST)]

    def phone(self, value):
        # +999 is deliberately non-routable. The identifier never embeds the source number.
        return '+999000' + str(self.number(value) % 10**9).zfill(9)

    def state(self, value):
        value = str(value or '').upper().strip()
        return value if value in STATES else ''

    def agent(self, key):
        key = str(key or 'unassigned-local')
        if key not in self.agents:
            n = len(self.agents) + 1
            a = {'id': self.uid('agent:' + key), 'agency_id': None, 'username': 'agente' + str(n).zfill(3),
                 'email': 'agente' + str(n).zfill(3) + '@reto.example', 'name': self.name('agent:' + key),
                 'phone': self.phone('agent:' + key), 'role': 'agent', 'profile': {'synthetic': True}}
            self.agents[key] = a
            self.seed['agents'].append(a)
        return self.agents[key]

    def client(self, key, owner, name='', state='', stage='new'):
        key = str(key)
        if key not in self.clients:
            agent = self.agent(owner)
            n = self.number('client:' + key)
            age = 25 + n % 46
            c = {'id': self.uid('client:' + key), 'agent_id': agent['id'], 'agency_id': agent['agency_id'],
                 'name': self.name('client:' + key), 'email': 'cliente.' + self.uid('client:' + key).split('-')[0] + '@reto.example',
                 'phone': self.phone('client:' + key), 'state': self.state(state), 'stage': stage if stage in STAGES else 'new',
                 'profile': {'synthetic': True, 'age': age, 'date_of_birth': f'{2026-age}-04-15',
                             'language': 'es' if n % 3 else 'en', 'tobacco': bool(n % 4 == 0),
                             'coverage_requested': (10 + n % 30) * 5000,
                             'monthly_budget': 50 + n % 150}}
            self.clients[key] = c
            self.seed['clients'].append(c)
        if name:
            self.names[(str(owner), str(name).strip().lower())] = self.clients[key]
        return self.clients[key]

    def record(self, table, key, payload):
        self.seed['source_records'].append({'source_table': table, 'id': self.uid(table + ':' + str(key)), 'payload': payload})


def load_private(path):
    tables, documents = collections.defaultdict(list), []
    selected = re.compile(r'^(?:leads-store/(?:leads\.json|default-owner\.json|books/[^/]+\.json|applications/[^/]+\.json)|captures-live/(?:calendar\.json|calendars/[^/]+\.json)|quotes/[^/]+\.json|illustrations/[^/]+\.json)$')
    counts = collections.Counter()
    with gzip.open(path, 'rt') as stream:
        for line in stream:
            item = json.loads(line)
            table, row = item['table'], item['row']
            counts[table] += 1
            if table != 'public.pbg_state_documents':
                tables[table].append(row)
            elif selected.fullmatch(row['path']):
                try:
                    doc = json.loads(row.get('document') or row['content'])
                except (ValueError, TypeError):
                    continue
                if isinstance(doc, dict):
                    documents.append((row['path'], doc))
    return tables, documents, counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-input', required=True)
    parser.add_argument('--mapping-key', required=True)
    parser.add_argument('--backup-metadata', required=True)
    parser.add_argument('--output', default='data/seed.json.gz')
    args = parser.parse_args()
    key_path = Path(args.mapping_key)
    if key_path.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        raise RuntimeError('The private ID mapping key must stay outside the repository')
    if not key_path.exists():
        import os
        key_path.write_bytes(os.urandom(32))
        key_path.chmod(0o600)
    b = Builder(key_path.read_bytes())
    tables, docs, source_counts = load_private(args.private_input)
    agencies = {}
    for i, row in enumerate(tables['onboarding.agencies'], 1):
        a = {'id': b.uid('agency:' + row['id']), 'name': 'Agencia Horizonte ' + str(i).zfill(2)}
        agencies[row['id']] = a
        b.seed['agencies'].append(a)
    profiles = {x['account_id']: x for x in tables['onboarding.profiles']}
    for row in sorted(tables['onboarding.accounts'], key=lambda r: r['id']):
        a = b.agent(row['id'])
        p = profiles.get(row['id'], {})
        a['agency_id'] = agencies.get(row.get('agency_id'), {}).get('id')
        a['role'] = row.get('role') if row.get('role') in {'agent', 'admin', 'owner', 'setter'} else 'agent'
        a['profile'] = {'synthetic': True, 'resident_state': b.state(p.get('address_state')), 'npn': 'TEST-NPN-' + a['username'][6:]}
        b.record('onboarding.accounts', row['id'], {k: v for k, v in a.items() if k != 'profile'})
        b.record('onboarding.profiles', row['id'], {'account_id': a['id'], **a['profile']})
    for original, agency in agencies.items():
        b.record('onboarding.agencies', original, agency)
    for i, row in enumerate(tables['onboarding.licenses'], 1):
        a = b.agent(row['account_id'])
        state = b.state(row['state'])
        license = {'id': b.uid('license:' + row['id']), 'agent_id': a['id'], 'state': state,
                   'license_number': f'TEST-{state}-{i:06}', 'details': {'synthetic': True, 'expiry_date': '2028-11-30'}}
        b.seed['licenses'].append(license)
        b.record('onboarding.licenses', row['id'], license)
    default_owner = ''
    for path, doc in docs:
        if path == 'leads-store/default-owner.json':
            default_owner = str(doc.get('ownerKey') or doc.get('owner') or doc.get('key') or '')
        if path == 'leads-store/leads.json' and doc.get('ownerKey'):
            default_owner = str(doc['ownerKey'])
    default_owner = default_owner or next(iter(b.agents))
    books = [(p, d) for p, d in docs if p == 'leads-store/leads.json' or re.fullmatch(r'leads-store/books/[^/]+\.json', p)]
    for path, book in books:
        path_owner = Path(path).stem if '/books/' in path else default_owner
        owner = str(book.get('ownerKey') or path_owner)
        for i, lead in enumerate(book.get('leads') or []):
            if not isinstance(lead, dict):
                continue
            lead_owner = str(lead.get('ownerKey') or owner)
            c = b.client(lead.get('id') or f'{path}:{i}', lead_owner, lead.get('name', ''), lead.get('st') or lead.get('state'), lead.get('stage', 'new'))
            b.record('leads', lead.get('id') or f'{path}:{i}', c)
            for j, _note in enumerate(lead.get('notes') or []):
                b.seed['notes'].append({'id': b.uid(f'note:{path}:{i}:{j}'), 'agent_id': c['agent_id'], 'client_id': c['id'], 'details': {'synthetic': True, 'text': 'El cliente solicita revisar sus opciones de cobertura en el próximo seguimiento.'}})
    for path, doc in docs:
        if path.startswith('leads-store/applications/'):
            owner = str(doc.get('ownerKey') or default_owner)
            original_id = doc.get('leadId') or Path(path).stem
            c = b.clients.get(str(original_id))
            if c is None:
                c = b.client(original_id, owner)
            latest = doc.get('latest') or {}
            b.record('applications', path, {'client_id': c['id'], 'agent_id': c['agent_id'], 'synthetic': True,
                                          'fields': c['profile'], 'has_history': bool(doc.get('history')), 'captured_fields_count': len(latest.get('fields') or {})})
    quote_seen = set()
    for path, doc in docs:
        if not (path.startswith('quotes/') or path.startswith('illustrations/')):
            continue
        qid = str(doc.get('id') or Path(path).stem)
        if qid in quote_seen:
            continue
        quote_seen.add(qid)
        owner = str(doc.get('agent_id') or doc.get('ownerKey') or default_owner)
        agent = b.agent(owner)
        client_id = doc.get('lead_id') or doc.get('leadId')
        client = b.clients.get(str(client_id)) if client_id else b.names.get((owner, str(doc.get('client') or '').strip().lower()))
        if client and client['agent_id'] != agent['id']:
            client = None
        carrier_text = str(doc.get('carrier') or '').lower()
        carrier = next((name for token, name in [('national', 'National Life'), ('mutual', 'Mutual of Omaha'), ('americo', 'Americo'), ('f&g', 'F&G'), ('fg', 'F&G')] if token in carrier_text), 'Aseguradora de demostración')
        product_text = str(doc.get('product') or '').lower()
        product = next((name for token, name in [('iul', 'IUL'), ('whole', 'Whole Life'), ('term', 'Term Life'), ('final', 'Final Expense')] if token in product_text), 'Producto de demostración')
        n = b.number('quote:' + qid)
        monthly = 40 + n % 180
        q = {'id': b.uid('quote:' + qid), 'agent_id': agent['id'], 'client_id': client['id'] if client else None,
             'carrier': carrier, 'product': product, 'details': {'synthetic': True, 'simulated': True,
             'face_amount': (10 + n % 30) * 5000, 'monthly_premium': monthly, 'annual_premium': monthly * 12,
             'created_at': '2026-10-01T12:00:00Z', 'currency': 'USD', 'source_kind': path.split('/')[0]}}
        b.seed['quotes'].append(q)
        b.record('quotes', qid, q)
    for path, doc in docs:
        if not (path == 'captures-live/calendar.json' or path.startswith('captures-live/calendars/')):
            continue
        owner = Path(path).stem if '/calendars/' in path else default_owner
        agent = b.agent(owner)
        for kind in ['meetings', 'events', 'tasks']:
            for i, appointment in enumerate(doc.get(kind) or []):
                if not isinstance(appointment, dict):
                    continue
                client = b.clients.get(str(appointment.get('leadId') or ''))
                if client and client['agent_id'] != agent['id']:
                    client = None
                a = {'id': b.uid(f'appointment:{owner}:{kind}:{appointment.get("id") or i}'), 'agent_id': agent['id'], 'client_id': client['id'] if client else None,
                     'details': {'synthetic': True, 'kind': kind, 'title': 'Seguimiento de demostración', 'start': f'2026-11-{2+i%25:02}T15:00:00Z',
                                 'timezone': 'America/New_York', 'duration_minutes': 30, 'done': bool(appointment.get('done'))}}
                b.seed['appointments'].append(a)
                b.record('calendar', a['id'], a)
    # Duplicate source records can occur in legacy books. Last value wins by synthetic key.
    b.seed['source_records'] = list({(r['source_table'], r['id']): r for r in b.seed['source_records']}.values())
    b.seed['appointments'] = list({r['id']: r for r in b.seed['appointments']}.values())
    provenance = json.loads(Path(args.backup_metadata).read_text())
    b.seed['metadata'] = {'format_version': 1, 'sanitized': True, 'source': 'AWS PostgreSQL backup',
                          'source_backup_at': provenance['timestamp'], 'source_backup_sha256': provenance['sha256'],
                          'generated_at': datetime.now(timezone.utc).isoformat(), 'source_table_counts': dict(source_counts),
                          'counts': {k: len(v) for k, v in b.seed.items()},
                          'password_policy': 'All local demo accounts use 123456, stored with scrypt at import',
                          'excluded': ['production credentials and password hashes', 'sessions and tokens', 'billing and bank details',
                                       'SSN and tax identifiers', 'original names and contact details', 'free text and transcripts',
                                       'private media and document URLs', 'historical state backups'],
                          'note': 'Business relationships derive from the backup. Identity, medical, financial and free-text values are fictional.'}
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(b.seed, ensure_ascii=False, separators=(',', ':')).encode()
    out.write_bytes(gzip.compress(payload, mtime=0))
    out.with_name('manifest.json').write_text(json.dumps({**b.seed['metadata'], 'seed_sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'compressed_bytes': out.stat().st_size}, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(b.seed['metadata']['counts']))


if __name__ == '__main__':
    main()
