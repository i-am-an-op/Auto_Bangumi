"""Translate AutoBangumi notifications into operator-selected Telegram calls."""

import logging
import re
from mimetypes import guess_type
from pathlib import PurePath

from pydantic import JsonValue

from module.models.bangumi import Notification
from module.models.config import NotificationProvider as ProviderConfig
from module.models.config import TelegramProviderConfig
from module.models.telegram import TelegramAction
from module.notification.base import NotificationProvider
from module.notification.telegram_api import TelegramBotAPI, TelegramError, Uploads
from module.utils import load_image, load_poster_url

logger = logging.getLogger(__name__)

_PLACEHOLDER = re.compile(
    r"\{\{(text|title|body|chat_id|season|episode|poster_url)\}\}"
)
type Context = dict[str, str | int | float]


def _render(value: JsonValue, context: Context) -> JsonValue:
    """Substitute string leaves once. A whole numeric placeholder stays numeric."""
    if isinstance(value, list):
        return [_render(item, context) for item in value]
    if isinstance(value, dict):
        return {key: _render(item, context) for key, item in value.items()}
    if isinstance(value, str):
        match = _PLACEHOLDER.fullmatch(value)
        if match and match[1] in context:
            return context[match[1]]
        return _PLACEHOLDER.sub(lambda m: str(context.get(m[1], m[0])), value)
    return value


class TelegramProvider(NotificationProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        row = TelegramProviderConfig.model_validate(config)
        self.chat_id = row.chat_id
        self.options = row.telegram
        self.api = TelegramBotAPI(
            row.token, row.server_url, self.options.test_environment
        )

    async def _action(
        self, action: TelegramAction, context: Context, files: Uploads | None = None
    ) -> bool:
        params = {
            key: _render(value, context) for key, value in action.parameters.items()
        }
        return await self._deliver(action.method, params, files)

    async def _deliver(
        self, method: str, params: dict, files: Uploads | None = None
    ) -> bool:
        try:
            await self.api.call(method, params, files=files)
            return True
        except TelegramError as exc:
            logger.warning("Telegram %s failed (status %s)", method, exc.status)
            return False

    async def _poster_files(self, path: str | None, field: str) -> Uploads | None:
        image = await load_image(path)
        if not image:
            return None
        filename = PurePath(path or "poster.jpg").name
        return {
            field: (
                filename,
                image,
                guess_type(filename)[0] or "application/octet-stream",
            )
        }

    async def _photo(self, params: dict, files: Uploads | None = None) -> bool | None:
        """None means Telegram rejected the photo and it is safe to try a fallback."""
        try:
            await self.api.call("sendPhoto", params, files=files)
            return True
        except TelegramError as exc:
            if exc.envelope and exc.envelope.get("error_code") == 400:
                return None
            logger.warning("Telegram sendPhoto failed (status %s)", exc.status)
            return False

    async def send(self, notification: Notification) -> bool:
        text = self._format_message(notification)
        source_url = await load_poster_url(notification.poster_path)
        if action := self.options.episode:
            files = None
            if action.attach_poster:
                files = await self._poster_files(notification.poster_path, "poster")
                if not files:
                    logger.warning("Telegram episode action requires a cached poster")
                    return False
            return await self._action(
                action,
                {
                    "chat_id": self.chat_id,
                    "text": text,
                    "title": notification.official_title,
                    "episode": notification.episode,
                    "season": notification.season,
                    "poster_url": source_url or self._poster_url(notification) or "",
                },
                files,
            )

        params = {
            "chat_id": self.chat_id,
            "caption": text,
            "disable_notification": True,
            **self.options.photo_parameters,
        }
        if "photo" in params:
            result = await self._photo(params)
            if result is not None:
                return result
        elif source_url:
            result = await self._photo({**params, "photo": source_url})
            if result is not None:
                return result
        if files := await self._poster_files(notification.poster_path, "photo"):
            result = await self._photo(
                {k: v for k, v in params.items() if k != "photo"}, files
            )
            if result is not None:
                return result
        return await self._deliver("sendMessage", self._text_parameters(text))

    def _text_parameters(self, text: str) -> dict:
        return {
            "chat_id": self.chat_id,
            "text": text,
            "disable_notification": True,
            **self.options.text_parameters,
        }

    async def _deliver_text(self, title: str, body: str) -> bool:
        text = f"{title}\n{body}"
        if action := self.options.event:
            return await self._action(
                action,
                {"chat_id": self.chat_id, "text": text, "title": title, "body": body},
            )
        return await self._deliver("sendMessage", self._text_parameters(text))

    async def test(self) -> tuple[bool, str]:
        """Exercise ordinary delivery or verify a bot configured without a chat."""
        params = {
            "chat_id": self.chat_id,
            "text": "AutoBangumi 通知测试成功！\nNotification test successful!",
            **self.options.text_parameters,
        }
        try:
            if params.get("chat_id"):
                await self.api.call("sendMessage", params)
                return True, "Telegram test message sent successfully"
            await self.api.call("getMe")
            return True, "Telegram bot authenticated successfully"
        except TelegramError as exc:
            return False, f"Telegram test failed: {exc}"
