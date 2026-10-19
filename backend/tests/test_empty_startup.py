"""A normal installation starts empty and preserves user records on restart."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class EmptyStartupTests(unittest.TestCase):
    def test_production_startup_does_not_seed_demo_data(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            env={**os.environ,'DATABASE_URL':'sqlite:///'+(folder/'test.db').as_posix(),
                 'PHOTO_DIRECTORY':str(folder/'photos'),'REPAIR_INVOICE_DIRECTORY':str(folder/'invoices'),
                 'ADMIN_LOGIN':'installation-admin','ADMIN_PASSWORD':'test-only-password','SECRET_KEY':'test-only-key'}
            backend=Path(__file__).resolve().parents[1]
            scripts=(
                "import main; from database import Base,SessionLocal; from sqlalchemy import text; "
                "from models import Branch; db=SessionLocal(); "
                "assert all(db.execute(text('SELECT COUNT(*) FROM '+t.name)).scalar()==0 for t in Base.metadata.sorted_tables); "
                "db.add(Branch(name='User branch')); db.commit(); db.close()",
                "import main; from database import SessionLocal; from models import Branch,Employee,Device,WarehouseItem,MapFloor; "
                "db=SessionLocal(); assert [r.name for r in db.query(Branch)]==['User branch']; "
                "assert all(db.query(model).count()==0 for model in (Employee,Device,WarehouseItem,MapFloor)); db.close()",
            )
            for script in scripts:
                result=subprocess.run([sys.executable,'-c',"import sys; sys.path.insert(0, '.'); "+script],cwd=backend,env=env,capture_output=True,text=True,timeout=30)
                self.assertEqual(result.returncode,0,result.stderr)
