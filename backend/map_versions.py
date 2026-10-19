"""Immutable plan snapshots; live employee and equipment data are never copied."""
import json

from models import MapFloorVersion, MapMarker


def snapshot(db, floor):
    return {
        'name': floor.name, 'width': floor.width, 'height': floor.height,
        'shapes': json.loads(floor.shapes_json), 'background_opacity': floor.background_opacity,
        'network': json.loads(floor.network_json),
        'markers': [{key: getattr(marker, key) for key in
                     ('entity_type', 'entity_id', 'x', 'y', 'rotation', 'room_id', 'locked', 'group_id')}
                    for marker in db.query(MapMarker).filter_by(floor_id=floor.id).order_by(MapMarker.id)],
    }


def remember(db, floor, label=None):
    if db.query(MapFloorVersion).filter_by(floor_id=floor.id, revision=floor.revision).first():
        return
    db.add(MapFloorVersion(floor_id=floor.id, revision=floor.revision, saved_at=floor.updated_at,
                          saved_by=floor.updated_by, label=label,
                          document_json=json.dumps(snapshot(db, floor), ensure_ascii=False),
                          background_filename=floor.background_filename))
    db.flush()
