"""Download an existing encrypted S3 backup. Never changes the AWS database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import boto3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private-dir', required=True)
    parser.add_argument('--profile', default='pbg-sdk')
    args = parser.parse_args()
    out = Path(args.private_dir).expanduser().resolve()
    if out.is_relative_to(Path(__file__).resolve().parents[1]):
        raise RuntimeError('Raw backups must stay outside the repository')
    out.mkdir(parents=True, mode=0o700, exist_ok=True)
    out.chmod(0o700)
    session = boto3.Session(profile_name=args.profile, region_name='us-east-2')
    if session.client('sts').get_caller_identity()['Account'] != '755400270949':
        raise RuntimeError('Refusing an AWS account other than PBG')
    client = session.client('s3')
    bucket = 'pbg-dev-files-vax9dmpbfqrz'
    prefix = 'backups/postgres/pbg_candidate_20261016/'
    objects = [o for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix)
               for o in page.get('Contents', []) if o['Key'].endswith('.dump')]
    newest = max(objects, key=lambda o: o['LastModified'])
    metadata = client.head_object(Bucket=bucket, Key=newest['Key'])
    expected = metadata.get('Metadata', {}).get('sha256')
    if not expected:
        raise RuntimeError('Backup is missing its SHA256 integrity metadata')
    if metadata.get('ServerSideEncryption') not in {'AES256', 'aws:kms'}:
        raise RuntimeError('Expected an encrypted backup')
    dest = out / 'source.dump'
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        client.download_fileobj(bucket, newest['Key'], stream)
    with dest.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != expected:
        raise RuntimeError('Backup checksum mismatch')
    result = {'key': newest['Key'], 'sha256': digest, 'bytes': newest['Size'],
              'timestamp': newest['LastModified'].isoformat(), 'database': 'pbg_candidate_20261016'}
    (out / 'backup-metadata.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'downloaded': True, 'bytes': newest['Size'], 'checksum_verified': True}))


if __name__ == '__main__':
    main()
