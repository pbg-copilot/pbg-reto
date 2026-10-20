"""Record order-independent fingerprints of unchanged source business fields."""
import argparse
import hashlib
import json
from pathlib import Path
from read_backup import rows_from_backup

FIELDS = {
    'onboarding.accounts': ['role','status','plan_tier','billing_mode','subscription_status','current_period_end','seat_monthly_cents','manual_bill_cents','created_at','updated_at','seat_role','plan_term'],
    'onboarding.agencies': ['name','billing_mode','status','seat_limit','timezone','created_at','updated_at'],
    'onboarding.profiles': ['first_name','middle_name','last_name','npn','date_of_birth','address_line1','address_line2','address_city','address_state','address_zip','eo_policy_number'],
    'onboarding.licenses': ['state','license_number','expiry_date'],
    'analytics.quotes': ['carrier','product','face_amount_cents','monthly_premium_cents','annual_premium_cents','created_at','day_et'],
    'analytics.calls': ['direction','started_at','talk_seconds','answered','hangup_cause','day_et'],
    'onboarding.money_events': ['family','kind','occurred_at','amount_cents','currency','tier','term','created_at'],
    'onboarding.usage_events': ['kind','quantity','unit','occurred_at','source','created_at','voided_at'],
    'analytics.day_rollup': ['day_et','scope','attempts','clients_reached','answered','conversations','talk_seconds_total','quotes','callbacks','callbacks_forwarded','disclosure_qualifying','disclosure_matched'],
}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--backup',required=True)
    parser.add_argument('--pg-restore',default='pg_restore')
    args=parser.parse_args()
    hashes={t:[] for t in FIELDS}
    tables=[t.split('.')[1] for t in FIELDS]
    for table,row in rows_from_backup(args.backup,args.pg_restore,tables=tables):
        if table not in FIELDS:
            continue
        value=json.dumps([row.get(c) for c in FIELDS[table]],ensure_ascii=False,separators=(',',':'))
        hashes[table].append(hashlib.sha256(value.encode()).hexdigest())
    result={t:{'fields':FIELDS[t],'rows':len(values),'sha256':hashlib.sha256(''.join(sorted(values)).encode()).hexdigest()} for t,values in hashes.items()}
    Path('data/fidelity.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'source_business_fingerprints':len(result)}))


if __name__=='__main__':main()
