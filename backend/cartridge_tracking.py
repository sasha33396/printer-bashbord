"""Cartridge dates and measured resources; never infer missing counter values."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException


def today():
    return datetime.now(timezone(timedelta(hours=4))).date()


def model_key(value):
    return " ".join(value.split()).casefold()


def device_key(manufacturer, model):
    # Length-prefix the first key to avoid ambiguous manufacturer/model splits.
    first, second = model_key(manufacturer), model_key(model)
    return f"{len(first)}:{first}{second}"


def tracking(record, current_date=None):
    current_date = current_date or today()
    events = sorted(record.operations, key=lambda event: (event.date, event.id))
    states = [event for event in events if event.to_state == record.state and event.from_state != event.to_state]
    locations = [event for event in events if event.from_location != event.to_location]
    transfers = [event for event in events if event.operation == "transfer"]
    removals = [event for event in events if event.operation == "remove"]
    measured = [event.pages_printed for event in removals if event.pages_printed is not None]
    state_since = states[-1].date if states else None
    location_since = locations[-1].date if locations else None
    overdue = (record.state == "refilling" and record.expected_return_date is not None
               and current_date > record.expected_return_date)
    return {
        "state_since": state_since,
        "state_days": max(0, (current_date - state_since).days) if state_since else None,
        "location_since": location_since,
        "location_days": max(0, (current_date - location_since).days) if location_since else None,
        "last_transferred_at": transfers[-1].date if transfers else None,
        "expected_return_date": record.expected_return_date,
        "refill_overdue": overdue,
        "overdue_days": (current_date - record.expected_return_date).days if overdue else 0,
        "installation_page_counter": record.installation_page_counter,
        "last_cycle_pages": removals[-1].pages_printed if removals else None,
        "measured_cycles": len(measured),
        "total_pages": sum(measured) if measured else None,
    }


def cycle_pages(record, counter):
    initial = record.installation_page_counter
    if counter is not None and initial is not None:
        if counter < initial:
            raise HTTPException(422, "Счётчик при снятии меньше показания при установке")
        return counter - initial
    return None
