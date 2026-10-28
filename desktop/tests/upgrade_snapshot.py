"""Read-only runtime inventory plus an online SQLite backup for installer testing."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

root = Path(__file__).resolve().parents[2]
output = root/'desktop/upgrade-validation'
output.mkdir(exist_ok=True)
label = sys.argv[1]
if label not in ('before', 'after'): raise SystemExit('Use before or after')
def digest(path):
    with path.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

data = root/'studio/data'
files = {str(p.relative_to(data)): digest(p) for p in data.rglob('*') if p.is_file()
         and p.name not in ('workspace.sqlite3', 'workspace.sqlite3-wal', 'workspace.sqlite3-shm', 'workspace.lock')}
models = {}
for folder in [root/'ComfyUI/models', root/'studio/models']:
    for p in folder.rglob('*'):
        if p.is_file():
            s = p.stat()
            models[str(p.relative_to(root))] = {'size':s.st_size, 'modified_ns':s.st_mtime_ns, 'file_id':s.st_ino}
database = data/'workspace.sqlite3'
with closing(sqlite3.connect(database.as_uri()+'?mode=ro', uri=True)) as source:
    with closing(sqlite3.connect(output/(label+'.sqlite3'))) as backup:
        source.backup(backup)
        logical = hashlib.sha256('\n'.join(backup.iterdump()).encode()).hexdigest()
        counts = {row[0]:backup.execute('SELECT COUNT(*) FROM "'+row[0].replace('"','""')+'"').fetchone()[0]
                  for row in backup.execute("SELECT name FROM sqlite_master WHERE type='table'")}
config = Path(os.environ['APPDATA'])/'StudioAI/runtime.json'
policies = {p.name:digest(p) for p in Path('C:/Windows/System32/CodeIntegrity/CiPolicies/Active').glob('*.cip')}
snapshot = {'workspace_files':files, 'model_inventory':models, 'database_logical_sha256':logical,
            'table_counts':counts, 'runtime_config_sha256':digest(config), 'windows_policies':policies}
(output/(label+'.json')).write_text(json.dumps(snapshot, indent=2))
print(f'{label}: {len(files)} workspace file hashes, {len(models)} model file records, {len(policies)} Windows policies, tables: {counts}')
if label == 'after':
    previous = json.loads((output/'before.json').read_text())
    checks = {key:previous[key]==snapshot[key] for key in snapshot}
    (output/'preservation-results.json').write_text(json.dumps(checks, indent=2))
    print(json.dumps(checks))
    assert all(checks.values()), 'Preservation difference; inspect snapshots before proceeding'
