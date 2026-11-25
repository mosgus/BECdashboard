from datetime import date
from io import BytesIO

import pandas as pd
import pytest
from openpyxl import load_workbook

from app.macro_inputs import (
    MARKETS,
    SLOTS,
    TEMPLATE_END,
    MacroInputError,
    MacroInputs,
    parse_inputs,
    parse_slot,
    template_workbook,
    yahoo_ticker,
)

SLOT_IDS = [slot.id for slot in SLOTS]


@pytest.fixture(scope="module")
def templates():
    return {slot.id: template_workbook(slot.id) for slot in SLOTS}


def _edit(content: bytes, change) -> bytes:
    wb = load_workbook(BytesIO(content))
    change(wb)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _rejection(slot_id: str, content: bytes) -> MacroInputError:
    with pytest.raises(MacroInputError) as info:
        parse_slot(slot_id, content)
    assert info.value.slot_id == slot_id
    return info.value


def test_there_are_fifteen_slots_in_contract_order():
    assert SLOT_IDS == ["cy1", "cy2", "macro", "pmis"] + [
        f"cons_{prefix.lower()}" for _label, _tab, prefix in MARKETS.values()
    ]
    assert [slot.market for slot in SLOTS[4:]] == list(MARKETS)
    assert [slot.filename for slot in SLOTS[:4]] == [
        "CY1.xlsx", "CY2.xlsx", "Bloomberg_Macro_Data_Values.xlsx", "PMIs.xlsx"]
    assert SLOTS[6].filename == "EWUCONS.xlsx"
    assert SLOTS[4].label == "U.S. holdings (SPX)"


def test_template_end_is_a_friday():
    assert TEMPLATE_END.weekday() == 4


@pytest.mark.parametrize("slot_id", SLOT_IDS)
def test_every_template_parses(templates, slot_id):
    parsed = parse_slot(slot_id, templates[slot_id])

    expected = {
        "cy1": TEMPLATE_END, "cy2": TEMPLATE_END, "macro": date(2026, 10, 31), "pmis": date(2026, 10, 1),
    }.get(slot_id)
    assert parsed.slot_id == slot_id
    assert parsed.data_through == expected


def test_template_frames_have_the_shapes_the_scorecard_reads(templates):
    cy = parse_slot("cy1", templates["cy1"]).frames
    assert set(cy) == {tab for _label, tab, _prefix in MARKETS.values()}
    assert list(cy["SPY-USA"].columns)[:2] == ["Date", "EPS"]
    assert cy["SPY-USA"]["Date"].iloc[0] == "30 Oct '26"  # text, newest first
    assert cy["SPY-USA"]["Date"].iloc[-1] == "01 Jan '16"
    assert (cy["SPY-USA"]["EPS"] > 0).all()
    assert cy["SPY-USA"]["PE (x)"].between(10, 30).all()

    macro = parse_slot("macro", templates["macro"]).frames
    assert list(macro) == ["Consumer Sentiment", "Housing Permits YoY", "GDP YoY", "Retail Sales YoY",
                           "Industrial Prod YoY", "CPI YoY"]
    assert macro["CPI YoY"].shape[1] == 22
    assert macro["CPI YoY"].iat[0, 0] == "US"
    assert pd.to_datetime(macro["GDP YoY"].iat[2, 0]) == pd.Timestamp("2006-03-31")
    assert pd.to_datetime(macro["GDP YoY"].iloc[-1, 0]) == pd.Timestamp("2026-09-30")

    pmis = parse_slot("pmis", templates["pmis"]).frames
    assert "China (S&P Global/HSBC)" in pmis["All PMIs"].columns
    assert "Canada" not in pmis["All Services PMIs"].columns
    values = pmis["All PMIs"].iloc[:, 1:].apply(pd.to_numeric, errors="coerce")  # the last row is a source note
    assert values.iloc[:-1].stack().between(40, 60).all()
    assert values.iloc[-1].isna().all()

    holdings = parse_slot("cons_ewj", templates["cons_ewj"]).frames["holdings"]
    assert list(holdings.columns)[1:] == ["EQ %Port", "Ticker"]
    assert holdings.iat[0, 0] == "Total (Count: 20)"
    assert len(holdings) == 21
    assert holdings["Ticker"].iloc[1] == "SAMPLE1-JP"


