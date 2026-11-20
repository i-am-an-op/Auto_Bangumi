import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAxiosMock } from '@/test/mocks/axios';
import { apiConfig } from '@/api/config';
import { useConfigStore } from '@/store/config';
import type { Config, NotificationProviderConfig } from '#/config';
import { initConfig } from '#/config';

vi.mock('@/utils/axios', () => ({ axios: createAxiosMock() }));

vi.mock('@/hooks/useApi', () => ({
  useApi: (fn: (...args: unknown[]) => Promise<unknown>) => ({
    execute: async (...args: unknown[]) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (error) {
        return { ok: false, error };
      }
    },
  }),
}));

vi.mock('@/api/config', () => ({
  apiConfig: { getConfig: vi.fn(), updateConfig: vi.fn() },
}));

function clone(config: Config): Config {
  return JSON.parse(JSON.stringify(config));
}

describe('config store refreshGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces one group in both the draft and the snapshot, keeping other edits', async () => {
    const server = clone(initConfig);
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));
    const store = useConfigStore();
    await store.getConfig();

    // 用户改了别的段（未保存），同时插件卡片直接保存了 plugins 段
    store.config.program.rss_time = 1234;
    server.plugins.enabled = { demo: true };
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));
    await store.refreshGroup('plugins', ['enabled', 'options']);

    expect(store.config.plugins.enabled).toEqual({ demo: true });
    expect(store.config.program.rss_time).toBe(1234);
    // plugins 段不再算作未保存，program 段仍然是脏的
    expect(store.dirtyGroups).toContain('program');
    expect(store.dirtyGroups).not.toContain('plugins');
  });

  it('should keep unsaved downloader and slot edits when only plugin fields are refreshed', async () => {
    const server = clone(initConfig);
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));
    const store = useConfigStore();
    await store.getConfig();

    store.config.plugins.slots.downloader = 'nas';
    store.config.plugins.instances.push({
      ...store.config.plugins.instances[0],
      id: 'nas',
    });
    server.plugins.enabled = { demo: true };
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));
    await store.refreshGroup('plugins', ['enabled', 'options']);

    expect(store.config.plugins.enabled).toEqual({ demo: true });
    expect(store.config.plugins.slots.downloader).toBe('nas');
    expect(store.config.plugins.instances.map((i) => i.id)).toEqual([
      'default',
      'nas',
    ]);
    // 实例与 slots 的修改仍未保存
    expect(store.dirtyGroups).toContain('plugins');
  });
});

describe('config store setConfig and provider identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeTelegramRow(threadId: number): NotificationProviderConfig {
    return {
      type: 'telegram',
      enabled: true,
      token: '********',
      chat_id: '-1001234567890',
      telegram: {
        include_poster: true,
        message_thread_id: threadId,
        disable_notification: null,
        protect_content: null,
        parse_mode: null,
        reply_markup: null,
        text_parameters: {},
        photo_parameters: {},
      },
    };
  }

  it('should snapshot the submitted config so deletions during a pending save remain dirty and keep server indices', async () => {
    const server = clone(initConfig);
    server.notification = {
      enable: true,
      providers: [makeTelegramRow(42), makeTelegramRow(73)],
    };
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));

    const store = useConfigStore();
    await store.getConfig();

    const rowA = store.config.notification.providers[0];
    const rowB = store.config.notification.providers[1];
    expect(store.getNotificationProviderSavedIndex(rowA)).toBe(0);
    expect(store.getNotificationProviderSavedIndex(rowB)).toBe(1);

    let resolvePatch!: (value: { msg_en: string; msg_zh: string }) => void;
    vi.mocked(apiConfig.updateConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        })
    );

    const savePromise = store.setConfig();

    // Delete A while PATCH [A, B] is still pending
    store.config.notification.providers = [rowB];

    resolvePatch({ msg_en: 'ok', msg_zh: '好' });
    const result = await savePromise;
    expect(result.ok).toBe(true);

    // Server received [A, B]; snapshot stays [A, B], so live [B] is still dirty
    expect(apiConfig.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          providers: [
            expect.objectContaining({
              telegram: expect.objectContaining({ message_thread_id: 42 }),
            }),
            expect.objectContaining({
              telegram: expect.objectContaining({ message_thread_id: 73 }),
            }),
          ],
        }),
      })
    );
    expect(store.savedConfig.notification.providers).toHaveLength(2);
    expect(store.config.notification.providers).toHaveLength(1);
    expect(store.dirtyGroups).toContain('notification');
    expect(store.isDirty).toBe(true);
    // Surviving row B still resolves to index 1 (B on the server), not 0 (A)
    expect(
      store.getNotificationProviderSavedIndex(
        store.config.notification.providers[0]
      )
    ).toBe(1);
  });

  it('should preserve provider identity when a row is edited during a pending save', async () => {
    const server = clone(initConfig);
    server.notification = {
      enable: true,
      providers: [makeTelegramRow(42), makeTelegramRow(73)],
    };
    vi.mocked(apiConfig.getConfig).mockResolvedValue(clone(server));

    const store = useConfigStore();
    await store.getConfig();

    // Remove A and save [B] (so B will become index 0 on the server)
    const rowB = store.config.notification.providers[1];
    store.config.notification.providers = [rowB];

    let resolvePatch!: (value: { msg_en: string; msg_zh: string }) => void;
    vi.mocked(apiConfig.updateConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        })
    );

    const savePromise = store.setConfig();

    // While PATCH [B] is pending, edit B -> B2 (carrying B's identity)
    const editedB: NotificationProviderConfig = {
      ...JSON.parse(JSON.stringify(rowB)),
      telegram: { ...rowB.telegram, message_thread_id: 99 },
    };
    store.copyNotificationProviderIdentity(rowB, editedB);
    store.config.notification.providers = [editedB];

    resolvePatch({ msg_en: 'ok', msg_zh: '好' });
    await savePromise;

    // Live editedB is still dirty (99 vs saved 73), and now maps to saved index 0
    expect(store.dirtyGroups).toContain('notification');
    expect(
      store.savedConfig.notification.providers[0].telegram?.message_thread_id
    ).toBe(73);
    expect(
      store.getNotificationProviderSavedIndex(
        store.config.notification.providers[0]
      )
    ).toBe(0);
  });
});
