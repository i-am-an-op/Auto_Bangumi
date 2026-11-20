"""Exercise the Bot API protocol at the HTTP transport boundary."""

import json
import logging
from email import policy
from email.parser import BytesParser
from unittest.mock import AsyncMock

import httpx2
import pytest

from module.notification.telegram_api import TelegramBotAPI, TelegramError


@pytest.fixture
async def upstream(monkeypatch):
    requests = []
    replies = []

    def handle(request):
        requests.append(request)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    async with httpx2.AsyncClient(
        transport=httpx2.MockTransport(handle), follow_redirects=True
    ) as client:
        monkeypatch.setattr(
            "module.notification.telegram_api.get_shared_client",
            AsyncMock(return_value=client),
        )
        yield requests, replies


@pytest.mark.parametrize(
    "result", [True, 0, "credential-result", [], {"new_field": "保留"}]
)
async def test_future_method_and_result_types(upstream, result, caplog):
    caplog.set_level(logging.INFO)
    requests, replies = upstream
    replies.append(httpx2.Response(200, json={"ok": True, "result": result}))
    api = TelegramBotAPI(
        "123:private", "http://local.test:8081/api/", test_environment=True
    )
    params = {"future_field": [False, 0, {}, "💬"], "id": 1234567890123456}
    assert await api.call("futureMethod2", params) == {"ok": True, "result": result}
    (request,) = requests
    assert (
        str(request.url)
        == "http://local.test:8081/api/bot123:private/test/futureMethod2"
    )
    assert json.loads(request.content) == params
    assert "123:private" not in caplog.text
    assert "credential-result" not in caplog.text


async def test_multipart_nested_inputs(upstream):
    requests, replies = upstream
    replies.append(httpx2.Response(200, json={"ok": True, "result": []}))
    media = [{"type": "photo", "media": "attach://cover", "caption": "日本語"}]
    await TelegramBotAPI("token").call(
        "sendMediaGroup",
        {"media": media, "disable_notification": False},
        files={"cover": ("海報.jpg", b"image", "image/jpeg")},
    )
    (request,) = requests
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {request.headers['content-type']}\r\n\r\n".encode()
        + request.content
    )
    parts = {
        p.get_param("name", header="content-disposition"): p
        for p in message.iter_parts()
    }
    media_bytes = parts["media"].get_payload(decode=True)
    assert isinstance(media_bytes, bytes)
    assert json.loads(media_bytes) == media
    assert parts["disable_notification"].get_payload(decode=True) == b"false"
    assert parts["cover"].get_payload(decode=True) == b"image"
    assert parts["cover"].get_content_type() == "image/jpeg"


@pytest.mark.parametrize("status", [200, 429])
async def test_rejection_preserves_response_parameters(upstream, status):
    requests, replies = upstream
    error = {
        "ok": False,
        "error_code": 429,
        "description": "Too many requests",
        "parameters": {"retry_after": 7, "migrate_to_chat_id": -1001234567890},
    }
    replies.append(httpx2.Response(status, json=error))
    with pytest.raises(TelegramError) as caught:
        await TelegramBotAPI("token").call("sendMessage")
    assert caught.value.envelope == error
    assert caught.value.status == status
    assert len(requests) == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(307, headers={"Location": "https://elsewhere.test"}),
        httpx2.Response(500, content=b"private server error"),
        httpx2.Response(200, json={"ok": True}),
        httpx2.ReadTimeout("bot123:private"),
    ],
)
async def test_ambiguous_failure_is_safe_and_sent_once(upstream, response):
    requests, replies = upstream
    replies.append(response)
    with pytest.raises(TelegramError) as caught:
        await TelegramBotAPI("123:private").call("sendMessage")
    assert "private" not in str(caught.value)
    assert caught.value.status in {502, 504}
    assert caught.value.envelope is None
    assert len(requests) == 1


async def test_file_transfer_and_long_poll(upstream):
    requests, replies = upstream
    replies.extend(
        [
            httpx2.Response(200, json={"ok": True, "result": []}),
            httpx2.Response(
                200, json={"ok": True, "result": {"file_path": "dir/cover 1.jpg"}}
            ),
            httpx2.Response(200, content=b"image"),
        ]
    )
    api = TelegramBotAPI("token", test_environment=True)
    await api.call("getUpdates", {"offset": 12, "timeout": 50, "allowed_updates": []})
    path = await api.get_file_path("file-id")
    async with api.download(path) as resp:
        assert b"".join([block async for block in resp.aiter_bytes()]) == b"image"
    assert requests[0].extensions["timeout"]["read"] > 50
    assert requests[2].url.raw_path == b"/file/bottoken/test/dir/cover%201.jpg"
    assert resp.is_closed


@pytest.mark.parametrize(
    "method", ["../getMe", "https://another.test", "getMe?key=1", "getMe\n"]
)
async def test_invalid_method_does_not_reach_transport(upstream, method):
    with pytest.raises(TelegramError):
        await TelegramBotAPI("token").call(method)
    assert not upstream[0]


@pytest.mark.parametrize(
    "server",
    [
        "file:///tmp/bot",
        "http://api.telegram.org",
        "https://bot:pass@host",
        "https://host?q=1",
        "https://host:invalid",
    ],
)
def test_invalid_server(server):
    with pytest.raises(TelegramError, match="server URL"):
        TelegramBotAPI("token", server)
