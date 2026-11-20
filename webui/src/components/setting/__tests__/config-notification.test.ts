import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { ref, toRaw } from 'vue';
import ConfigNotification from '../config-notification.vue';
import AbField from '@/components/basic/ab-field.vue';
import type { NotificationProviderConfig } from '#/config';
import { apiNotification } from '@/api/notification';
import {
  parseJsonPreservingNumbers,
  stringifyJsonPreservingNumbers,
} from '@/utils/json-raw-numbers';

vi.mock('@/api/notification', () => ({
  apiNotification: { testProviderConfig: vi.fn(), testProvider: vi.fn() },
}));
vi.mock('@/hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/hooks/useMyI18n', () => ({
  useMyI18n: () => ({
    t: (key: string, p?: Record<string, string | number>) => {
      if (p?.id !== undefined) return `${key}:${p.id}`;
      if (p?.keys !== undefined) return `${key}:${p.keys}`;
      if (p?.value !== undefined) return `${key}:${p.value}`;
      return key;
    },
    returnUserLangText: (m: Record<string, string>) => m.en,
  }),
}));
vi.mock('@/hooks/usePluginProviders', () => ({
  usePluginProviders: () => ref({ notifier: ['ntfy'] }),
}));

function defaultProviders(): NotificationProviderConfig[] {
  return [
    { type: 'telegram', enabled: true, token: '********' },
    { type: 'ntfy', enabled: true, topic: '********' } as any,
  ];
}

const group = ref<{ enable: boolean; providers: NotificationProviderConfig[] }>(
  {
    enable: true,
    providers: defaultProviders(),
  }
);
const saved = {
  notification: { providers: [] as NotificationProviderConfig[] },
};
const storeRowIds = new WeakMap<object, symbol>();
const storeSavedIndices = new Map<symbol, number>();

function ensureRowId(row: NotificationProviderConfig): symbol {
  const raw = toRaw(row);
  let id = storeRowIds.get(raw);
  if (!id) {
    id = Symbol('test-provider-row');
    storeRowIds.set(raw, id);
  }
  return id;
}

function seedSavedProviders(rows: NotificationProviderConfig[]) {
  group.value.providers = rows;
  saved.notification.providers = JSON.parse(JSON.stringify(rows));
  storeSavedIndices.clear();
  group.value.providers.forEach((row, index) => {
    const id = Symbol('test-provider-row');
    storeRowIds.set(toRaw(row), id);
    storeSavedIndices.set(id, index);
  });
}

vi.mock('@/store/config', () => ({
  useConfigStore: () => ({
    getSettingGroup: () => group,
    savedConfig: saved,
    getNotificationProviderSavedIndex: (row: NotificationProviderConfig) => {
      const id = storeRowIds.get(toRaw(row));
      return id ? storeSavedIndices.get(id) : undefined;
    },
    copyNotificationProviderIdentity: (
      from: NotificationProviderConfig,
      to: NotificationProviderConfig
    ) => {
      storeRowIds.set(toRaw(to), ensureRowId(from));
    },
  }),
}));

const api = vi.mocked(apiNotification);

function mountPage(options: { realField?: boolean } = {}) {
  return mount(ConfigNotification, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        'ab-fold-panel': { template: '<section><slot /></section>' },
        'ab-setting': true,
        'ab-tag': {
          props: ['title'],
          template: '<span class="ab-tag">{{ title }}</span>',
        },
        'ab-alert': {
          props: ['type'],
          template: '<div class="ab-alert" :data-type="type"><slot /></div>',
        },
        'ab-field': options.realField
          ? AbField
          : {
              props: ['label', 'error'],
              template:
                '<div class="ab-field"><slot /><span v-if="error" class="field-error">{{ error }}</span></div>',
            },
        'ab-input': {
          props: ['modelValue', 'placeholder', 'type'],
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" :type="type || \'text\'" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        'ab-switch': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
        },
        'ab-select': {
          props: ['modelValue', 'options'],
          emits: ['update:modelValue'],
          template:
            '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
        },
        'advanced-section': {
          props: ['open'],
          emits: ['update:open'],
          template:
            '<div class="advanced-section" :data-open="String(open)"><slot /></div>',
        },
        'ab-icon-button': {
          props: ['label'],
          template: '<button :aria-label="label"><slot /></button>',
        },
        'ab-button': { template: '<button><slot /></button>' },
        'ab-modal': {
          props: ['show'],
          template: '<div v-if="show"><slot /><slot name="footer" /></div>',
        },
        NSelect: {
          props: ['value'],
          emits: ['update:value'],
          template: '<select class="type" />',
        },
      },
    },
  });
}

