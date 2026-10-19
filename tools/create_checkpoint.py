"""Save local source and demo data without stopping the development server."""
import argparse
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {'.git', '.cache', '.snapshots', '.venv', 'venv', 'env', 'node_modules',
             'dist', 'build', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
             '.vscode', '.idea', '.aws', '.codex', 'equipment_photos', 'repair_invoices', 'data'}


def create_checkpoint(label='checkpoint'):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', label):
        raise ValueError('Use letters, digits, underscore or hyphen for the checkpoint label')
    now = datetime.now(timezone(timedelta(hours=4)))
    output = ROOT / '.snapshots' / f'{now:%Y%m%d-%H%M%S-%f}-{label}'
    output.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(output / 'source.zip', 'x', zipfile.ZIP_DEFLATED) as archive:
        for directory, directories, files in os.walk(ROOT):
            parent = Path(directory)
            directories[:] = [name for name in directories if name not in SKIP_DIRS
                               and not (parent.relative_to(ROOT).as_posix() == 'tools/ocs_ad' and name == 'output')]
            for name in files:
                path = parent / name
                relative = path.relative_to(ROOT).as_posix()
                if path.is_symlink() or (name.startswith('.env') and name != '.env.example'):
                    continue
                if relative in {'tools/ocs_ad/config.json', 'backend/inventory_numbers_keep.json'} or path.suffix in {'.pyc', '.pyo', '.log', '.tmp', '.bak', '.pem', '.key', '.p12', '.pfx'}:
                    continue
                if re.search(r'\.(db|sqlite|sqlite3)(-(journal|wal|shm))?$', name):
                    continue
                archive.write(path, relative)
    source = ROOT / '.cache/demo/printer_dashboard.db'
    data_saved = source.is_file()
    if data_saved:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            with closing(sqlite3.connect(output / 'demo-runtime.db')) as backup:
                db.backup(backup)
                if backup.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('Database backup integrity check failed')
    # Demo uploads live outside the source tree and are backed up separately.
    with zipfile.ZipFile(output / 'demo-files.zip', 'x', zipfile.ZIP_DEFLATED) as archive:
        for name in ('photos', 'repair_invoices'):
            storage = ROOT / '.cache/demo' / name
            if storage.is_dir():
                for path in storage.rglob('*'):
                    if path.is_file() and not path.is_symlink():
                        archive.write(path, path.relative_to(ROOT / '.cache/demo').as_posix())
    revision = None
    git = ROOT / '.cache/runtime/git/cmd/git.exe'
    if git.is_file() and (ROOT / '.git').exists():
        result = subprocess.run([str(git), 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True)
        if result.returncode == 0:
            revision = result.stdout.strip()
    manifest = {'created_at': now.isoformat(), 'label': label, 'git_commit': revision,
                'source_archive': 'source.zip', 'demo_database': 'demo-runtime.db' if data_saved else None,
                'demo_uploads': 'demo-files.zip',
                'notes': 'Local code and demo data only. Secrets, dependencies and external server data are excluded.'}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Create a local source and demo-data checkpoint')
    parser.add_argument('label', nargs='?', default='checkpoint')
    print(create_checkpoint(parser.parse_args().label))
