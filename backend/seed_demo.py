"""Build a standalone demo SQLite database, without touching DATABASE_URL.

Run from the repository root: python backend/seed_demo.py
Existing files are never overwritten. Only explicitly marked demo files can be
reused with --if-missing (used by the isolated Docker demo environment).
"""
import argparse
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import shutil
from uuid import uuid4


SEED_VERSION = "1"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / ".cache" / "demo" / "printer_dashboard.db"


def demo_info(path: Path) -> dict:
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        return dict(connection.execute("SELECT key, value FROM _demo_metadata"))


def populate(db, as_of: date) -> dict:
    from models import (
        Branch, Cartridge, CartridgeCompatibility, CartridgeOperation, ConsumableLog, Department, Device,
        DeviceStatus, DeviceType, ElectronicSignature, Employee, EquipmentEvent,
        ItemType, MachineReadablePowerOfAttorney, Manufacturer, MapBuilding,
        MapFloor, MapMarker, RepairRecord, RepairStatus, RepairType, RepairWorkItem,
        StockMovement, StockMovementType, WarehouseItem, Workplace,
        WorkplaceAssetAssignment, WorkplaceStatus,
    )
    from equipment_history import initialize_equipment_history, add_item_event
    from map_schemas import FloorSave
    from cartridge_tracking import device_key, model_key

    def ago(days):
        return as_of - timedelta(days=days)

    def stamp(days=0):
        return datetime.combine(ago(days), time(10), timezone.utc)

    def save(obj):
        db.add(obj)
        db.flush()
        return obj

    def movement(item, kind, quantity=1, days=90):
        db.add(StockMovement(item_id=item.id, date=ago(days),
                             movement_type=kind, quantity=quantity,
                             notes="Демонстрационная операция"))

    branches = [save(Branch(name=name, address=address)) for name, address in (
        ("ДЕМО — Центральный офис", "Тестовый город, ул. Примерная, 1"),
        ("ДЕМО — Производственный участок", "Тестовый город, ул. Учебная, 2"),
    )]
    departments = [save(Department(name=name, branch_id=branches[i // 3].id))
                   for i, name in enumerate(("ИТ-отдел", "Бухгалтерия", "Отдел кадров",
                                              "Диспетчерская", "Производство", "Склад"))]
    for name in ("Kyocera", "HP", "Canon", "Epson", "Lenovo", "Dell", "Samsung"):
        db.add(Manufacturer(name=name))

    names = (
        "Иванов Иван Иванович", "Петрова Анна Сергеевна", "Сидоров Алексей Петрович",
        "Кузнецова Мария Андреевна", "Смирнов Дмитрий Олегович", "Волкова Елена Игоревна",
        "Попов Павел Викторович", "Соколова Ольга Николаевна", "Морозов Артём Денисович",
        "Новикова Ирина Михайловна", "Фёдоров Максим Ильич", "Орлова Татьяна Романовна",
    )
    employees, workplaces, assignments = [], [], []
    for i, name in enumerate(names):
        department = departments[i // 2]
        employee = save(Employee(
            full_name=name, position="Тестовый специалист", branch_id=department.branch_id,
            department_id=department.id, email=f"employee{i + 1:02}@example.test",
            phone=f"10{i + 1:02}", ad_login=f"demo.user{i + 1:02}", ad_domain="demo.test",
            is_active=i < 10, notes="Вымышленный сотрудник для тестирования",
        ))
        employees.append(employee)
        workplace = save(Workplace(
            name=f"ДЕМО-РМ-{i + 1:03}", branch_id=department.branch_id,
            department_id=department.id, location=f"Кабинет {101 + i}",
            employee_id=employee.id if i < 10 else None,
            status=WorkplaceStatus.occupied if i < 10 else WorkplaceStatus.vacant,
            notes="Демонстрационное рабочее место",
        ))
        workplaces.append(workplace)
    for archived in (False, True):
        workplaces.append(save(Workplace(
            name="ДЕМО-РМ-АРХИВ" if archived else "ДЕМО-РМ-НЕАКТИВНОЕ",
            branch_id=branches[0].id, department_id=departments[0].id,
            location="Резервный кабинет", status=WorkplaceStatus.inactive,
            is_archived=archived, archived_at=stamp(5) if archived else None,
        )))

    device_models = (
        ("Kyocera", "ECOSYS M2040dn", DeviceType.mfc),
        ("HP", "LaserJet Pro M404dn", DeviceType.printer),
        ("Canon", "imageFORMULA DR-C225", DeviceType.scanner),
        ("Epson", "SureColor T3100", DeviceType.plotter),
    )
    devices = []
    for i in range(12):
        manufacturer, model, kind = device_models[i % 4]
        device = save(Device(
            inventory_number=f"1-{i + 1:05}" if i != 7 else None,
            serial_number=f"DEMO-PRINT-{i + 1:03}", manufacturer=manufacturer,
            model=model, device_type=kind, department_id=departments[i // 2].id,
            location=f"Кабинет {101 + i}", ip_address=f"192.0.2.{10 + i}",
            mac_address=f"02:00:00:01:00:{i + 1:02X}",
            purchase_date=ago(500), warranty_until=ago(135) if i % 2 else ago(-230),
            page_counter=42000 + i * 3000, counter_checked_at=stamp().isoformat(),
            status=DeviceStatus.active if i < 8 else DeviceStatus.repair if i < 10
            else DeviceStatus.decommissioned,
            notes="ДЕМО. IP из тестового диапазона; реальный принтер отсутствует.",
        ))
        devices.append(device)

    assets = []
    for i in range(10):
        workplace = workplaces[i]
        for offset, category in enumerate(("Компьютеры", "Мониторы")):
            number = 101 + 2 * i + offset
            item = save(WarehouseItem(
                name="Lenovo ThinkCentre M70s" if offset == 0 else "Dell P2422H",
                sku=f"DEMO-{category}-{i + 1:02}", category=category,
                tracking_type="asset", inventory_number=f"1-{number:05}",
                serial_number=f"DEMO-ASSET-{number}",
                manufacturer="Lenovo" if offset == 0 else "Dell",
                model="ThinkCentre M70s" if offset == 0 else "P2422H",
                branch_id=workplace.branch_id, department_id=workplace.department_id,
                placement="Рабочее место", condition="Рабочий",
                ip_address=f"198.51.100.{i + 10}" if offset == 0 else None,
                mac_address=f"02:00:00:02:00:{i + 1:02X}" if offset == 0 else None,
                processor="Intel Core i5-12400" if offset == 0 else None,
                ram_gb=16 if offset == 0 else None, graphics="Intel UHD 730" if offset == 0 else None,
                storage_type="SSD" if offset == 0 else None,
                storage_capacity_gb=512 if offset == 0 else None,
                os_name="Windows" if offset == 0 else None, os_version="11 Pro" if offset == 0 else None,
                monitor_diagonal=23.8 if offset else None, color="Чёрный", unit="шт.",
            ))
            assets.append(item)
            movement(item, StockMovementType.receipt)
            movement(item, StockMovementType.issue, days=60)
            assignments.append(save(WorkplaceAssetAssignment(
                workplace_id=workplace.id, item_id=item.id, assigned_at=ago(60),
                employee_id=workplace.employee_id, notes="Первичное назначение (демо)",
            )))

    spares = []
    for i, category in enumerate(("Компьютеры", "Мониторы", "Телефоны", "Коммутаторы", "Мониторы")):
        item = save(WarehouseItem(
            name=f"ДЕМО — резерв: {category}", sku=f"DEMO-SPARE-{i + 1}",
            category=category, tracking_type="asset", branch_id=branches[0].id,
            department_id=departments[0].id, inventory_number=f"1-{201 + i:05}" if i != 2 else None,
            serial_number=f"DEMO-SPARE-{i + 1}", condition="Списано" if i == 4 else "На складе",
            is_archived=i == 4, archived_at=stamp(5) if i == 4 else None,
        ))
        spares.append(item)
        movement(item, StockMovementType.receipt)
        if i == 4:
            movement(item, StockMovementType.issue, days=5)
    # A closed assignment exercises the equipment return history.
    save(WorkplaceAssetAssignment(workplace_id=workplaces[0].id, item_id=spares[1].id,
                                 assigned_at=ago(80), ended_at=ago(65),
                                 employee_id=employees[0].id, employee_name=employees[0].full_name,
                                 notes="Возврат старого монитора на склад (демо)"))
    movement(spares[1], StockMovementType.issue, days=80)
    movement(spares[1], StockMovementType.receipt, days=65)

    for branch in branches:
        for i, (category, name, received, issued, minimum) in enumerate((
            ("Мыши", "Logitech B100", 20, 6, 5),
            ("Клавиатуры", "Logitech K120", 10, 8, 5),
            ("Картриджи", "Kyocera TK-1170 — количественный запас", 6, 6, 2),
            ("Расходники", "Бумага A4, пачка 500 листов", 50, 15, 10),
        )):
            item = save(WarehouseItem(
                name=name, sku=f"DEMO-QTY-{i + 1}", category=category,
                branch_id=branch.id, tracking_type="quantity", min_quantity=minimum,
                unit="пач." if category == "Расходники" else "шт.",
            ))
            movement(item, StockMovementType.receipt, received)
            movement(item, StockMovementType.issue, issued, days=10)

    repairs = []
    # Two completed repairs on one printer give a nonempty counter delta.
    for device_index, age, status in ((0, 120, RepairStatus.completed),
                                      (0, 30, RepairStatus.completed),
                                      (1, 45, RepairStatus.completed),
                                      (8, 5, RepairStatus.in_progress),
                                      (9, 3, RepairStatus.in_progress),
                                      (10, 20, RepairStatus.impossible)):
        completed = status == RepairStatus.completed
        record = save(RepairRecord(
            device_id=devices[device_index].id, date=ago(age), task_date=ago(age + 1),
            task_url=f"https://helpdesk.example.test/tickets/DEMO-{len(repairs) + 1}",
            repair_type=RepairType.planned if age == 120 else RepairType.unplanned,
            repair_status=status, source_location=devices[device_index].location,
            responsible_person=employees[0].full_name, description="Замятие бумаги, профилактика и замена роликов",
            contractor="ДЕМО — Учебный сервис", cost=3500.0,
            page_counter=10000 if age == 120 else 25000,
            completion_page_counter=(10100 if age == 120 else 25100) if completed else None,
            returned_date=ago(age - 2) if completed else None,
            connected_date=ago(age - 1) if completed else None,
            page_counter_delta=15000 if device_index == 0 and age == 30 else None,
            notes="Тестовый ремонт, счётчик введён вручную",
        ))
        db.add_all([RepairWorkItem(repair_id=record.id, description="Диагностика и профилактика", cost=1000),
                    RepairWorkItem(repair_id=record.id, description="Замена роликов", cost=2500)])
        repairs.append(record)
    for i, device in enumerate(devices[:6]):
        db.add(ConsumableLog(device_id=device.id, date=ago(15 + i), item_type=ItemType.toner_black,
                             quantity=1, unit_cost=1800, page_counter=35000 + i * 1000,
                             notes="Исторический расход для аналитики (демо)"))

    for i, offset in enumerate((180, 15, -15, 365, 90)):
        archived = i == 4
        common = dict(valid_from=ago(180) if i != 3 else ago(-30),
                      valid_to=ago(-offset), is_archived=archived,
                      archived_at=stamp(5) if archived else None,
                      created_at=stamp(100), updated_at=stamp())
        db.add(ElectronicSignature(
            company_name="ООО «ДЕМО — Тестовая организация»", inn="0000000000",
            full_name=employees[i].full_name, position=employees[i].position,
            snils=f"000-000-00{i} 00", email=employees[i].email,
            certificate_type="Тестовый сертификат", signature_kind="КЭП",
            ep_state="Отозвана" if archived else "Выдана", revoked_at=stamp(5) if archived else None,
            fingerprint=f"DEMO-CERTIFICATE-{i + 1:04}", serial_number=f"DEMO-EP-{i + 1}",
            application="Вымышленная запись для проверки реестра", **common,
        ))
        db.add(MachineReadablePowerOfAttorney(
            power_number=f"DEMO-МЧД-{i + 1:04}", grantor_name="ООО «ДЕМО — Тестовая организация»",
            grantor_inn="0000000000", representative_full_name=employees[i].full_name,
            permissions="Подписание тестовых документов", edo_status="Отменена" if archived else "Действует",
            fns_identifier=f"DEMO-FNS-{i + 1}", edo_identifier=f"DEMO-EDO-{i + 1}", **common,
        ))

    floors = []
    for branch_index, branch in enumerate(branches):
        building = save(MapBuilding(name="ДЕМО — Административный корпус" if branch_index == 0
                                    else "ДЕМО — Производственный корпус",
                                    branch_id=branch.id, address=branch.address))
        for level in range(2 if branch_index == 0 else 1):
            shapes = [
                {"id": "room-it", "kind": "room", "x": 1, "y": 1, "width": 17, "height": 9,
                 "label": "Кабинеты 101–106" if branch_index == 0 else "Диспетчерская", "color": "#e6f4ff"},
                {"id": "room-office", "kind": "room", "x": 20, "y": 1, "width": 18, "height": 9,
                 "label": "Офис / резервные места", "color": "#f6ffed"},
                {"id": "room-stock", "kind": "room", "x": 1, "y": 14, "width": 12, "height": 9,
                 "label": "Склад и серверная", "color": "#fff7e6"},
                {"id": "wall", "kind": "wall", "x": 1, "y": 12, "x2": 38, "y2": 12},
                {"id": "door", "kind": "door", "x": 17, "y": 12, "x2": 19, "y2": 12},
                {"id": "label", "kind": "text", "x": 21, "y": 18, "label": "ДЕМО — учебная схема"},
            ]
            # Validate the same geometry contract used by the plan editor.
            FloorSave(name=f"{level + 1} этаж", width=40, height=25, revision=1, shapes=shapes)
            floors.append(save(MapFloor(building_id=building.id, name=f"{level + 1} этаж",
                                        width=40, height=25, shapes_json=json.dumps(shapes, ensure_ascii=False),
                                        updated_by="demo-seed", updated_at=stamp())))
    for i, workplace in enumerate(workplaces[:12]):
        floor = floors[0 if i < 3 else 1 if i < 6 else 2]
        db.add(MapMarker(floor_id=floor.id, entity_type="workplace", entity_id=workplace.id,
                         entity_name=workplace.name, x=3 + (i % 3) * 5, y=4))
    for i, device in enumerate(devices[:10]):
        db.add(MapMarker(floor_id=floors[0 if i < 3 else 1 if i < 6 else 2].id,
                         entity_type="device", entity_id=device.id,
                         entity_name=f"{device.manufacturer} {device.model}", x=22 + (i % 3) * 5, y=5))
    db.add(MapMarker(floor_id=floors[0].id, entity_type="warehouse_item", entity_id=spares[3].id,
                     entity_name=spares[3].name, x=6, y=18))
    # A documented topology for trying port pairs, cable bends and floor transitions.
    from map_schemas import NetworkPlan
    from models import MapNetworkState
    def network_node(node_id, kind, name, x, y, count=2, **extra):
        return dict(id=node_id, kind=kind, name=name, x=x, y=y, group='ДЕМО / VLAN 10',
                    ports=[dict(id=f'p{index+1}', name=str(index+1)) for index in range(count)], **extra)
    def cable(link_id, source, source_port, target, target_port, **extra):
        return dict(id=link_id, source_node=source, source_port=source_port,
                    target_node=target, target_port=target_port, cable_number=link_id.upper(),
                    group='ДЕМО / VLAN 10', **extra)
    panel = network_node('demo-panel', 'patch_panel', 'ДЕМО — патч-панель', 12, 17, 4)
    for a, b in ((0, 1), (2, 3)):
        panel['ports'][a]['paired_port_id'] = panel['ports'][b]['id']
        panel['ports'][b]['paired_port_id'] = panel['ports'][a]['id']
    first_network = NetworkPlan(nodes=[
        network_node('demo-pc', 'computer', 'ДЕМО — компьютер', 4, 5, 1, entity_type='warehouse_item',entity_id=assets[0].id),
        panel, network_node('demo-switch', 'switch', 'ДЕМО — коммутатор 1', 8, 20, 8),
        network_node('demo-printer', 'printer', 'ДЕМО — сетевой принтер', 22, 5, 1, entity_type='device',entity_id=devices[0].id),
        network_node('demo-ap', 'access_point', 'ДЕМО — Wi-Fi', 28, 8),
    ], links=[
        cable('demo-c01','demo-pc','p1','demo-panel','p1',route=[dict(x=4,y=11),dict(x=12,y=11)]),
        cable('demo-c02','demo-panel','p2','demo-switch','p1'),
        cable('demo-c03','demo-printer','p1','demo-switch','p2',route=[dict(x=22,y=13),dict(x=8,y=13)]),
        cable('demo-c04','demo-switch','p3','demo-router','p1',remote_point=dict(x=14,y=22)),
        cable('demo-c05','demo-ap','p1','demo-switch','p4'),
    ])
    floors[0].network_json = first_network.model_dump_json()
    floors[1].network_json = NetworkPlan(nodes=[network_node('demo-router','router','ДЕМО — маршрутизатор',8,20,4,ip_address='192.0.2.1')]).model_dump_json()
    db.add(MapNetworkState(id=1,revision=1))
    db.flush()
    initialize_equipment_history(db)

    # Each labelled cartridge has a receipt and its own lifecycle history.
    cartridge_states = ("ready", "ready", "installed", "installed", "empty", "refilling", "defective", "written_off")
    db.add(CartridgeCompatibility(cartridge_model="Kyocera TK-1170 (демо)",
                                 cartridge_key=model_key("Kyocera TK-1170 (демо)"),
                                 manufacturer="Kyocera", model="ECOSYS M2040dn",
                                 device_key=device_key("Kyocera", "ECOSYS M2040dn")))
    labels = {"ready": "Запасной", "installed": "Установлен", "empty": "Пустой",
              "refilling": "На заправке", "defective": "Неисправен", "written_off": "Списан"}
    chains = {"ready": (), "installed": ("install",), "empty": ("install", "remove"),
              "refilling": ("install", "remove", "send_refill"),
              "defective": ("defective",), "written_off": ("defective", "write_off")}
    transitions = {"received": "ready", "install": "installed", "remove": "empty",
                   "send_refill": "refilling", "defective": "defective", "write_off": "written_off"}
    for i, state in enumerate(cartridge_states):
        installed_device = devices[0 if i == 2 else 4] if state == "installed" else None
        department = departments[0 if i != 3 else 2]
        item = save(WarehouseItem(
            name="Kyocera TK-1170 (демо)", category="Картриджи", tracking_type="asset",
            inventory_number=f"1-{301 + i:05}", sku=f"DEMO-CART-{i + 1}",
            branch_id=department.branch_id, department_id=department.id,
            condition=labels[state], compatible_printers="Kyocera ECOSYS M2040dn",
            is_archived=state == "written_off", archived_at=stamp(7) if state == "written_off" else None,
            placement="На заправке" if state == "refilling" else "Склад/серверная",
        ))
        movement(item, StockMovementType.receipt, days=50)
        if state == "written_off":
            movement(item, StockMovementType.issue, days=7)
        chain = ("received", *chains[state])
        cartridge = save(Cartridge(
            item_id=item.id, state=state, holder_type="contractor" if state == "refilling"
            else "department" if installed_device else "warehouse",
            device_id=installed_device.id if installed_device else None,
            slot="black" if installed_device else None,
            contractor="ДЕМО — Учебная заправка" if state == "refilling" else None,
            last_operation_date=ago(11 - len(chain)),
            last_installed_at=ago(9) if state in ("installed", "empty", "refilling") else None,
            last_removed_at=ago(8) if state in ("empty", "refilling") else None,
            last_refill_sent_at=ago(7) if state == "refilling" else None,
            expected_return_date=ago(2) if state == "refilling" else None,
            installation_page_counter=32000 + i * 100 if state == "installed" else None,
        ))
        previous = None
        for step, operation in enumerate(chain):
            next_state = transitions[operation]
            db.add(CartridgeOperation(
                batch_id=f"00000000-0000-4000-8000-{i * 10 + step:012}", item_id=item.id,
                date=ago(10 - step), created_at=stamp(10 - step), operation=operation,
                from_state=previous, to_state=next_state, from_location="ДЕМО — предыдущий держатель" if previous else None,
                to_location="ДЕМО — " + labels[next_state], actor="demo-seed", notes="Учебная операция",
                page_counter=32000 + i * 100 if operation == "install" else 34000 + i * 100 if operation == "remove" else None,
                pages_printed=2000 if operation == "remove" else None,
                expected_return_date=ago(2) if operation == "send_refill" else None,
            ))
            add_item_event(db, item, category="cartridge", event_type=f"cartridge_{operation}",
                           title="Демонстрационная операция: " + operation,
                           actor="demo-seed", effective_date=ago(10 - step))
            previous = next_state
    db.flush()
    for event in db.query(EquipmentEvent):
        event.occurred_at = datetime.combine(event.effective_date or ago(90), time(10), timezone.utc)
        if event.actor == "migration":
            event.actor = "demo-seed"
    db.commit()
    return {model.__tablename__: db.query(model).count() for model in (
        Branch, Department, Employee, Workplace, Device, WarehouseItem,
        WorkplaceAssetAssignment, StockMovement, Cartridge, CartridgeOperation, CartridgeCompatibility,
        RepairRecord, ConsumableLog, ElectronicSignature, MachineReadablePowerOfAttorney,
        MapBuilding, MapFloor, MapMarker, EquipmentEvent,
    )}


def build_demo(output: Path, as_of: date | None = None, if_missing: bool = False) -> dict:
    output = Path(output).resolve()
    if output.exists():
        if not if_missing:
            raise FileExistsError(f"Файл уже существует и не будет перезаписан: {output}")
        try:
            metadata = demo_info(output)
        except sqlite3.Error as exc:
            raise ValueError("Существующий файл не является демобазой; запуск отменён") from exc
        if metadata.get("seed_version") != SEED_VERSION:
            raise ValueError("Версия демобазы не совпадает; используйте новый файл/том")
        return {"path": str(output), "reused": True, **metadata}

    # The target is always explicit: never use the deployment's DATABASE_URL.
    from sqlalchemy import create_engine, event, text
    from sqlalchemy.engine import URL
    from sqlalchemy.orm import Session
    from database import Base
    import models  # noqa: F401 — register all tables before create_all

    as_of = as_of or date.today()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="demo-seed-", dir=output.parent) as temporary:
        temporary_db = Path(temporary) / "demo.db"
        engine = create_engine(URL.create("sqlite", database=str(temporary_db)))

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        try:
            Base.metadata.create_all(engine)
            with Session(engine) as db:
                counts = populate(db, as_of)
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE _demo_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"))
                for key, value in {"seed_version": SEED_VERSION, "as_of": as_of.isoformat(),
                                   "counts": json.dumps(counts, ensure_ascii=False)}.items():
                    connection.execute(text("INSERT INTO _demo_metadata VALUES (:key, :value)"),
                                       {"key": key, "value": value})
                if connection.exec_driver_sql("PRAGMA integrity_check").scalar() != "ok":
                    raise ValueError("Проверка целостности демобазы не пройдена")
                if connection.exec_driver_sql("PRAGMA foreign_key_check").all():
                    raise ValueError("Нарушены связи демобазы")
        finally:
            engine.dispose()
        # TemporaryDirectory is private on Windows. Copy to a sibling created
        # with the destination directory's inherited permissions before linking;
        # otherwise the published database remains unreadable to the normal user.
        publication = output.parent / f".demo-publish-{uuid4().hex}.db"
        try:
            with temporary_db.open("rb") as source, publication.open("xb") as destination:
                shutil.copyfileobj(source, destination)
                destination.flush()
                os.fsync(destination.fileno())
            # Atomic, exclusive publication on the same filesystem.
            os.link(publication, output)
        finally:
            publication.unlink(missing_ok=True)
    return {"path": str(output), "as_of": as_of.isoformat(), "counts": counts, "reused": False}


def main():
    parser = argparse.ArgumentParser(description="Создать отдельную демонстрационную SQLite-базу")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--as-of", type=date.fromisoformat, help="Дата сценариев YYYY-MM-DD (по умолчанию сегодня)")
    parser.add_argument("--if-missing", action="store_true", help="Повторно использовать существующую помеченную демобазу")
    args = parser.parse_args()
    try:
        result = build_demo(args.output, args.as_of, args.if_missing)
    except (FileExistsError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
