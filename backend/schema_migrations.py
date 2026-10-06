"""Transactional SQLite schema migrations for existing installations."""

import re


def allow_empty_device_inventory(engine):
    if engine.dialect.name != "sqlite":
        raise RuntimeError("Manual inventory numbering requires a SQLite database")
    raw = engine.raw_connection()
    cursor = raw.cursor()
    foreign_keys = cursor.execute("PRAGMA foreign_keys").fetchone()[0]
    try:
        columns = cursor.execute("PRAGMA table_info(devices)").fetchall()
        if not any(row[1] == "inventory_number" and row[3] for row in columns):
            return
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("BEGIN IMMEDIATE")
        sql = cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'").fetchone()[0]
        sql, count = re.subn(
            r'((?:"inventory_number"|inventory_number)\s+(?:VARCHAR\(\d+\)|TEXT))\s+NOT\s+NULL',
            r'\1', sql, count=1, flags=re.IGNORECASE,
        )
        if count != 1:
            raise RuntimeError("Cannot migrate devices.inventory_number: unexpected table definition")
        sql = re.sub(r'^CREATE TABLE\s+(?:"devices"|devices)',
                     'CREATE TABLE "devices_manual_inventory"', sql, count=1, flags=re.IGNORECASE)
        extras = cursor.execute(
            "SELECT sql FROM sqlite_master WHERE tbl_name='devices' AND type IN ('index','trigger') AND sql IS NOT NULL",
        ).fetchall()
        names = ",".join('"' + row[1].replace('"', '""') + '"' for row in columns)
        cursor.execute(sql)
        cursor.execute(f'INSERT INTO devices_manual_inventory ({names}) SELECT {names} FROM devices')
        cursor.execute("DROP TABLE devices")
        cursor.execute("ALTER TABLE devices_manual_inventory RENAME TO devices")
        for (statement,) in extras:
            cursor.execute(statement)
        if cursor.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Foreign key check failed during device migration")
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        cursor.execute(f"PRAGMA foreign_keys={int(foreign_keys)}")
        cursor.close()
        raw.close()