const ok = { data: { success: true, message_en: 'ok', message_zh: '好' } };

describe('config-notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    group.value.enable = true;
    api.testProviderConfig.mockResolvedValue(ok as any);
    api.testProvider.mockResolvedValue(ok as any);
    seedSavedProviders(defaultProviders());
  });

  // /config/get 返回的密钥是掩码，列表测试须按下标走后端保存的配置
  it.each([
    [0, 'Telegram: ok'],
    [1, 'config.notification_set.plugin_label:ntfy: ok'],
  ])(
    'should test saved row %i by index when testing from the list',
    async (index, text) => {
      const w = mountPage();
      const buttons = w.findAll('[aria-label="config.notification_set.test"]');
      await buttons[index].trigger('click');
      await flushPromises();
      expect(api.testProviderConfig).not.toHaveBeenCalled();
      expect(api.testProvider).toHaveBeenCalledWith({ provider_index: index });
      expect(w.find('.test-result').text()).toBe(text);
    }
  );

  // 未保存的行（新增或删除后下标错位）在后端没有对应项，按当前配置测试
  it('should test an unsaved row with its in-memory config', async () => {
    saved.notification.providers = [];
    storeSavedIndices.clear();
    const w = mountPage();
    await w
      .find('[aria-label="config.notification_set.test"]')
      .trigger('click');
    await flushPromises();
    expect(api.testProvider).not.toHaveBeenCalled();
    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'telegram' })
    );
  });

  it('should keep dialog test results out of the list and clear them on close', async () => {
    const w = mountPage();
    const add = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await add.trigger('click');
    const test = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await test.trigger('click');
    await flushPromises();
    expect(w.findAll('.test-result')).toHaveLength(1);
    const cancel = w
      .findAll('button')
      .find((b) => b.text() === 'config.cancel')!;
    await cancel.trigger('click');
    await flushPromises();
    expect(w.find('.test-result').exists()).toBe(false);
  });

  // Bark 也读 url（点击跳转）：切换类型后不能带着上一类型的 Webhook URL
  it('should reset type-specific fields when the type changes in the add dialog', async () => {
    const w = mountPage();
    const add = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await add.trigger('click');
    const vm = w.vm as any;
    vm.newProvider.type = 'webhook';
    vm.newProvider.url = 'https://hook.example.com';
    vm.newProvider.template = '{"t": 1}';
    await flushPromises();
    const select = w.findComponent('.provider-type-select') as VueWrapper;
    select.vm.$emit('update:value', 'bark');
    await flushPromises();
    expect(vm.newProvider).toEqual({ type: 'bark', enabled: true });
  });

  it('should show a credentials hint and no Test button for plugin types', async () => {
    const w = mountPage();
    const add = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await add.trigger('click');
    expect(w.find('.plugin-hint').exists()).toBe(false);
    (w.vm as any).newProvider.type = 'ntfy';
    await flushPromises();
    expect(w.find('.plugin-hint').exists()).toBe(true);
    expect(
      w
        .findAll('button')
        .some((b) => b.text() === 'config.notification_set.test')
    ).toBe(false);
  });

  it('should edit, test with masked token via saved_provider_index, apply, and reopen preserving options and parameter objects', async () => {
    const keyboard = {
      inline_keyboard: [
        [{ text: 'Open library', url: 'https://library.example.org' }],
      ],
    };
    const textParams = {
      link_preview_options: { is_disabled: true },
      future_options: [[{ secret_token: '********' }]],
    };
    const photoParams = { has_spoiler: true };
    seedSavedProviders([
      {
        type: 'telegram',
        enabled: true,
        token: '********',
        chat_id: '-1001234567890',
        template: '<b>{{title}}</b>',
        telegram: {
          include_poster: true,
          message_thread_id: 7,
          disable_notification: null,
          protect_content: null,
          parse_mode: 'HTML',
          reply_markup: keyboard,
          text_parameters: textParams,
          photo_parameters: photoParams,
        },
      },
    ]);

    const w = mountPage();
    await w
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();

    // Edit topic ID, turn off poster, explicitly allow sound (false), protect content (true)
    await w.find('[data-field="telegram-thread-id"]').setValue('42');
    await w.find('[data-field="telegram-include-poster"]').setValue(false);
    await w
      .find('[data-field="telegram-disable-notification"]')
      .setValue('false');
    await w.find('[data-field="telegram-protect-content"]').setValue('true');

    // Test inside dialog with masked token -> passes savedProviderIndex: 0
    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await testBtn.trigger('click');
    await flushPromises();

    expect(api.testProvider).not.toHaveBeenCalled();
    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'telegram',
        token: '********',
        chat_id: '-1001234567890',
        template: '<b>{{title}}</b>',
        telegram: {
          include_poster: false,
          message_thread_id: 42,
          disable_notification: false,
          protect_content: true,
          parse_mode: 'HTML',
          reply_markup: keyboard,
          text_parameters: textParams,
          photo_parameters: photoParams,
        },
      }),
      { savedProviderIndex: 0 }
    );

    // Apply edits and reopen
    const applyBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!;
    await applyBtn.trigger('click');
    await flushPromises();

    expect(group.value.providers[0].token).toBe('********');
    expect(group.value.providers[0].telegram).toEqual({
      include_poster: false,
      message_thread_id: 42,
      disable_notification: false,
      protect_content: true,
      parse_mode: 'HTML',
      reply_markup: keyboard,
      text_parameters: textParams,
      photo_parameters: photoParams,
    });

    await w
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();

    expect(
      (w.find('[data-field="telegram-thread-id"]').element as HTMLInputElement)
        .value
    ).toBe('42');
    expect(
      (
        w.find('[data-field="telegram-include-poster"]')
          .element as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        w.find('[data-field="telegram-disable-notification"]')
          .element as HTMLSelectElement
      ).value
    ).toBe('false');
    expect(
      (
        w.find('[data-field="telegram-protect-content"]')
          .element as HTMLSelectElement
      ).value
    ).toBe('true');
    expect(
      JSON.parse(
        (
          w.find('[data-field="telegram-text-parameters"]')
            .element as HTMLTextAreaElement
        ).value
      )
    ).toEqual(textParams);
  });

  it('should preserve row identity across Settings search remounts for identical masked rows and edited rows', async () => {
    const identicalRow = (): NotificationProviderConfig => ({
      type: 'telegram',
      enabled: true,
      token: '********',
      chat_id: '-1001234567890',
      telegram: {
        include_poster: true,
        message_thread_id: null,
        disable_notification: null,
        protect_content: null,
        parse_mode: null,
        reply_markup: null,
        text_parameters: {},
        photo_parameters: {},
      },
    });
    seedSavedProviders([identicalRow(), identicalRow()]);

    const firstMount = mountPage();
    // Delete bot A (index 0); surviving row is bot B (saved index 1)
    await firstMount
      .findAll('[aria-label="config.notification_set.remove"]')[0]
      .trigger('click');
    await flushPromises();

    // Simulate searching "proxy" (unmounts ConfigNotification) then clearing search (remounts)
    firstMount.unmount();
    const afterSearch = mountPage();

    // Testing untouched surviving row B must still target saved index 1, not bot A at 0
    await afterSearch
      .find('[aria-label="config.notification_set.test"]')
      .trigger('click');
    await flushPromises();
    expect(api.testProvider).toHaveBeenCalledWith({ provider_index: 1 });
    expect(api.testProviderConfig).not.toHaveBeenCalled();

    // Edit surviving row B, remount again via search, and test -> still passes savedProviderIndex: 1
    vi.clearAllMocks();
    api.testProviderConfig.mockResolvedValue(ok as any);
    await afterSearch
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();
    await afterSearch.find('[data-field="telegram-thread-id"]').setValue('55');
    await afterSearch
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    afterSearch.unmount();
    const afterSecondSearch = mountPage();
    await afterSecondSearch
      .find('[aria-label="config.notification_set.test"]')
      .trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        token: '********',
        telegram: expect.objectContaining({ message_thread_id: 55 }),
      }),
      { savedProviderIndex: 1 }
    );
  });

  it('should keep original saved_provider_index when two bots swap topics (shared save fixture)', async () => {
    const makeRow = (threadId: number): NotificationProviderConfig => ({
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
    });
    seedSavedProviders([makeRow(42), makeRow(73)]);

    const w = mountPage();
    // Swap A: 42 -> 73
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[0]
      .trigger('click');
    await flushPromises();
    await w.find('[data-field="telegram-thread-id"]').setValue('73');
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    // Swap B: 73 -> 42
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[1]
      .trigger('click');
    await flushPromises();
    await w.find('[data-field="telegram-thread-id"]').setValue('42');
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    // Remount to confirm identity survives search as well
    w.unmount();
    const w2 = mountPage();
    const testButtons = w2.findAll(
      '[aria-label="config.notification_set.test"]'
    );
    await testButtons[0].trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        telegram: expect.objectContaining({ message_thread_id: 73 }),
      }),
      { savedProviderIndex: 0 }
    );

    await testButtons[1].trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        telegram: expect.objectContaining({ message_thread_id: 42 }),
      }),
      { savedProviderIndex: 1 }
    );
  });

  it('should keep the original saved_provider_index when the draft list is reordered or an earlier row is removed', async () => {
    seedSavedProviders([
      { type: 'bark', enabled: true, device_key: '********' },
      {
        type: 'telegram',
        enabled: false,
        token: '********',
        chat_id: '@episodes',
        telegram: {
          include_poster: true,
          message_thread_id: 1,
          disable_notification: true,
          protect_content: null,
          parse_mode: null,
          reply_markup: null,
          text_parameters: {},
          photo_parameters: {},
        },
      },
    ]);

    const w = mountPage();
    // Reorder the draft list so the disabled Telegram row (saved index 1) moves to index 0
    group.value.providers = [
      group.value.providers[1],
      group.value.providers[0],
    ];
    await flushPromises();

    // Testing untouched reordered Telegram row still uses saved provider_index 1
    const listTestButtons = w.findAll(
      '[aria-label="config.notification_set.test"]'
    );
    await listTestButtons[0].trigger('click');
    await flushPromises();
    expect(api.testProvider).toHaveBeenCalledWith({ provider_index: 1 });

    // Edit the reordered Telegram row and test inside dialog -> still uses savedProviderIndex: 1
    vi.clearAllMocks();
    api.testProviderConfig.mockResolvedValue(ok as any);
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[0]
      .trigger('click');
    await flushPromises();
    await w.find('[data-field="telegram-thread-id"]').setValue('5');
    await w
      .find('[data-field="telegram-disable-notification"]')
      .setValue('false');
    const dialogTest = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await dialogTest.trigger('click');
    await flushPromises();

    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        token: '********',
        telegram: expect.objectContaining({
          message_thread_id: 5,
          disable_notification: false,
        }),
      }),
      { savedProviderIndex: 1 }
    );

    // Apply, then test from list -> still uses savedProviderIndex: 1
    const applyBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!;
    await applyBtn.trigger('click');
    await flushPromises();

    vi.clearAllMocks();
    api.testProviderConfig.mockResolvedValue(ok as any);
    await w
      .findAll('[aria-label="config.notification_set.test"]')[0]
      .trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        telegram: expect.objectContaining({ message_thread_id: 5 }),
      }),
      { savedProviderIndex: 1 }
    );
  });

  it('should clear stale test feedback on edits and ignore late responses from a closed dialog', async () => {
    seedSavedProviders([
      { type: 'telegram', enabled: true, token: '********', chat_id: '-100A' },
      { type: 'telegram', enabled: true, token: '********', chat_id: '-100B' },
    ]);

    let resolveDialogA!: (val: unknown) => void;
    api.testProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDialogA = resolve;
        }) as any
    );

    const w = mountPage();
    // Open A, click Test, close A before response arrives, then open B
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[0]
      .trigger('click');
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!
      .trigger('click');
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.cancel')!
      .trigger('click');
    await flushPromises();

    await w
      .findAll('[aria-label="config.notification_set.edit"]')[1]
      .trigger('click');
    await flushPromises();

    // A's late response resolves while B's dialog is open -> must be ignored
    resolveDialogA({
      data: { success: true, message_en: 'Bot A ok', message_zh: 'A 成功' },
    });
    await flushPromises();
    expect(w.find('.test-result').exists()).toBe(false);

    // Run a test on B, see result, then edit a field -> stale dialog result clears
    api.testProvider.mockResolvedValueOnce({
      data: { success: true, message_en: 'Bot B ok', message_zh: 'B 成功' },
    } as any);
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!
      .trigger('click');
    await flushPromises();
    expect(w.find('.test-result').text()).toBe('Bot B ok');

    await w.find('[data-field="telegram-thread-id"]').setValue('73');
    await flushPromises();
    expect(w.find('.test-result').exists()).toBe(false);

    // Close dialog, test from list, then toggle row -> stale list result clears
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.cancel')!
      .trigger('click');
    await flushPromises();
    await w
      .findAll('[aria-label="config.notification_set.test"]')[0]
      .trigger('click');
    await flushPromises();
    expect(w.find('.test-result').text()).toBe('Telegram: ok');

    await w
      .findAll('[aria-label="config.notification_set.disable"]')[0]
      .trigger('click');
    await flushPromises();
    expect(w.find('.test-result').exists()).toBe(false);
  });

  it('should treat mixed-case type "Telegram" identically to lowercase telegram throughout', async () => {
    seedSavedProviders([
      {
        type: 'Telegram',
        enabled: true,
        token: '********',
        chat_id: '-100Mixed',
        telegram: {
          include_poster: true,
          message_thread_id: 12,
          disable_notification: null,
          protect_content: null,
          parse_mode: null,
          reply_markup: null,
          text_parameters: {},
          photo_parameters: {},
        },
      },
    ]);

    const w = mountPage();
    expect(w.find('.i-simple-icons-telegram').exists()).toBe(true);
    expect(w.find('.provider-name').text()).toContain('Telegram');

    await w
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();

    // Must not show plugin hint and must keep the Test button visible
    expect(w.find('.plugin-hint').exists()).toBe(false);
    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test');
    expect(testBtn).toBeDefined();

    await w.find('[data-field="telegram-thread-id"]').setValue('34');
    await testBtn!.trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Telegram',
        token: '********',
        telegram: expect.objectContaining({ message_thread_id: 34 }),
      }),
      { savedProviderIndex: 0 }
    );
  });

  it('should connect the template and three JSON textareas to their labels, descriptions, and validation errors', async () => {
    const w = mountPage({ realField: true });
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!
      .trigger('click');
    await flushPromises();

    await w.find('[data-field="telegram-reply-markup"]').setValue('{not-json');
    await w
      .find('[data-field="telegram-text-parameters"]')
      .setValue('{"big": 9007199254740993}');
    await w
      .find('[data-field="telegram-photo-parameters"]')
      .setValue('{"huge": 1e400}');

    await w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    // Template textarea: linked to visible label and description
    const templateArea = w.find('[data-field="telegram-template"]');
    const templateId = templateArea.attributes('id')!;
    expect(templateId).toBeTruthy();
    expect(w.find(`label[for="${templateId}"]`).text()).toBe(
      'config.notification_set.telegram_template'
    );
    const templateDescIds = (
      templateArea.attributes('aria-describedby') ?? ''
    ).split(' ');
    expect(templateDescIds).toHaveLength(1);
    expect(w.find(`#${templateDescIds[0]}`).text()).toBe(
      'config.notification_set.telegram_template_hint'
    );
    expect(templateArea.attributes('aria-invalid')).toBeUndefined();

    // Three JSON textareas: linked to label, description, AND error alert + aria-invalid
    const jsonCases = [
      {
        field: 'telegram-reply-markup',
        label: 'config.notification_set.telegram_reply_markup',
        desc: 'config.notification_set.telegram_reply_markup_hint',
        err: 'config.notification_set.telegram_error_invalid_json',
      },
      {
        field: 'telegram-text-parameters',
        label: 'config.notification_set.telegram_text_parameters',
        desc: 'config.notification_set.telegram_text_parameters_hint',
        err: 'config.notification_set.telegram_error_unrepresentable_number:9007199254740993',
      },
      {
        field: 'telegram-photo-parameters',
        label: 'config.notification_set.telegram_photo_parameters',
        desc: 'config.notification_set.telegram_photo_parameters_hint',
        err: 'config.notification_set.telegram_error_unrepresentable_number:1e400',
      },
    ];

    for (const c of jsonCases) {
      const el = w.find(`[data-field="${c.field}"]`);
      const id = el.attributes('id')!;
      expect(id).toBeTruthy();
      expect(w.find(`label[for="${id}"]`).text()).toBe(c.label);
      expect(el.attributes('aria-invalid')).toBe('true');
      const describedBy = (el.attributes('aria-describedby') ?? '').split(' ');
      expect(describedBy).toHaveLength(2);
      expect(w.find(`#${describedBy[0]}`).text()).toBe(c.desc);
      expect(w.find(`#${describedBy[1]}`).text()).toBe(c.err);
      expect(w.find(`#${describedBy[1]}`).attributes('role')).toBe('alert');
    }

    // Test button is also blocked when JSON contains unrepresentable numbers
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!
      .trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).not.toHaveBeenCalled();
  });

  it('should not mutate the provider row when canceling edits', async () => {
    seedSavedProviders([
      {
        type: 'telegram',
        enabled: true,
        token: '********',
        chat_id: '-100',
        telegram: {
          include_poster: true,
          message_thread_id: 10,
          disable_notification: null,
          protect_content: null,
          parse_mode: null,
          reply_markup: null,
          text_parameters: {},
          photo_parameters: {},
        },
      },
    ]);

    const w = mountPage();
    await w
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();

    await w.find('[data-field="telegram-thread-id"]').setValue('99');
    await w.find('[data-field="telegram-include-poster"]').setValue(false);
    const cancelBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.cancel')!;
    await cancelBtn.trigger('click');
    await flushPromises();

    expect(group.value.providers[0].telegram?.message_thread_id).toBe(10);
    expect(group.value.providers[0].telegram?.include_poster).toBe(true);
  });

  it('should surface HTTP 200 success=false and HTTP 422 validation errors to the operator', async () => {
    const w = mountPage();
    const addBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await addBtn.trigger('click');
    await flushPromises();

    // HTTP 200 with success: false (Telegram rejection)
    api.testProviderConfig.mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Bad Request: message thread not found',
        message_en: 'Test failed: Bad Request: message thread not found',
        message_zh: '测试失败: Bad Request: message thread not found',
      },
    } as any);
    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await testBtn.trigger('click');
    await flushPromises();
    expect(w.find('.test-result').attributes('data-type')).toBe('danger');
    expect(w.find('.test-result').text()).toBe(
      'Test failed: Bad Request: message thread not found'
    );

    // HTTP 422 validation error rejected by axios interceptor
    api.testProviderConfig.mockRejectedValueOnce({
      status: 422,
      msg_en: '',
      msg_zh: '',
      detail: 'The selected saved provider must be Telegram.',
    });
    await testBtn.trigger('click');
    await flushPromises();
    expect(w.find('.test-result').attributes('data-type')).toBe('danger');
    expect(w.find('.test-result').text()).toBe(
      'The selected saved provider must be Telegram.'
    );
  });

  it('should block test and apply on invalid Telegram topic ID or reserved JSON keys and expand advanced section', async () => {
    const w = mountPage();
    const addBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await addBtn.trigger('click');
    await flushPromises();

    await w.find('[data-field="telegram-thread-id"]').setValue('0');
    await w
      .find('[data-field="telegram-text-parameters"]')
      .setValue('{"chat_id": "other"}');

    const applyBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!;
    await applyBtn.trigger('click');
    await flushPromises();

    // Modal stays open and displays validation errors; provider was not added
    expect(group.value.providers).toHaveLength(2);
    expect(w.find('.advanced-section').attributes('data-open')).toBe('true');
    const errors = w.findAll('.field-error').map((el) => el.text());
    expect(errors).toContain(
      'config.notification_set.telegram_error_thread_id'
    );
    expect(errors).toContain(
      'config.notification_set.telegram_error_reserved_keys:chat_id'
    );

    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await testBtn.trigger('click');
    await flushPromises();
    expect(api.testProviderConfig).not.toHaveBeenCalled();
  });

  it('should add and test a new Telegram draft without saved_provider_index, preserving explicit false and null defaults', async () => {
    const w = mountPage();
    const addBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.add_provider')!;
    await addBtn.trigger('click');
    await flushPromises();

    await w
      .find('[data-field="telegram-token"]')
      .setValue('$TELEGRAM_BOT_TOKEN');
    await w.find('[data-field="telegram-chat-id"]').setValue('-1001234567890');
    await w.find('[data-field="telegram-thread-id"]').setValue('42');
    await w.find('[data-field="telegram-include-poster"]').setValue(false);
    await w.find('[data-field="telegram-parse-mode"]').setValue('MarkdownV2');
    await w
      .find('[data-field="telegram-template"]')
      .setValue('*{{title}}* S{{season}}E{{episode}}');
    await w
      .find('[data-field="telegram-disable-notification"]')
      .setValue('false');
    await w.find('[data-field="telegram-protect-content"]').setValue('default');
    await w
      .find('[data-field="telegram-reply-markup"]')
      .setValue(
        '{"inline_keyboard":[[{"text":"Open","url":"https://library.example.org"}]]}'
      );
    await w
      .find('[data-field="telegram-text-parameters"]')
      .setValue('{"link_preview_options":{"is_disabled":true}}');
    await w
      .find('[data-field="telegram-photo-parameters"]')
      .setValue('{"has_spoiler":true}');

    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await testBtn.trigger('click');
    await flushPromises();

    // New draft: called with 1 argument (no savedProviderIndex)
    expect(api.testProviderConfig).toHaveBeenCalledWith({
      type: 'telegram',
      enabled: true,
      token: '$TELEGRAM_BOT_TOKEN',
      chat_id: '-1001234567890',
      template: '*{{title}}* S{{season}}E{{episode}}',
      telegram: {
        include_poster: false,
        message_thread_id: 42,
        disable_notification: false,
        protect_content: null,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Open', url: 'https://library.example.org' }],
          ],
        },
        text_parameters: { link_preview_options: { is_disabled: true } },
        photo_parameters: { has_spoiler: true },
      },
    });

    const applyBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!;
    await applyBtn.trigger('click');
    await flushPromises();

    expect(group.value.providers).toHaveLength(3);
    const added = group.value.providers[2];
    expect(added.telegram?.include_poster).toBe(false);
    expect(added.telegram?.disable_notification).toBe(false);
    expect(added.telegram?.protect_content).toBeNull();
    expect(w.findAll('.provider-meta').at(-1)?.text()).toBe(
      '-1001234567890 · config.notification_set.telegram_topic_badge:42 · config.notification_set.telegram_text_only_badge'
    );
  });

  it('should preserve original saved_provider_index after removing an earlier provider row', async () => {
    seedSavedProviders([
      { type: 'bark', enabled: true, device_key: '********' },
      {
        type: 'telegram',
        enabled: true,
        token: '********',
        chat_id: '-1001',
        telegram: {
          include_poster: true,
          message_thread_id: 1,
          disable_notification: null,
          protect_content: null,
          parse_mode: null,
          reply_markup: null,
          text_parameters: {},
          photo_parameters: {},
        },
      },
    ]);

    const w = mountPage();
    // Remove row 0 (bark), shifting telegram from index 1 -> 0
    await w
      .findAll('[aria-label="config.notification_set.remove"]')[0]
      .trigger('click');
    await flushPromises();

    expect(group.value.providers).toHaveLength(1);

    // Edit shifted telegram row (draft index 0, original saved index 1) and test
    await w
      .find('[aria-label="config.notification_set.edit"]')
      .trigger('click');
    await flushPromises();
    await w.find('[data-field="telegram-thread-id"]').setValue('88');
    const testBtn = w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!;
    await testBtn.trigger('click');
    await flushPromises();

    expect(api.testProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        token: '********',
        telegram: expect.objectContaining({ message_thread_id: 88 }),
      }),
      { savedProviderIndex: 1 }
    );
  });

  it('should preserve a large integer already stored on bot A when editing bot B or unrelated fields on bot A', async () => {
    const loadedProviders = parseJsonPreservingNumbers(
      '[{"type":"telegram","enabled":true,"token":"********","chat_id":"-100A","telegram":{"include_poster":true,"message_thread_id":42,"disable_notification":null,"protect_content":null,"parse_mode":null,"reply_markup":null,"text_parameters":{"future_number":9007199254740993},"photo_parameters":{}}},{"type":"telegram","enabled":true,"token":"********","chat_id":"-100B","telegram":{"include_poster":true,"message_thread_id":73,"disable_notification":null,"protect_content":null,"parse_mode":null,"reply_markup":null,"text_parameters":{},"photo_parameters":{}}}]'
    ) as NotificationProviderConfig[];
    seedSavedProviders(loadedProviders);

    const w = mountPage();
    // Edit only bot B's topic (73 -> 88) and apply
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[1]
      .trigger('click');
    await flushPromises();
    await w.find('[data-field="telegram-thread-id"]').setValue('88');
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    // Bot A's stored large integer stays intact for serialization
    const serializedAfterBotBEdit = stringifyJsonPreservingNumbers(
      group.value.providers
    )!;
    expect(serializedAfterBotBEdit).toContain(
      '"future_number":9007199254740993'
    );
    expect(serializedAfterBotBEdit).not.toContain('9007199254740992');

    // Opening bot A shows the exact 9007199254740993 and preserves it across an unrelated topic edit + test + apply
    await w
      .findAll('[aria-label="config.notification_set.edit"]')[0]
      .trigger('click');
    await flushPromises();
    expect(
      (
        w.find('[data-field="telegram-text-parameters"]')
          .element as HTMLTextAreaElement
      ).value
    ).toContain('"future_number": 9007199254740993');

    await w.find('[data-field="telegram-thread-id"]').setValue('55');
    await w
      .findAll('button')
      .find((b) => b.text() === 'config.notification_set.test')!
      .trigger('click');
    await flushPromises();

    const testedPayload = api.testProviderConfig.mock.calls[0]?.[0];
    expect(stringifyJsonPreservingNumbers(testedPayload)).toContain(
      '"future_number":9007199254740993'
    );

    await w
      .findAll('button')
      .find((b) => b.text() === 'config.apply')!
      .trigger('click');
    await flushPromises();

    expect(stringifyJsonPreservingNumbers(group.value.providers[0])).toContain(
      '"future_number":9007199254740993'
    );
  });
});
