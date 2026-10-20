"""Extract allowlisted source tables to a PRIVATE intermediate stream."""
import argparse
import collections
import gzip
import json
import os
from pathlib import Path
from read_backup import rows_from_backup


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--pg-restore', default='pg_restore')
    args = parser.parse_args()
    dest = Path(args.output).resolve()
    if dest.is_relative_to(Path(__file__).resolve().parents[1]):
        raise RuntimeError('Private source rows must stay outside the repository')
    counts = collections.Counter()
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb') as compressed:
            for table, row in rows_from_backup(args.backup, args.pg_restore):
                compressed.write((json.dumps({'table': table, 'row': row}) + '\n').encode())
                counts[table] += 1
    print(json.dumps({'extracted_tables': dict(counts)}))


if __name__ == '__main__':
    main()
