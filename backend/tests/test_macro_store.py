from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from app import macro_store
from app.db import get_engine, session
from app.macro_inputs import SLOTS, MacroInputError, template_workbook
from app.macro_store import (
    MAX_UPLOAD_BYTES,
    Gate,
    InvalidSignature,
    NothingToRevert,
    UploadLocked,
    UploadTooLarge,
    gate,
    live_upload_ids,
    live_versions,
    revert,
    slot_statuses,
    store_upload,
    versions_to_evict,
)
from app.models import Base, MacroUpload

UTC = timezone.utc
T = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
H = timedelta(hours=1)
M = timedelta(minutes=1)
SLOT = "cons_spx"  # a constituents workbook is tiny, so these tests do not pay for a CY parse


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_macro_store.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture(scope="module")
def template():
    return template_workbook(SLOT)


def _variant(template: bytes, n: int) -> bytes:
    """A valid workbook whose bytes differ per n."""
    wb = load_workbook(BytesIO(template))
    wb.active["A3"] = f"Sample Company variant {n}"
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _row_count(slot_id: str = SLOT) -> int:
    with session() as db:
        return db.scalar(select(func.count()).select_from(MacroUpload).where(MacroUpload.slot_id == slot_id))


def _opens_window() -> list[bool]:
    with session() as db:
        return list(db.scalars(select(MacroUpload.opens_window).order_by(MacroUpload.uploaded_at, MacroUpload.id)))


# --- pure functions ------------------------------------------------------------------------


def test_gate_with_no_window_is_open_and_opens_one():
    assert gate(None, T) == Gate(True, True, None, None)


def test_gate_inside_the_window_is_open_and_does_not_open_another():
    assert gate(T, T + 59 * M) == Gate(True, False, T + H, None)


def test_gate_is_locked_at_exactly_one_hour():
    assert gate(T, T + H) == Gate(False, False, None, T + 24 * H)


def test_gate_is_unlocked_at_exactly_twenty_four_hours():
    assert gate(T, T + 24 * H) == Gate(True, True, None, None)


def _hourly(n: int) -> list[tuple[int, datetime, bool, bool]]:
    """n rows, ids 1..n, one per hour, oldest first; none reverted, none an opener."""
    return [(i, T + (i - 1) * H, False, False) for i in range(1, n + 1)]


def test_evict_keeps_five_newest_and_the_pre_window_version():
    rows = [  # (id, uploaded_at, reverted, opens_window); the window opened at the third row
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), False, False),
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), False, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), False, True),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), False, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), False, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), False, False),
        (7, datetime(2026, 11, 25, 18, 0, tzinfo=UTC), False, False),
    ]
    window_opened_at = datetime(2026, 11, 25, 14, 0, tzinfo=UTC)  # the third row's time
    assert versions_to_evict(rows, window_opened_at) == {1}


def test_evict_without_a_window_keeps_exactly_five():
    rows = [
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), False, False),
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), False, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), False, False),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), False, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), False, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), False, False),
        (7, datetime(2026, 11, 25, 18, 0, tzinfo=UTC), False, False),
    ]
    assert versions_to_evict(rows, None) == {1, 2}


def test_evict_keeps_the_live_row_when_the_newest_five_are_reverted():
    rows = [
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), False, False),
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), True, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), True, False),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), True, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), True, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), True, False),
    ]
    assert versions_to_evict(rows, None) == set()


def test_evict_keeps_the_window_opener_even_when_it_is_the_oldest_row():
    rows = [
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), False, True),
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), False, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), False, False),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), False, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), False, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), False, False),
        (7, datetime(2026, 11, 25, 18, 0, tzinfo=UTC), False, False),
    ]
    assert versions_to_evict(rows, datetime(2026, 11, 25, 12, 0, tzinfo=UTC)) == {2}


def test_evict_keeps_a_reverted_window_opener():
    rows = [
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), True, True),  # the vandal's upload, reverted
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), False, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), False, False),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), False, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), False, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), False, False),
        (7, datetime(2026, 11, 25, 18, 0, tzinfo=UTC), False, False),
    ]
    assert versions_to_evict(rows, datetime(2026, 11, 25, 12, 0, tzinfo=UTC)) == {2}


