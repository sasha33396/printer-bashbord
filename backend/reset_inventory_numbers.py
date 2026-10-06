"""Clear current inventory numbers except verified physical labels (SQLite).

Default: read-only preview. Stop API/collectors before --apply. Historical
assignment/event snapshots, assets, OCS links and workplaces are retained.
"""

import argparse
import json
import sqlite3
import tarfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from inventory_numbers import require_inventory_number
from photo_storage import PHOTO_ROOT, equipment_photo_key, inventory_folder_name


def write_report(path, report):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def records(db):
    result = []
    for table, kind, title, category in (
        ("devices", "device", "manufacturer || ' ' || model", "'Печатная техника'"),
        ("warehouse_items", "warehouse_item", "name", "category"),
    ):
        for row in db.execute(f"SELECT id, inventory_number, {title} AS name, {category} AS category, serial_number FROM {table}"):
            result.append({**dict(row), "table": table, "entity_type": kind})
    return result


def album(root, key):
    path = root / inventory_folder_name(key)
    if path.is_symlink() or path.resolve().parent != root:
        raise ValueError("Photo album is a symlink or outside the photo root")
    return path


def build_plan(db, keep, root):
    if not isinstance(keep, list) or not keep:
        raise ValueError("The keep list must be a non-empty array")
    wanted = [require_inventory_number(row["inventory_number"]) for row in keep]
    if len(set(wanted)) != len(wanted):
        raise ValueError("Duplicate number in the keep list")
    all_records = records(db)
    existing = Counter(row["inventory_number"].strip().casefold() for row in all_records if row["inventory_number"])
    if any(count > 1 for count in existing.values()):
        raise ValueError("Duplicate current inventory numbers; resolve before cleanup")
    retained = []
    for expected, number in zip(keep, wanted):
        candidates = [row for row in all_records if row["inventory_number"] == number]
        if len(candidates) != 1:
            raise ValueError(f"Keep {number}: expected exactly one current card")
        row = candidates[0]
        if row["entity_type"] != "warehouse_item" or row["category"] != expected["category"]:
            raise ValueError(f"Keep {number}: category does not match {row['name']}")
        if expected.get("serial_number"):
            if (row["serial_number"] or "").strip().casefold() != expected["serial_number"].strip().casefold():
                raise ValueError(f"Keep {number}: serial differs for {row['name']}; expected {expected['serial_number']}, got {row['serial_number']}")
        elif row["name"].strip().casefold() != expected["name"].strip().casefold():
            raise ValueError(f"Keep {number}: computer name differs; expected {expected['name']}, got {row['name']}")
        retained.append(row)
    changes = []
    for row in all_records:
        if not row["inventory_number"] or row["inventory_number"] in wanted:
            continue
        source = album(root, row["inventory_number"])
        target = album(root, equipment_photo_key(row["entity_type"], row["id"], None))
        if target.exists():
            raise ValueError(f"Destination album already exists for {row['entity_type']} ID {row['id']}; review before cleanup")
        if source.exists() and not source.is_dir():
            raise ValueError(f"Source album is not a directory: {source}")
        changes.append({**row, "photo_source": source.name, "photo_target": target.name,
                        "has_photos": source.exists()})
    return {"retained": retained, "changes": changes,
            "totals": {"retained": len(retained), "cleared": len(changes),
                       "photo_albums_moved": sum(row["has_photos"] for row in changes)}}


