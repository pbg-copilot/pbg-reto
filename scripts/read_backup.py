"""Stream COPY records out of a private PostgreSQL custom backup without restoring it.

Never print returned rows: they contain source data and may contain credentials.
"""
import re
import subprocess


def unescape_copy(value):
    if value == r'\N':
        return None
    escapes = {'t': '\t', 'n': '\n', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v', '\\': '\\'}
    return re.sub(r'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)',
                  lambda m: chr(int(m[1][1:], 16)) if m[1].startswith('x') else
                  chr(int(m[1], 8)) if m[1][0] in '01234567' else escapes.get(m[1], m[1]), value)


def rows_from_backup(path, pg_restore='pg_restore'):
    tables = ['accounts', 'profiles', 'agencies', 'licenses', 'license_confirmations',
              'producer_seeds', 'producers', 'producer_licenses', 'pbg_state_documents']
    args = [pg_restore, '--data-only', '--no-owner', '--no-privileges', '--file=-']
    args += ['--table=' + name for name in tables]
    args.append(str(path))
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    table, columns = None, []
    try:
        for line in process.stdout:
            if line.startswith('COPY '):
                match = re.match(r'COPY (\S+) \((.*?)\) FROM stdin;', line)
                if match:
                    table = match[1].replace('"', '')
                    columns = [x.strip().strip('"') for x in match[2].split(',')]
                continue
            if line.rstrip('\n') == r'\.':
                table = None
                continue
            if table:
                parts = line.rstrip('\n').split('\t')
                if len(parts) != len(columns):
                    raise ValueError('Invalid COPY column count in ' + table)
                yield table, dict(zip(columns, map(unescape_copy, parts)))
        if process.wait() != 0:
            raise RuntimeError('pg_restore failed; private error output withheld')
    finally:
        if process.poll() is None:
            process.terminate()
        process.stdout.close()
        process.stderr.close()
