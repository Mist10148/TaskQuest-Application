from __future__ import annotations

import ssl
from datetime import date, datetime, timedelta, timezone

import certifi

from app.config import Settings
from app.db.pool import decode_date, decode_timestamptz, encode_date, encode_timestamptz, ssl_context


def _first_pem() -> str:
    text = open(certifi.where(), encoding="ascii").read()
    end = "-----END CERTIFICATE-----"
    start = text.index("-----BEGIN CERTIFICATE-----")
    return text[start : text.index(end, start) + len(end)] + "\n"


def test_no_tls_by_default():
    assert ssl_context(Settings(db_ssl=False)) is None


def test_tls_verifies_by_default():
    ctx = ssl_context(Settings(db_ssl=True))
    assert ctx is not None
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname


def test_custom_ca_is_trusted_even_with_escaped_newlines():
    pem = _first_pem()
    plain = ssl_context(Settings(db_ssl=True, db_ssl_ca=pem))
    escaped = ssl_context(Settings(db_ssl=True, db_ssl_ca=pem.replace("\n", "\\n")))
    for ctx in (plain, escaped):
        assert ctx is not None
        assert ctx.verify_mode == ssl.CERT_REQUIRED
        assert any(cert for cert in ctx.get_ca_certs())


def test_reject_unauthorized_false_disables_checks():
    ctx = ssl_context(Settings(db_ssl=True, db_ssl_reject_unauthorized=False))
    assert ctx is not None
    assert ctx.verify_mode == ssl.CERT_NONE
    assert not ctx.check_hostname


def test_timestamptz_codec_reads_and_writes_naive_utc():
    """asyncpg would treat a naive datetime as local time; the service's naive datetimes are UTC."""
    naive = datetime(2026, 3, 1, 12, 30, 15, 123456)
    assert decode_timestamptz(encode_timestamptz(naive)) == naive
    aware = datetime(2026, 3, 1, 20, 30, 15, 123456, tzinfo=timezone(timedelta(hours=8)))
    assert decode_timestamptz(encode_timestamptz(aware)) == naive
    assert decode_timestamptz(encode_timestamptz("2026-03-01 12:30:15.123456")) == naive
    assert encode_timestamptz(datetime(2000, 1, 1)) == (0,)


def test_date_codec_accepts_iso_strings_and_dates():
    assert encode_date("2026-03-01") == "2026-03-01"
    assert encode_date(date(2026, 3, 1)) == "2026-03-01"
    assert decode_date("2026-03-01") == date(2026, 3, 1)


def test_url_is_postgres_with_ai_credentials():
    url = Settings(
        db_url="postgresql://app:pw@db.example:6543/tq", ai_db_user="ai", ai_db_password="s3cret"
    ).sqlalchemy_url
    assert url == "postgresql+asyncpg://ai:s3cret@db.example:6543/tq"
