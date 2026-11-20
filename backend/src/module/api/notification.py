"""Notification API endpoints.

包含两部分：外部推送 provider 的测试端点，以及站内通知中心
（/notification/messages*）的收件箱增删查改。
"""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from module.conf import settings
from module.database import Database, get_db
from module.models import ResponseModel
from module.models.config import ProviderEntry, TelegramProviderConfig
from module.notification import NotificationManager
from module.notification.inbox import bump_inbox_revision
from module.security.api import get_current_user

from .config import MaskRestoreError, restore_telegram_secrets

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/notification",
    tags=["notification"],
    dependencies=[Depends(get_current_user)],
)


class TestProviderRequest(BaseModel):
    """Request body for testing a saved provider by index."""

    provider_index: int = Field(
        default=..., description="Index of the provider to test"
    )


class TestResponse(BaseModel):
    """Response for test notification endpoints."""

    success: bool
    message: str
    message_zh: str = ""
    message_en: str = ""


@router.post("/test", response_model=TestResponse)
async def test_provider(request: TestProviderRequest):
    """Test a configured notification provider by its index.

    Sends a test notification using the provider at the specified index
    in the current configuration.
    """
    try:
        manager = NotificationManager(load_providers=False)
        success, message = await manager.test_provider(request.provider_index)
        return TestResponse(
            success=success,
            message=message,
            message_zh="测试成功" if success else f"测试失败: {message}",
            message_en="Test successful" if success else f"Test failed: {message}",
        )
    except Exception as e:
        logger.error(f"Failed to test provider: {e}")
        return TestResponse(
            success=False,
            message=str(e),
            message_zh=f"测试失败: {e}",
            message_en=f"Test failed: {e}",
        )


@router.post(
    "/test-config",
    response_model=TestResponse,
)
async def test_provider_config(
    config: Annotated[ProviderEntry, Body()],
    saved_provider_index: Annotated[
        int | None,
        Query(
            ge=0,
            description="Original saved Telegram row to use for masked credentials in an edited draft.",
        ),
    ] = None,
):
    """Test an unsaved notification provider configuration.

    Useful for testing a provider before saving it to the configuration.
    """
    if saved_provider_index is not None:
        rows = settings.notification.providers
        if (
            not isinstance(config, TelegramProviderConfig)
            or saved_provider_index >= len(rows)
            or rows[saved_provider_index].type.lower() != "telegram"
        ):
            raise HTTPException(422, "The selected saved provider must be Telegram.")
        saved = rows[saved_provider_index]
        if "row_id" in config.model_fields_set and (
            not isinstance(saved, TelegramProviderConfig)
            or saved.row_id != config.row_id
        ):
            raise HTTPException(
                422,
                "The saved Telegram row has moved or been replaced. Reload the settings.",
            )
        data = config.model_dump(by_alias=True)
        try:
            restore_telegram_secrets(data, saved.model_dump(by_alias=True))
        except MaskRestoreError as exc:
            raise HTTPException(422, str(exc)) from None
        config = TelegramProviderConfig.model_validate(data)
    try:
        success, message = await NotificationManager.test_provider_config(config)
        return TestResponse(
            success=success,
            message=message,
            message_zh="测试成功" if success else f"测试失败: {message}",
            message_en="Test successful" if success else f"Test failed: {message}",
        )
    except Exception as e:
        logger.error(f"Failed to test provider config: {e}")
        return TestResponse(
            success=False,
            message=str(e),
            message_zh=f"测试失败: {e}",
            message_en=f"Test failed: {e}",
        )


# ---------------------------------------------------------------------------
# 站内通知中心（收件箱）
# ---------------------------------------------------------------------------


class InboxMessageOut(BaseModel):
    """收件箱消息。payload 为按 kind 约定的结构化字段，供前端本地化渲染。"""

    id: int
    kind: str
    severity: str
    title: str
    body: str
    payload: dict | None = None
    read: bool
    count: int
    created_at: str
    updated_at: str


class InboxListResponse(BaseModel):
    messages: list[InboxMessageOut]
    total: int
    unread_count: int


def _to_out(message) -> InboxMessageOut:
    payload = None
    if message.payload:
        try:
            payload = json.loads(message.payload)
        except json.JSONDecodeError, TypeError:
            payload = None
    return InboxMessageOut(
        id=message.id,
        kind=message.kind,
        severity=message.severity,
        title=message.title,
        body=message.body,
        payload=payload,
        read=message.read,
        count=message.count,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


@router.get(
    "/messages",
    response_model=InboxListResponse,
)
async def list_messages(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db),
):
    messages = await db.inbox.list(unread_only=unread_only, limit=limit, offset=offset)
    total = await db.inbox.count_all(unread_only=unread_only)
    unread = await db.inbox.unread_count()
    return InboxListResponse(
        messages=[_to_out(m) for m in messages],
        total=total,
        unread_count=unread,
    )


@router.get(
    "/messages/unread-count",
)
async def unread_count(db: Database = Depends(get_db)):
    return {"unread_count": await db.inbox.unread_count()}


@router.post(
    "/messages/read-all",
    response_model=ResponseModel,
)
async def mark_all_read(db: Database = Depends(get_db)):
    changed = await db.inbox.mark_all_read()
    bump_inbox_revision()
    return ResponseModel(
        status=True,
        status_code=200,
        msg_en=f"Marked {changed} messages as read.",
        msg_zh=f"已将 {changed} 条消息标记为已读。",
    )


@router.post(
    "/messages/{message_id}/read",
    response_model=ResponseModel,
)
async def mark_read(message_id: int, db: Database = Depends(get_db)):
    if not await db.inbox.mark_read(message_id):
        raise HTTPException(status_code=404, detail="Message not found")
    bump_inbox_revision()
    return ResponseModel(
        status=True,
        status_code=200,
        msg_en="Message marked as read.",
        msg_zh="消息已标记为已读。",
    )


@router.delete(
    "/messages/{message_id}",
    response_model=ResponseModel,
)
async def delete_message(message_id: int, db: Database = Depends(get_db)):
    if not await db.inbox.delete(message_id):
        raise HTTPException(status_code=404, detail="Message not found")
    bump_inbox_revision()
    return ResponseModel(
        status=True,
        status_code=200,
        msg_en="Message deleted.",
        msg_zh="消息已删除。",
    )


@router.delete(
    "/messages",
    response_model=ResponseModel,
)
async def clear_messages(db: Database = Depends(get_db)):
    removed = await db.inbox.clear()
    bump_inbox_revision()
    return ResponseModel(
        status=True,
        status_code=200,
        msg_en=f"Cleared {removed} messages.",
        msg_zh=f"已清空 {removed} 条消息。",
    )
