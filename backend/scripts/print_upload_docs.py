#!/usr/bin/env python3
"""
Print sample documents from UploadMaster and UploadConsent collections.

Usage (PowerShell):
  cd backend
  python .\scripts\print_upload_docs.py

Requirements:
  pip install pymongo python-dotenv

This script loads `backend/.env` to read MONGODB_URI and connects to the DB.
"""
from pathlib import Path
import os
import sys

try:
    from pymongo import MongoClient
except Exception as e:
    print('Missing dependency: pymongo. Install with: pip install pymongo')
    raise

try:
    from dotenv import load_dotenv
except Exception:
    print('Missing dependency: python-dotenv. Install with: pip install python-dotenv')
    raise

from bson.json_util import dumps


def main():
    repo_root = Path(__file__).resolve().parents[1]
    env_path = repo_root / '.env'

    if not env_path.exists():
        print(f'Env file not found at {env_path}. Please ensure backend/.env exists.')
        sys.exit(1)

    load_dotenv(env_path)

    uri = os.environ.get('MONGODB_URI')
    if not uri:
        print('MONGODB_URI not set in backend/.env')
        sys.exit(1)

    print('Connecting to MongoDB...')
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Force a server selection to fail fast if URI is wrong
        client.admin.command('ping')
    except Exception as e:
        print('Failed to connect to MongoDB:', str(e))
        sys.exit(1)

    # Try to get default DB from URI, otherwise parse it
    db = None
    try:
        db = client.get_default_database()
    except Exception:
        db = None

    if db is None:
        # Try to parse database from URI path
        try:
            # mongodb+srv://user:pass@host/dbname?params
            path = uri.split('/')[-1]
            dbname = path.split('?')[0]
            if not dbname:
                raise ValueError('No database name in URI')
            db = client[dbname]
        except Exception as e:
            print('Could not determine database from URI. Please include the database name in MONGODB_URI.')
            print('Error:', e)
            sys.exit(1)

    print('Connected to database:', db.name)

    upload_master_coll = db.get_collection('uploadmasters')
    upload_consent_coll = db.get_collection('uploadconsents')

    print('\n--- UploadMaster documents (up to 50) ---')
    masters = list(upload_master_coll.find({}).limit(50))
    if not masters:
        print('(no UploadMaster documents found)')
    else:
        print(dumps(masters, indent=2))

    print('\n--- UploadConsent documents (up to 50) ---')
    consents = list(upload_consent_coll.find({}).limit(50))
    if not consents:
        print('(no UploadConsent documents found)')
    else:
        print(dumps(consents, indent=2))

    client.close()
    print('\nDone.')


if __name__ == '__main__':
    main()
