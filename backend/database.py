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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
