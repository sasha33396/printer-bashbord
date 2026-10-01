import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./printer_dashboard.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def initialize_database():
    Base.metadata.create_all(bind=engine)
    # create_all does not add columns to existing installations.
    with engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("devices")}
        for name, sql_type in (
            ("ip_address", "VARCHAR(45)"),
            ("page_counter", "INTEGER"),
            ("counter_checked_at", "VARCHAR(40)"),
        ):
            if name not in columns:
                connection.execute(text(f"ALTER TABLE devices ADD COLUMN {name} {sql_type}"))

        repair_columns = {
            column["name"] for column in inspect(connection).get_columns("repair_records")
        }
        for name, sql_type in (
            ("repair_status", "VARCHAR(20) NOT NULL DEFAULT 'completed'"),
            ("completion_page_counter", "INTEGER"),
            ("page_counter_delta", "INTEGER"),
            ("task_date", "DATE"),
            ("task_url", "VARCHAR(1000)"),
            ("source_location", "VARCHAR(500)"),
            ("responsible_person", "VARCHAR(255)"),
            ("returned_date", "DATE"),
            ("connected_date", "DATE"),
            ("invoice_name", "VARCHAR(500)"),
        ):
            if name not in repair_columns:
                connection.execute(text(f"ALTER TABLE repair_records ADD COLUMN {name} {sql_type}"))

        warehouse_columns = {
            column["name"] for column in inspect(connection).get_columns("warehouse_items")
        }
        for name, sql_type in (
            ("article", "VARCHAR(100)"),
            ("branch_id", "INTEGER"),
            ("department_id", "INTEGER"),
            ("tracking_type", "VARCHAR(20) NOT NULL DEFAULT 'quantity'"),
            ("inventory_number", "VARCHAR(100)"),
            ("serial_number", "VARCHAR(100)"),
            ("manufacturer", "VARCHAR(255)"),
            ("model", "VARCHAR(255)"),
            ("ip_address", "VARCHAR(45)"),
            ("mac_address", "VARCHAR(17)"),
            ("placement", "VARCHAR(100) NOT NULL DEFAULT 'Склад/серверная'"),
            ("condition", "VARCHAR(50) NOT NULL DEFAULT 'На складе'"),
            ("compatible_printers", "TEXT"),
            ("monitor_diagonal", "FLOAT"),
            ("color", "VARCHAR(50)"),
            ("ram_gb", "INTEGER"),
            ("processor", "VARCHAR(255)"),
            ("graphics", "VARCHAR(255)"),
            ("storage_type", "VARCHAR(50)"),
            ("storage_capacity_gb", "INTEGER"),
            ("is_archived", "BOOLEAN NOT NULL DEFAULT 0"),
            ("archived_at", "DATETIME"),
        ):
            if name not in warehouse_columns:
                connection.execute(text(f"ALTER TABLE warehouse_items ADD COLUMN {name} {sql_type}"))
        if "sku" in warehouse_columns:
            connection.execute(text(
                "UPDATE warehouse_items SET article = sku "
                "WHERE article IS NULL AND sku IS NOT NULL"
            ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_article ON warehouse_items (article)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_branch_id ON warehouse_items (branch_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_department_id ON warehouse_items (department_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_inventory_number "
            "ON warehouse_items (inventory_number)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_serial_number "
            "ON warehouse_items (serial_number)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_ip_address "
            "ON warehouse_items (ip_address)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_mac_address "
            "ON warehouse_items (mac_address)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_warehouse_items_is_archived "
            "ON warehouse_items (is_archived)"
        ))

        workplace_columns = {
            column["name"] for column in inspect(connection).get_columns("workplaces")
        }
        for name, sql_type in (
            ("photo_item_id", "INTEGER"),
            ("photo_hash", "VARCHAR(64)"),
        ):
            if name not in workplace_columns:
                connection.execute(text(f"ALTER TABLE workplaces ADD COLUMN {name} {sql_type}"))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_workplaces_photo_item_id "
            "ON workplaces (photo_item_id)"
        ))

        assignment_columns = {
            column["name"] for column in inspect(connection).get_columns("workplace_asset_assignments")
        }
        for name, sql_type in (
            ("employee_id", "INTEGER"),
            ("employee_name", "VARCHAR(255)"),
            ("inventory_number", "VARCHAR(100)"),
            ("item_name", "VARCHAR(255)"),
            ("item_category", "VARCHAR(100)"),
            ("workplace_name", "VARCHAR(255)"),
            ("branch_name", "VARCHAR(255)"),
            ("department_name", "VARCHAR(255)"),
        ):
            if name not in assignment_columns:
                connection.execute(text(
                    f"ALTER TABLE workplace_asset_assignments ADD COLUMN {name} {sql_type}"
                ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_workplace_asset_assignments_employee_id "
            "ON workplace_asset_assignments (employee_id)"
        ))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