def test_templates_are_reproducible():
    first = parse_slot("cy1", template_workbook("cy1")).frames["EWT-USA"]
    second = parse_slot("cy1", template_workbook("cy1")).frames["EWT-USA"]
    other = parse_slot("cy2", template_workbook("cy2")).frames["EWT-USA"]

    assert first.equals(second)
    assert not first.equals(other)


def test_parse_inputs_assembles_everything(templates):
    inputs = parse_inputs(templates)

    assert isinstance(inputs, MacroInputs)
    assert len(inputs.cy1) == 11 and len(inputs.cy2) == 11
    assert len(inputs.macro) == 6
    assert len(inputs.pmis) == 2
    assert list(inputs.constituents) == list(MARKETS)
    assert all(isinstance(frame, pd.DataFrame) for frame in inputs.constituents.values())


def test_parse_inputs_names_the_missing_slot(templates):
    files = {slot_id: content for slot_id, content in templates.items() if slot_id != "cons_ewt"}

    with pytest.raises(MacroInputError) as info:
        parse_inputs(files)

    assert info.value.slot_id == "cons_ewt"
    assert str(info.value) == "No file uploaded for Taiwan holdings (EWT)"


def test_parse_inputs_reports_the_first_bad_file(templates):
    files = templates | {"pmis": b"hello", "cons_ewj": templates["cons_spx"]}

    with pytest.raises(MacroInputError) as info:
        parse_inputs(files)

    assert info.value.slot_id == "pmis"


def test_unknown_slot_is_a_key_error(templates):
    with pytest.raises(KeyError):
        parse_slot("cy3", templates["cy1"])


def test_non_xlsx_bytes_are_rejected_without_leaking_internals(templates):
    for content in (b"hello", b"", b"PK\x03\x04 but not a real zip"):
        message = str(_rejection("cy1", content))
        assert ".xlsx" in message
        assert "Error" not in message and "Traceback" not in message


def test_a_zip_that_is_not_a_workbook_is_rejected():
    import zipfile

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.txt", "not a workbook")

    assert ".xlsx" in str(_rejection("pmis", buffer.getvalue()))


def test_cy_without_a_market_tab(templates):
    content = _edit(templates["cy1"], lambda wb: wb.remove(wb["EWT-USA"]))

    assert "EWT-USA" in str(_rejection("cy1", content))


def test_cy_with_a_renamed_header(templates):
    def rename(wb):
        wb["EWG-USA"]["D3"] = "P/E"

    message = str(_rejection("cy2", _edit(templates["cy2"], rename)))

    assert "PE (x)" in message and "EWG-USA" in message


def test_cy_tab_without_a_usable_row(templates):
    def ruin_dates(wb):
        for row in wb["EWQ-USA"].iter_rows(min_row=4, max_col=1):
            row[0].value = "2026-10-30"

    message = str(_rejection("cy1", _edit(templates["cy1"], ruin_dates)))

    assert "EWQ-USA" in message


def test_cy_ignores_extra_tabs(templates):
    content = _edit(templates["cy1"], lambda wb: wb.create_sheet("Notes"))

    assert set(parse_slot("cy1", content).frames) == {tab for _l, tab, _p in MARKETS.values()}


def test_macro_without_a_sheet(templates):
    content = _edit(templates["macro"], lambda wb: wb.remove(wb["CPI YoY"]))

    assert "CPI YoY" in str(_rejection("macro", content))


def test_macro_without_a_country_pair(templates):
    def drop_japan(wb):
        ws = wb["GDP YoY"]
        column = next(c.column for c in ws[1] if c.value == "Japan")
        ws.delete_cols(column, 2)

    message = str(_rejection("macro", _edit(templates["macro"], drop_japan)))

    assert "Japan" in message and "GDP YoY" in message


def test_macro_does_not_need_the_pairs_the_scorecard_never_reads(templates):
    def drop(wb):
        for sheet, country in (("Industrial Prod YoY", "Canada"), ("Housing Permits YoY", "Taiwan")):
            ws = wb[sheet]
            column = next(c.column for c in ws[1] if c.value == country)
            ws.delete_cols(column, 2)

    assert parse_slot("macro", _edit(templates["macro"], drop)).data_through == date(2026, 10, 31)


def test_macro_still_needs_canada_in_other_sheets(templates):
    def drop(wb):
        ws = wb["CPI YoY"]
        ws.delete_cols(next(c.column for c in ws[1] if c.value == "Canada"), 2)

    assert "Canada" in str(_rejection("macro", _edit(templates["macro"], drop)))