def test_evict_keeps_only_the_newest_opener():
    rows = [
        (1, datetime(2026, 11, 25, 12, 0, tzinfo=UTC), False, True),  # an earlier window's opener
        (2, datetime(2026, 11, 25, 13, 0, tzinfo=UTC), False, False),
        (3, datetime(2026, 11, 25, 14, 0, tzinfo=UTC), False, True),
        (4, datetime(2026, 11, 25, 15, 0, tzinfo=UTC), False, False),
        (5, datetime(2026, 11, 25, 16, 0, tzinfo=UTC), False, False),
        (6, datetime(2026, 11, 25, 17, 0, tzinfo=UTC), False, False),
        (7, datetime(2026, 11, 25, 18, 0, tzinfo=UTC), False, False),
        (8, datetime(2026, 11, 25, 19, 0, tzinfo=UTC), False, False),
    ]
    # Row 3 is the newest opener, row 2 the pre-window version; the earlier opener (row 1) is not special.
    assert versions_to_evict(rows, datetime(2026, 11, 25, 14, 0, tzinfo=UTC)) == {1}


def test_evict_does_not_depend_on_row_order():
    rows = _hourly(7)
    assert versions_to_evict(list(reversed(rows)), None) == versions_to_evict(rows, None) == {1, 2}


# --- the database --------------------------------------------------------------------------


def test_first_upload_opens_a_window_and_becomes_live(db_mode, template):
    status = store_upload(SLOT, "SPXCONS.xlsx", template, "  Ada  ", T)

    assert status.slot_id == SLOT
    assert len(status.versions) == 1
    version = status.versions[0]
    assert (version.filename, version.size_bytes, version.uploaded_by) == ("SPXCONS.xlsx", len(template), "Ada")
    assert version.live is True and version.uploaded_at == T and version.data_through is None
    assert status.gate == Gate(True, False, T + H, None)
    assert status.can_revert is False
    assert _opens_window() == [True]


def test_filename_is_reduced_to_its_last_path_component_and_cut(db_mode, template):
    status = store_upload(SLOT, "C:\\Users\\ada\\Downloads/" + "x" * 300, template, "Ada", T)
    assert status.versions[0].filename == "x" * 200


def test_second_upload_inside_the_window_does_not_move_it_and_the_lock_follows(db_mode, template):
    store_upload(SLOT, "a.xlsx", _variant(template, 1), "Ada", T)

    status = store_upload(SLOT, "b.xlsx", _variant(template, 2), "Bo", T + 30 * M)
    assert status.gate == Gate(True, False, T + H, None)  # still closes at T + 1 h, not T + 1.5 h
    assert _opens_window() == [True, False]

    with pytest.raises(UploadLocked) as info:
        store_upload(SLOT, "c.xlsx", _variant(template, 3), "Cy", T + H)
    assert info.value.slot_id == SLOT and info.value.unlocks_at == T + 24 * H
    assert _row_count() == 2

    status = store_upload(SLOT, "d.xlsx", _variant(template, 4), "Di", T + 24 * H)
    assert status.gate == Gate(True, False, T + 25 * H, None)
    assert _opens_window() == [True, False, True]


def test_revert_works_while_locked_and_walks_back_one_version_at_a_time(db_mode, template):
    for n, minutes in enumerate((0, 10, 20), start=1):
        store_upload(SLOT, f"v{n}.xlsx", _variant(template, n), f"User {n}", T + minutes * M)

    status = revert(SLOT, "Rey", T + 2 * H)  # the slot is locked now; revert is allowed anyway
    newest, middle, oldest = status.versions
    assert (newest.reverted_by, newest.reverted_at, newest.live) == ("Rey", T + 2 * H, False)
    assert (middle.live, middle.reverted_at) == (True, None)
    assert status.can_revert is True
    assert status.gate == Gate(False, False, None, T + 24 * H)  # revert never touches the window

    status = revert(SLOT, "Rey", T + 3 * H)
    assert [v.live for v in status.versions] == [False, False, True]
    assert status.can_revert is False
    assert _row_count() == 3  # reverting deletes nothing

    with pytest.raises(NothingToRevert) as info:
        revert(SLOT, "Rey", T + 4 * H)
    assert info.value.slot_id == SLOT


