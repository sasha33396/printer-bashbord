import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

from database import Base
from equipment_history import changed_values, event_changes, initialize_equipment_history
from models import (
    Branch, Employee, EquipmentEvent, WarehouseItem, Workplace,
    WorkplaceAssetAssignment, WorkplaceStatus,
)
from routers.workplaces import delete_workplace, end_assignment, transfer_asset
from schemas import WorkplaceAssignmentEnd, WorkplaceTransfer


class EquipmentHistoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_changed_values_serializes_dates_and_ignores_unchanged_fields(self):
        result = changed_values(
            {"name": "ПК", "date": date(2026, 1, 1)},
            {"name": "ПК", "date": date(2026, 2, 1)},
            {"date": "Дата"},
        )

        self.assertEqual(result, {
            "Дата": {"before": "2026-01-01", "after": "2026-02-01"},
        })

    def test_migration_preserves_assignment_context_and_is_idempotent(self):
        branch = Branch(name="ОП Краснодар")
        employee = Employee(full_name="Иванов И. И.", branch=branch)
        item = WarehouseItem(
            name="WS-OPM-8", category="Компьютеры", branch=branch,
            tracking_type="asset", inventory_number="1-00037",
            placement="Рабочее место", condition="Рабочий", unit="шт.", min_quantity=1,
        )
        workplace = Workplace(
            name="РМ-8", branch=branch, employee=employee,
            status=WorkplaceStatus.occupied,
        )
        assignment = WorkplaceAssetAssignment(
            workplace=workplace, item=item, assigned_at=date(2026, 9, 1),
        )
        self.session.add_all([branch, employee, item, workplace, assignment])
        self.session.commit()

        initialize_equipment_history(self.session)

        self.session.refresh(assignment)
        self.assertEqual(assignment.workplace_name, "РМ-8")
        self.assertEqual(assignment.employee_name, "Иванов И. И.")
        self.assertEqual(assignment.branch_name, "ОП Краснодар")
        self.assertEqual(assignment.inventory_number, "1-00037")
        self.assertEqual(assignment.item_name, "WS-OPM-8")
        events = self.session.query(EquipmentEvent).order_by(EquipmentEvent.id).all()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[1].event_type, "assigned_to_workplace")
        self.assertEqual(events[1].employee_name, "Иванов И. И.")

        initialize_equipment_history(self.session)
        self.assertEqual(self.session.query(EquipmentEvent).count(), 2)

    def test_invalid_change_payload_is_returned_as_empty_mapping(self):
        event = EquipmentEvent(
            category="equipment", event_type="updated", entity_type="warehouse_item",
            entity_id=1, entity_name="ПК", title="Изменено", changes_json="not-json",
        )

        self.assertEqual(event_changes(event), {})

    def test_transfer_closes_previous_assignment_and_captures_new_employee(self):
        branch = Branch(name="ЗМИ")
        first_employee = Employee(full_name="Первый сотрудник", branch=branch)
        second_employee = Employee(full_name="Второй сотрудник", branch=branch)
        item = WarehouseItem(
            name="Системный блок", category="Компьютеры", branch=branch,
            tracking_type="asset", inventory_number="1-00038",
            placement="Рабочее место", condition="Рабочий", unit="шт.", min_quantity=1,
        )
        first_place = Workplace(
            name="РМ-1", branch=branch, employee=first_employee,
            status=WorkplaceStatus.occupied,
        )
        second_place = Workplace(
            name="РМ-2", branch=branch, employee=second_employee,
            status=WorkplaceStatus.occupied,
        )
        old_assignment = WorkplaceAssetAssignment(
            workplace=first_place, item=item, assigned_at=date(2026, 9, 1),
            employee=first_employee, employee_name=first_employee.full_name,
            workplace_name=first_place.name, branch_name=branch.name,
        )
        self.session.add_all([
            branch, first_employee, second_employee, item,
            first_place, second_place, old_assignment,
        ])
        self.session.commit()

        result = transfer_asset(
            item.id,
            WorkplaceTransfer(
                workplace_id=second_place.id,
                transfer_date=date(2026, 10, 1),
                notes="Передача сотруднику",
            ),
            self.session,
            {"username": "admin"},
        )

        self.session.refresh(old_assignment)
        self.assertEqual(old_assignment.ended_at, date(2026, 10, 1))
        self.assertEqual(result.employee_name, "Второй сотрудник")
        self.assertEqual(result.workplace_name, "РМ-2")
        self.assertEqual(result.inventory_number, "1-00038")
        event = self.session.query(EquipmentEvent).one()
        self.assertEqual(event.event_type, "transferred")
        self.assertEqual(event.from_value, "РМ-1")
        self.assertEqual(event.to_value, "РМ-2")
        self.assertEqual(event.employee_name, "Второй сотрудник")
        self.assertEqual(event.actor, "admin")

    def test_empty_workplace_with_assignment_history_is_archived(self):
        branch = Branch(name="Тестовый филиал")
        item = WarehouseItem(
            name="Монитор", category="Мониторы", branch=branch,
            tracking_type="asset", inventory_number="1-00039",
            placement="Склад/серверная", condition="На складе", unit="шт.", min_quantity=1,
        )
        workplace = Workplace(name="РМ-архив", branch=branch, status=WorkplaceStatus.vacant)
        assignment = WorkplaceAssetAssignment(
            workplace=workplace, item=item, assigned_at=date(2026, 8, 1),
            ended_at=date(2026, 9, 1), workplace_name=workplace.name,
            inventory_number=item.inventory_number, item_name=item.name,
            item_category=item.category,
        )
        self.session.add_all([branch, item, workplace, assignment])
        self.session.commit()

        delete_workplace(workplace.id, self.session, {"username": "admin"})

        self.session.refresh(workplace)
        self.assertTrue(workplace.is_archived)
        self.assertIsNotNone(workplace.archived_at)
        self.assertEqual(
            self.session.query(WorkplaceAssetAssignment).filter_by(workplace_id=workplace.id).count(),
            1,
        )

    def test_workplace_with_active_equipment_cannot_be_archived(self):
        branch = Branch(name="Филиал с активным местом")
        item = WarehouseItem(
            name="Телефон", category="Телефоны", branch=branch,
            tracking_type="asset", inventory_number="1-00040",
            placement="Рабочее место", condition="Рабочий", unit="шт.", min_quantity=1,
        )
        workplace = Workplace(name="РМ-активное", branch=branch, status=WorkplaceStatus.vacant)
        assignment = WorkplaceAssetAssignment(
            workplace=workplace, item=item, assigned_at=date(2026, 10, 1),
        )
        self.session.add_all([branch, item, workplace, assignment])
        self.session.commit()

        with self.assertRaises(HTTPException) as raised:
            delete_workplace(workplace.id, self.session, {"username": "admin"})

        self.assertEqual(raised.exception.status_code, 409)
        self.assertFalse(workplace.is_archived)

    def test_detaching_equipment_writes_global_history_event(self):
        branch = Branch(name="Филиал снятия")
        employee = Employee(full_name="Ответственный сотрудник", branch=branch)
        item = WarehouseItem(
            name="Рабочий компьютер", category="Компьютеры", branch=branch,
            tracking_type="asset", inventory_number="1-00041",
            placement="Рабочее место", condition="Рабочий", unit="шт.", min_quantity=1,
        )
        workplace = Workplace(
            name="РМ-снятие", branch=branch, employee=employee,
            status=WorkplaceStatus.occupied,
        )
        assignment = WorkplaceAssetAssignment(
            workplace=workplace, item=item, assigned_at=date(2026, 9, 1),
            employee=employee, employee_name=employee.full_name,
            workplace_name=workplace.name, branch_name=branch.name,
            inventory_number=item.inventory_number, item_name=item.name,
            item_category=item.category,
        )
        self.session.add_all([branch, employee, item, workplace, assignment])
        self.session.commit()

        end_assignment(
            assignment.id,
            WorkplaceAssignmentEnd(ended_at=date(2026, 10, 1)),
            self.session,
            {"username": "admin"},
        )

        event = self.session.query(EquipmentEvent).one()
        self.assertEqual(event.event_type, "returned_to_stock")
        self.assertEqual(event.reference_type, "workplace_assignment")
        self.assertEqual(event.reference_id, assignment.id)
        self.assertEqual(event.employee_name, "Ответственный сотрудник")
        self.assertEqual(event.from_value, "РМ-снятие")
        self.assertEqual(event.to_value, "Склад/серверная")
        self.assertEqual(event_changes(event)["Рабочее место"]["after"], "Склад/серверная")

    def test_startup_restores_missing_detach_event(self):
        branch = Branch(name="Филиал восстановления")
        item = WarehouseItem(
            name="Архивный компьютер", category="Компьютеры", branch=branch,
            tracking_type="asset", inventory_number="1-00042",
            placement="Склад/серверная", condition="На складе", unit="шт.", min_quantity=1,
        )
        workplace = Workplace(name="Старое РМ", branch=branch, status=WorkplaceStatus.vacant)
        assignment = WorkplaceAssetAssignment(
            workplace=workplace, item=item, assigned_at=date(2026, 7, 1),
            ended_at=date(2026, 8, 1), workplace_name=workplace.name,
            branch_name=branch.name, inventory_number=item.inventory_number,
            item_name=item.name, item_category=item.category,
        )
        marker = EquipmentEvent(
            category="equipment", event_type="existing_record",
            entity_type="warehouse_item", entity_id=999,
            entity_name="Маркер", title="Журнал уже создан",
        )
        self.session.add_all([branch, item, workplace, assignment, marker])
        self.session.commit()

        initialize_equipment_history(self.session)

        restored = self.session.query(EquipmentEvent).filter_by(
            entity_id=item.id,
            event_type="returned_to_stock",
        ).one()
        self.assertEqual(restored.effective_date, date(2026, 8, 1))
        self.assertEqual(restored.reference_id, assignment.id)


if __name__ == "__main__":
    unittest.main()