def test_pmis_without_the_services_sheet(templates):
    content = _edit(templates["pmis"], lambda wb: wb.remove(wb["All Services PMIs"]))

    assert "All Services PMIs" in str(_rejection("pmis", content))


def test_pmis_without_a_country_column(templates):
    def drop_france(wb):
        ws = wb["All PMIs"]
        ws.delete_cols(next(c.column for c in ws[1] if c.value == "France"))

    message = str(_rejection("pmis", _edit(templates["pmis"], drop_france)))

    assert "France" in message and "All PMIs" in message


def test_pmis_without_a_date_column(templates):
    def rename(wb):
        wb["All PMIs"]["A1"] = "Month"

    message = str(_rejection("pmis", _edit(templates["pmis"], rename)))

    assert "Date" in message and "All PMIs" in message


def test_services_pmis_need_no_canada_korea_or_taiwan(templates):
    sheet = parse_slot("pmis", templates["pmis"]).frames["All Services PMIs"]

    assert not {"Canada", "South Korea", "Taiwan"} & set(sheet.columns)


def test_pmis_china_matches_any_column_starting_with_china(templates):
    def rename(wb):
        ws = wb["All Services PMIs"]
        next(c for c in ws[1] if c.value == "China").value = "China (Caixin)"

    assert parse_slot("pmis", _edit(templates["pmis"], rename)).data_through == date(2026, 10, 1)


def test_constituents_from_the_wrong_market(templates):
    message = str(_rejection("cons_ewj", templates["cons_spx"]))

    assert "Japan" in message and "EWJ" in message


def test_germany_holdings_do_not_pass_as_the_eurozone(templates):
    message = str(_rejection("cons_ezu", templates["cons_ewg"]))

    assert "Eurozone" in message


def test_a_germany_only_workbook_fails_the_eurozone_slot():
    def all_german(wb):
        ws = wb.active
        for row in ws.iter_rows(min_row=3, min_col=3, max_col=3):
            row[0].value = row[0].value.rsplit("-", 1)[0] + "-DE"

    content = _edit(template_workbook("cons_ezu"), all_german)

    assert "Eurozone" in str(_rejection("cons_ezu", content))


def test_each_constituents_template_passes_only_its_own_slot(templates):
    cons = [slot for slot in SLOTS if slot.market]
    for template in cons:
        for target in cons:
            if template.id == target.id:
                continue
            with pytest.raises(MacroInputError):
                parse_slot(target.id, templates[template.id])


def test_the_eurozone_template_is_spread_over_four_countries(templates):
    tickers = parse_slot("cons_ezu", templates["cons_ezu"]).frames["holdings"]["Ticker"].iloc[1:]

    assert set(tickers.str[-2:]) == {"FR", "DE", "IT", "NL"}


def test_china_template_maps_to_yahoo_symbols(templates):
    tickers = parse_slot("cons_mchi", templates["cons_mchi"]).frames["holdings"]["Ticker"].iloc[1:]

    assert all(yahoo_ticker(t) for t in tickers)
    assert {t.rsplit("-", 1)[1] for t in tickers} == {"CN", "HK"}
    assert {yahoo_ticker(t)[-3:] for t in tickers} == {".SS", ".SZ", ".HK"}


def test_constituents_third_column_must_be_ticker(templates):
    def rename(wb):
        wb.active["C1"] = "Symbol"

    message = str(_rejection("cons_ewj", _edit(templates["cons_ewj"], rename)))

    assert "Ticker" in message


def test_constituents_need_a_yahoo_mappable_ticker(templates):
    def cash_only(wb):
        for row in wb.active.iter_rows(min_row=3, min_col=3, max_col=3):
            row[0].value = "-"

    message = str(_rejection("cons_ewj", _edit(templates["cons_ewj"], cash_only)))

    assert "Yahoo" in message


def test_pmis_workbook_in_the_cy_slot(templates):
    message = str(_rejection("cy1", templates["pmis"]))

    assert "SPY-USA" in message


@pytest.mark.parametrize("code, expected", [
    ("8306-JP", "8306.T"),
    ("BRK.B-US", "BRK-B"),
    ("NDA.FI-FI", "NDA-FI.HE"),
    ("700-HK", "0700.HK"),
    ("600519-CN", "600519.SS"),
    ("000858-CN", "000858.SZ"),
    ("-", None),
    ("FOUSA00DRS-US", None),
    ("ABC-XX", None),
    ("NOCODE", None),
    (None, None),
])
def test_yahoo_ticker(code, expected):
    assert yahoo_ticker(code) == expected
