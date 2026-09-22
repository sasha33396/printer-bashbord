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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
