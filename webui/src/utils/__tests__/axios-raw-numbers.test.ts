import { describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

vi.unmock('axios');
vi.mock('@/router', () => ({
  router: {
    replace: vi.fn(),
    currentRoute: { value: { path: '/config', name: 'Config' } },
  },
}));

describe('axios raw JSON number preservation (real axios instance)', () => {
  it('should preserve a stored large integer on bot A across GET, unrelated bot B edit, JSON clone, and PATCH', async () => {
    const { axios } = await import('@/utils/axios');

    const serverPayload =
      '{"notification":{"enable":true,"providers":[{"type":"telegram","enabled":true,"token":"********","chat_id":"-100A","telegram":{"include_poster":true,"message_thread_id":42,"disable_notification":null,"protect_content":null,"parse_mode":null,"reply_markup":null,"text_parameters":{"future_number":9007199254740993},"photo_parameters":{}}},{"type":"telegram","enabled":true,"token":"********","chat_id":"-100B","telegram":{"include_poster":true,"message_thread_id":73,"disable_notification":null,"protect_content":null,"parse_mode":null,"reply_markup":null,"text_parameters":{},"photo_parameters":{}}}]}}';

    let sentPatchBody: unknown = null;
    let sentPatchContentType = '';
    let sentTestBody: unknown = null;
    const adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === 'api/v1/config/get') {
        return {
          data: serverPayload,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      if (config.url === 'api/v1/config/update') {
        sentPatchBody = config.data;
        sentPatchContentType = String(config.headers?.getContentType?.() || '');
        return {
          data: '{"msg_en":"Update config successfully.","msg_zh":"更新配置成功。"}',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      if (config.url === 'api/v1/notification/test-config') {
        sentTestBody = config.data;
        return {
          data: '{"success":true,"message":"ok","message_en":"ok","message_zh":"好"}',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      if (config.url === 'api/v1/log') {
        return {
          data: '2026-11-20 INFO id=9007199254740993\n',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
          config,
        };
      }
      throw new Error(`Unexpected URL: ${config.url}`);
    };

    const { data: loaded } = await axios.get<any>('api/v1/config/get', {
      adapter,
    });
    // Edit only bot B's topic, then deep-clone like configStore.setConfig() and update-card.vue
    loaded.notification.providers[1].telegram.message_thread_id = 88;
    const submitted = JSON.parse(JSON.stringify(loaded));

    await axios.patch('api/v1/config/update', submitted, { adapter });

    expect(sentPatchContentType).toContain('application/json');
    expect(typeof sentPatchBody).toBe('string');
    expect(sentPatchBody).toContain('"future_number":9007199254740993');
    expect(sentPatchBody).not.toContain('9007199254740992');
    expect(sentPatchBody).toContain('"message_thread_id":88');
    expect(sentPatchBody).not.toContain('__ab_raw_json_number_');

    // Draft test for bot A also preserves its stored large integer on the wire
    await axios.post(
      'api/v1/notification/test-config',
      submitted.notification.providers[0],
      { adapter, params: { saved_provider_index: 0 } }
    );
    expect(typeof sentTestBody).toBe('string');
    expect(sentTestBody).toContain('"future_number":9007199254740993');
    expect(sentTestBody).not.toContain('9007199254740992');

    // Plain-text log responses containing large digits stay raw strings
    const { data: logText } = await axios.get<string>('api/v1/log', {
      adapter,
    });
    expect(logText).toBe('2026-11-20 INFO id=9007199254740993\n');
  });

  it('should not wrap large numeric IDs on non-config routes such as inbox messages and markRead', async () => {
    const { axios } = await import('@/utils/axios');
    const { apiNotification } = await import('@/api/notification');

    const seenMarkReadUrls: string[] = [];
    const originalAdapter = axios.defaults.adapter;
    axios.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === 'api/v1/notification/messages') {
        return {
          data: '{"messages":[{"id":9007199254740992,"kind":"rss_failed","severity":"warning","title":"RSS","body":"Offline","payload":null,"read":false,"count":1,"created_at":"2026-11-20T00:00:00Z","updated_at":"2026-11-20T00:00:00Z"}],"total":1,"unread_count":1}',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      if (config.url?.startsWith('api/v1/notification/messages/')) {
        seenMarkReadUrls.push(config.url);
        return {
          data: '{"status":true,"status_code":200,"msg_en":"Message marked as read.","msg_zh":"消息已标记为已读。"}',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config,
        };
      }
      throw new Error(`Unexpected URL: ${config.url}`);
    };

    try {
      const inbox = await apiNotification.getMessages();
      expect(inbox.messages).toHaveLength(1);
      const messageId = inbox.messages[0].id;
      expect(typeof messageId).toBe('number');
      expect(messageId).toBe(9007199254740992);

      await apiNotification.markRead(messageId);
      expect(seenMarkReadUrls).toEqual([
        'api/v1/notification/messages/9007199254740992/read',
      ]);
    } finally {
      axios.defaults.adapter = originalAdapter;
    }
  });
});
