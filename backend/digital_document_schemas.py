import re
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, field_validator, model_validator


def optional_text(value):
    if isinstance(value, str):
        return value.strip() or None
    return value


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]
CompanyText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Fingerprint = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
RequiredCompany = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class DocumentFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid_from: date | None = None
    valid_to: date | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_text(cls, data):
        return {name: optional_text(value) for name, value in data.items()} if isinstance(data, dict) else data

    @model_validator(mode="after")
    def validate_period(self):
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("Дата окончания не может быть раньше даты начала")
        return self


class SignatureUpdate(DocumentFields):
    company_name: CompanyText | None = None
    inn: Identifier | None = None
    certificate_type: ShortText | None = None
    signature_kind: ShortText | None = None
    full_name: ShortText | None = None
    position: ShortText | None = None
    snils: Identifier | None = None
    email: ShortText | None = None
    application: LongText | None = None
    ep_state: ShortText | None = None
    revoked_at: AwareDatetime | None = None
    fingerprint: Fingerprint | None = None
    serial_number: ShortText | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value):
        if value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Укажите корректный Email")
        return value

    @field_validator("revoked_at")
    @classmethod
    def utc_revocation(cls, value):
        return value.astimezone(timezone.utc) if value else None


class SignatureCreate(SignatureUpdate):
    company_name: RequiredCompany
    full_name: RequiredText
    valid_from: date
    valid_to: date


class PowerOfAttorneyUpdate(DocumentFields):
    power_number: ShortText | None = None
    grantor_inn: Identifier | None = None
    grantor_name: CompanyText | None = None
    grantor_person_full_name: ShortText | None = None
    grantor_person_inn: Identifier | None = None
    grantor_person_snils: Identifier | None = None
    representative_full_name: ShortText | None = None
    representative_inn: Identifier | None = None
    representative_snils: Identifier | None = None
    permissions: LongText | None = None
    fns_identifier: ShortText | None = None
    edo_identifier: ShortText | None = None
    edo_status: ShortText | None = None


class PowerOfAttorneyCreate(PowerOfAttorneyUpdate):
    power_number: RequiredText
    grantor_name: RequiredCompany
    representative_full_name: RequiredText
    valid_from: date
    valid_to: date


class DocumentMetadata(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    is_archived: bool
    archived_at: datetime | None = None
    term_status: Literal["not_started", "valid", "expiring", "expired"]
    days_left: int

    @field_validator("created_at", "updated_at", "archived_at", mode="before")
    @classmethod
    def sqlite_utc(cls, value):
        return value.replace(tzinfo=timezone.utc) if isinstance(value, datetime) and value.tzinfo is None else value


class SignatureRead(SignatureCreate, DocumentMetadata):
    @field_validator("revoked_at", mode="before")
    @classmethod
    def sqlite_revocation_utc(cls, value):
        return value.replace(tzinfo=timezone.utc) if isinstance(value, datetime) and value.tzinfo is None else value


class PowerOfAttorneyRead(PowerOfAttorneyCreate, DocumentMetadata):
    pass