def test_revert_with_one_version_or_none_raises(db_mode, template):
    with pytest.raises(NothingToRevert):
        revert(SLOT, "Rey", T)
    store_upload(SLOT, "v1.xlsx", template, "Ada", T)
    with pytest.raises(NothingToRevert):
        revert(SLOT, "Rey", T + M)


def test_a_reverted_opener_still_holds_the_lock(db_mode, template):
    store_upload(SLOT, "good.xlsx", _variant(template, 1), "Ada", T - 48 * H)
    store_upload(SLOT, "vandal.xlsx", _variant(template, 2), "Mallory", T)
    revert(SLOT, "Rey", T + 5 * M)

    with pytest.raises(UploadLocked):
        store_upload(SLOT, "again.xlsx", _variant(template, 3), "Mallory", T + 2 * H)


def test_invalid_content_oversize_and_bad_names_store_nothing(db_mode, template):
    with pytest.raises(MacroInputError):
        store_upload(SLOT, "x.xlsx", b"hello", "Ada", T)
    with pytest.raises(UploadTooLarge):
        store_upload(SLOT, "x.xlsx", b"PK\x03\x04" + bytes(MAX_UPLOAD_BYTES), "Ada", T)
    for name in ("   ", "x" * 61, "line\nbreak", "tab\there"):
        with pytest.raises(InvalidSignature):
            store_upload(SLOT, "x.xlsx", template, name, T)
        with pytest.raises(InvalidSignature):
            revert(SLOT, name, T)
    assert _row_count() == 0
    # None of those opened a window.
    assert store_upload(SLOT, "ok.xlsx", template, "x" * 60, T).gate == Gate(True, False, T + H, None)


def test_unknown_slot_raises_key_error(db_mode, template):
    with pytest.raises(KeyError):
        store_upload("nope", "x.xlsx", template, "Ada", T)
    with pytest.raises(KeyError):
        revert("nope", "Ada", T)


def test_a_locked_slot_is_refused_before_the_file_is_parsed(db_mode, template, monkeypatch):
    store_upload(SLOT, "a.xlsx", template, "Ada", T)

    def parse_must_not_run(*args, **kwargs):
        pytest.fail("parse_slot was called for a locked slot")

    monkeypatch.setattr(macro_store, "parse_slot", parse_must_not_run)
    with pytest.raises(UploadLocked):
        store_upload(SLOT, "b.xlsx", template, "Bo", T + 2 * H)


def _six_uploads_in_one_window(template):
    """A pre-window upload at T - 25 h, then six uploads from T. Returns (status, pre-window id, contents)."""
    pre_window = store_upload(SLOT, "pre.xlsx", _variant(template, 0), "Ada", T - 25 * H).versions[0].id
    contents = [_variant(template, n) for n in range(1, 7)]
    for n, content in enumerate(contents):
        status = store_upload(SLOT, f"v{n}.xlsx", content, "Bo", T + n * M)
    return status, pre_window, contents


def test_six_uploads_in_one_window_keep_the_five_newest_the_opener_and_the_pre_window_version(db_mode, template):
    status, pre_window, contents = _six_uploads_in_one_window(template)

    assert len(status.versions) == 7
    assert [v.filename for v in status.versions] == [
        "v5.xlsx", "v4.xlsx", "v3.xlsx", "v2.xlsx", "v1.xlsx", "v0.xlsx", "pre.xlsx"]
    assert status.versions[-1].id == pre_window
    assert _row_count() == 7

    live = live_versions()
    assert list(live) == [SLOT]
    assert live[SLOT].content == contents[-1]
    assert live_upload_ids() == {SLOT: live[SLOT].upload_id} == {SLOT: status.versions[0].id}


def test_six_uploads_in_one_window_do_not_unlock_the_slot(db_mode, template):
    """The defect: eviction used to delete the row that opened the window, so T fell back to the previous
    window (T - 25 h) and the slot read as unlocked."""
    _six_uploads_in_one_window(template)

    status = next(s for s in slot_statuses(T + 2 * H) if s.slot_id == SLOT)

    assert status.gate == Gate(False, False, None, T + 24 * H)
    with pytest.raises(UploadLocked) as info:
        store_upload(SLOT, "late.xlsx", _variant(template, 99), "Mallory", T + 2 * H)
    assert info.value.unlocks_at == T + 24 * H