def run(database, root, keep, output, apply=False):
    database, root, output = database.resolve(), root.resolve(), output.resolve()
    if not database.is_file():
        raise ValueError("Database file not found")
    if output.is_relative_to(root):
        raise ValueError("Reports/backups directory must be outside the photo root")
    output.mkdir(parents=True, exist_ok=False)
    report_path = output / "report.json"
    report = {"mode": "apply" if apply else "dry-run", "status": "checking",
              "database": str(database), "photo_root": str(root)}
    db = sqlite3.connect(database.as_uri() + ("?mode=rw" if apply else "?mode=ro"), uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    moved = []
    committed = False
    try:
        report.update(build_plan(db, keep, root))
        report["status"] = "preview"
        write_report(report_path, report)
        if not apply:
            return report
        if any(row["name"] == "inventory_number" and row["notnull"] for row in db.execute("PRAGMA table_info(devices)")):
            raise ValueError("Deploy the manual-numbering backend before applying cleanup")
        backup_path = output / "before.db"
        with sqlite3.connect(backup_path) as backup:
            db.backup(backup)
            if backup.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise ValueError("Backup integrity check failed")
        with tarfile.open(output / "photos-before.tar.gz", "w:gz") as archive:
            if root.exists():
                archive.add(root, arcname="equipment_photos")
        report["status"] = "backed_up"
        write_report(report_path, report)
        db.execute("BEGIN IMMEDIATE")
        # Revalidate under the database write lock before any file/DB mutations.
        locked_plan = build_plan(db, keep, root)
        if locked_plan["changes"] != report["changes"] or locked_plan["retained"] != report["retained"]:
            raise ValueError("Database or photos changed since preview; stop API/collectors and retry")
        timestamp = datetime.now(timezone.utc).isoformat()
        report["status"] = "applying"
        write_report(report_path, report)
        for row in report["changes"]:
            if row["has_photos"]:
                source, target = root / row["photo_source"], root / row["photo_target"]
                source.rename(target)
                moved.append((source, target))
            changed = db.execute(
                f"UPDATE {row['table']} SET inventory_number=NULL WHERE id=? AND inventory_number=?",
                (row["id"], row["inventory_number"]),
            ).rowcount
            if changed != 1:
                raise ValueError("Card changed during cleanup")
            db.execute(
                "INSERT INTO equipment_events (occurred_at,effective_date,category,event_type,entity_type,entity_id,"
                "inventory_number,entity_name,title,actor,from_value,changes_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (timestamp, timestamp[:10], "equipment" if row["entity_type"] == "warehouse_item" else "device",
                 "updated", row["entity_type"], row["id"], None, row["name"],
                 "Инвентарный номер очищен для ручной маркировки", "inventory-cleanup", row["inventory_number"],
                 json.dumps({"Инвентарный номер": {"before": row["inventory_number"], "after": None}}, ensure_ascii=False)),
            )
        if db.execute("PRAGMA foreign_key_check").fetchall() or db.execute("PRAGMA quick_check").fetchall()[0][0] != "ok":
            raise ValueError("Database integrity check failed; cleanup rolled back")
        db.commit()
        committed = True
        report["status"] = "applied"
        write_report(report_path, report)
        return report
    except BaseException as exc:
        if not committed:
            db.rollback()
            for source, target in reversed(moved):
                target.rename(source)
        report.update(status="applied_report_error" if committed else "failed", error=str(exc))
        write_report(report_path, report)
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("/app/data/printer_dashboard.db"))
    parser.add_argument("--photos-root", type=Path, default=PHOTO_ROOT)
    parser.add_argument("--keep", type=Path, default=Path(__file__).with_name("inventory_numbers_keep.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("/app/data/inventory-reset"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    folder = args.output_dir / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid4().hex[:8])
    try:
        keep = json.loads(args.keep.read_text(encoding="utf-8-sig"))
        report = run(args.database, args.photos_root, keep, folder, args.apply)
        print(json.dumps({"mode": report["mode"], "status": report["status"], **report["totals"]}, ensure_ascii=False))
        for row in report["retained"]:
            print(f"KEEP {row['inventory_number']} | {row['name']} | {row['serial_number'] or '—'}")
        print(f"Report/backups: {folder}")
        return 0
    except (ValueError, OSError, sqlite3.Error, KeyboardInterrupt) as exc:
        print(f"ERROR: {exc}\nReport/backups: {folder}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
