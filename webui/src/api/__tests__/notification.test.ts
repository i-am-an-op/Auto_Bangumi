/**
 * Contract tests for apiNotification: call the real functions against a
 * mocked axios instance so a drift between the wrapper and the FastAPI
 * routes in backend/src/module/api/notification.py fails a test instead of
 * going unnoticed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAxiosMock } from '@/test/mocks/axios';
import type { TestProviderConfigRequest } from '@/api/notification';

import { apiNotification } from '@/api/notification';
import { axios } from '@/utils/axios';

vi.mock('@/utils/axios', () => ({ axios: createAxiosMock() }));

const mockTestResponse = {
  success: true,
  message: 'ok',
  message_zh: '成功',
  message_en: 'ok',
};

describe('Notification API contract (path + HTTP method)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should POST api/v1/notification/test with the provider index when testing a saved provider', async () => {
    (axios.post as any).mockResolvedValue({ data: mockTestResponse });
    const request = { provider_index: 0 };
    await apiNotification.testProvider(request);
    expect(axios.post).toHaveBeenCalledWith(
      'api/v1/notification/test',
      request
    );
  });

  it('should POST api/v1/notification/test-config with the provider config when testing an unsaved provider', async () => {
    (axios.post as any).mockResolvedValue({ data: mockTestResponse });
    const request: TestProviderConfigRequest = {
      type: 'telegram',
      token: 'abc',
      chat_id: '123',
      telegram: {
        include_poster: false,
        message_thread_id: 42,
        parse_mode: 'HTML',
        disable_notification: false,
        protect_content: true,
        reply_markup: {
          inline_keyboard: [[{ text: 'Open', url: 'https://example.org' }]],
        },
        text_parameters: { link_preview_options: { is_disabled: true } },
        photo_parameters: { has_spoiler: true },
      },
    };
    await apiNotification.testProviderConfig(request);
    expect(axios.post).toHaveBeenCalledWith(
      'api/v1/notification/test-config',
      request
    );
  });

  it('should forward saved_provider_index query parameter when testing edits to a saved Telegram row', async () => {
    (axios.post as any).mockResolvedValue({ data: mockTestResponse });
    const request: TestProviderConfigRequest = {
      type: 'telegram',
      token: '********',
      chat_id: '-100123',
      telegram: { message_thread_id: 42 },
    };
    await apiNotification.testProviderConfig(request, {
      savedProviderIndex: 0,
    });
    expect(axios.post).toHaveBeenCalledWith(
      'api/v1/notification/test-config',
      request,
      { params: { saved_provider_index: 0 } }
    );
  });
});