def test_parse_runs_outside_the_lock(db_mode, template, monkeypatch):
    real = macro_store.parse_slot
    seen = []

    def parse(slot_id, content):
        seen.append(macro_store._LOCK.locked())
        return real(slot_id, content)

    monkeypatch.setattr(macro_store, "parse_slot", parse)
    store_upload(SLOT, "a.xlsx", template, "Ada", T)

    assert seen == [False]


def test_the_gate_is_recomputed_after_the_parse(db_mode, template, monkeypatch):
    """Simulates another upload landing during this one's parse: an opener dated 30 minutes earlier."""
    real = macro_store.parse_slot
    other = T - 30 * M

    def parse_while_another_upload_lands(slot_id, content):
        with session() as db:
            db.add(MacroUpload(slot_id=slot_id, filename="other.xlsx", content=b"x", size_bytes=1, data_through=None,
                               uploaded_by="Other", uploaded_at=other, opens_window=True))
        return real(slot_id, content)

    monkeypatch.setattr(macro_store, "parse_slot", parse_while_another_upload_lands)
    status = store_upload(SLOT, "mine.xlsx", template, "Ada", T)

    assert _opens_window() == [True, False]  # the other upload's, then this one, which is inside its window
    assert status.gate == Gate(True, False, other + H, None)
    assert [v.filename for v in status.versions] == ["mine.xlsx", "other.xlsx"]


def test_a_slot_locked_during_the_parse_is_refused_at_the_insert(db_mode, template, monkeypatch):
    real = macro_store.parse_slot

    def parse_while_another_upload_lands(slot_id, content):
        with session() as db:
            db.add(MacroUpload(slot_id=slot_id, filename="other.xlsx", content=b"x", size_bytes=1, data_through=None,
                               uploaded_by="Other", uploaded_at=T - 2 * H, opens_window=True))
        return real(slot_id, content)

    monkeypatch.setattr(macro_store, "parse_slot", parse_while_another_upload_lands)

    with pytest.raises(UploadLocked) as info:
        store_upload(SLOT, "mine.xlsx", template, "Ada", T)
    assert info.value.unlocks_at == T - 2 * H + 24 * H
    assert _row_count() == 1  # only the other upload's row


def test_an_empty_filename_falls_back_to_the_slots_conventional_name(db_mode, template):
    status = store_upload(SLOT, "dir/", template, "Ada", T)
    assert status.versions[0].filename == "SPXCONS.xlsx"
    assert store_upload(SLOT, "", _variant(template, 1), "Ada", T + M).versions[0].filename == "SPXCONS.xlsx"


def test_live_versions_skip_reverted_rows_and_slots_without_a_live_version(db_mode, template):
    assert live_versions() == {} and live_upload_ids() == {}
    first, second = _variant(template, 1), _variant(template, 2)
    store_upload(SLOT, "a.xlsx", first, "Ada", T)
    store_upload(SLOT, "b.xlsx", second, "Bo", T + M)
    revert(SLOT, "Rey", T + 2 * M)
    assert live_versions()[SLOT].content == first


def test_slot_statuses_cover_every_slot_in_order(db_mode, template):
    store_upload(SLOT, "a.xlsx", template, "Ada", T)

    statuses = slot_statuses(T + M)

    assert len(statuses) == 15
    assert [s.slot_id for s in statuses] == [slot.id for slot in SLOTS]
    untouched = next(s for s in statuses if s.slot_id == "cons_ewc")
    assert untouched.versions == () and untouched.can_revert is False
    assert untouched.gate == Gate(True, True, None, None)
    touched = next(s for s in statuses if s.slot_id == SLOT)
    assert len(touched.versions) == 1 and touched.gate == Gate(True, False, T + H, None)


def test_returned_times_are_timezone_aware(db_mode, template):
    store_upload(SLOT, "a.xlsx", template, "Ada", T)
    revert_target = store_upload(SLOT, "b.xlsx", _variant(template, 1), "Bo", T + M)
    assert revert_target.versions[0].uploaded_at.tzinfo is not None
    reverted = revert(SLOT, "Rey", T + 2 * M)
    assert reverted.versions[0].reverted_at.tzinfo is not None
    assert reverted.gate.window_closes_at.tzinfo is not None
    assert all(v.uploaded_at.tzinfo is not None for s in slot_statuses(T) for v in s.versions)
