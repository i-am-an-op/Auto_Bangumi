<script lang="ts" setup>
import {
  Bell,
  BellRing,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Smartphone,
  Trash2,
  Webhook,
} from '@lucide/vue';
import { toRaw } from 'vue';
import type { Component } from 'vue';
import { NSelect } from 'naive-ui';
import FieldTextarea from './field-textarea.vue';
import { useConfirm } from '@/hooks/useConfirm';
import type {
  NotificationProviderConfig,
  NotificationType,
  TelegramSettings,
} from '#/config';
import type { TupleToUnion } from '#/utils';
import { apiNotification } from '@/api/notification';
import { usePluginProviders } from '@/hooks/usePluginProviders';
import {
  TELEGRAM_PARSE_MODES,
  applyTelegramDraftToProvider,
  buildTelegramSettings,
  cloneProviderConfig,
  createTelegramDraft,
  isTelegramProvider,
} from '@/utils/telegram-notification';
import type {
  TelegramDraftForm,
  TelegramDraftValidationErrors,
  TelegramJsonFieldSnapshots,
  TelegramParseModeChoice,
  TelegramValidationError,
  TriStateValue,
} from '@/utils/telegram-notification';

const { t, returnUserLangText } = useMyI18n();
const { confirm } = useConfirm();
const configStore = useConfigStore();
const { getSettingGroup } = configStore;

const notificationRef = getSettingGroup('notification');

// Provider types with display names
const builtinProviderTypes: {
  value: TupleToUnion<NotificationType> | (string & {});
  label: string;
}[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'bark', label: 'Bark' },
  { value: 'server-chan', label: 'Server Chan' },
  { value: 'wecom', label: 'WeChat Work' },
  { value: 'gotify', label: 'Gotify' },
  { value: 'pushover', label: 'Pushover' },
  { value: 'webhook', label: 'Webhook' },
];
const pluginProviders = usePluginProviders();
// 插件提供的渠道追加在内置渠道之后；其凭据在插件自己的配置里填写
const providerTypes = computed(() => [
  ...builtinProviderTypes,
  ...pluginProviders.value.notifier.map((id) => ({
    value: id,
    label: t('config.notification_set.plugin_label', { id }),
  })),
]);

// Provider field configurations
const providerFields: Record<
  string,
  {
    key: keyof NotificationProviderConfig;
    label: string | (() => string);
    placeholder: string;
    // 有选项时渲染为可清空的下拉框
    options?: string[];
  }[]
> = {
  telegram: [
    { key: 'token', label: 'Bot Token', placeholder: 'bot token' },
    { key: 'chat_id', label: 'Chat ID', placeholder: 'chat id' },
  ],
  discord: [
    {
      key: 'webhook_url',
      label: 'Webhook URL',
      placeholder: 'https://discord.com/api/webhooks/...',
    },
  ],
  bark: [
    {
      key: 'device_key',
      label: () => t('config.notification_set.device_key'),
      placeholder: 'device key',
    },
    {
      key: 'server_url',
      label: () => t('config.notification_set.server_url_optional'),
      placeholder: 'https://api.day.app',
    },
    {
      key: 'sound',
      label: () => t('config.notification_set.bark_sound'),
      placeholder: 'minuet',
    },
    {
      key: 'group',
      label: () => t('config.notification_set.bark_group'),
      placeholder: 'AutoBangumi',
    },
    {
      key: 'level',
      label: () => t('config.notification_set.bark_level'),
      placeholder: 'active',
      options: ['active', 'timeSensitive', 'passive', 'critical'],
    },
    {
      key: 'icon',
      label: () => t('config.notification_set.bark_icon'),
      placeholder: 'https://example.com/icon.png',
    },
    {
      key: 'url',
      label: () => t('config.notification_set.bark_url'),
      placeholder: 'https://example.com',
    },
  ],
  'server-chan': [{ key: 'token', label: 'SendKey', placeholder: 'sendkey' }],
  wecom: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'webhook url' },
    { key: 'token', label: 'Key', placeholder: 'key' },
  ],
  gotify: [
    {
      key: 'server_url',
      label: () => t('config.notification_set.server_url'),
      placeholder: 'https://gotify.example.com',
    },
    { key: 'token', label: 'App Token', placeholder: 'app token' },
  ],
  pushover: [
    { key: 'user_key', label: 'User Key', placeholder: 'user key' },
    { key: 'api_token', label: 'API Token', placeholder: 'api token' },
  ],
  webhook: [
    {
      key: 'url',
      label: 'Webhook URL',
      placeholder: 'https://example.com/webhook',
    },
    {
      key: 'template',
      label: () => t('config.notification_set.template'),
      placeholder: '{"title": "{{title}}", "episode": {{episode}}}',
    },
  ],
};

function normalizeProviderType(type: string): string {
  if (isTelegramProvider({ type })) return 'telegram';
  const lower = type.toLowerCase();
  return lower in providerFields ? lower : type;
}

const TELEGRAM_TEMPLATE_PLACEHOLDERS =
  '{{title}}, {{season}}, {{episode}}, {{poster_url}}';

const telegramParseModeOptions = computed(() => [
  {
    label: t('config.notification_set.telegram_parse_mode_plain'),
    value: 'none',
  },
  { label: 'HTML', value: 'HTML' },
  { label: 'MarkdownV2', value: 'MarkdownV2' },
  { label: 'Markdown', value: 'Markdown' },
]);

const telegramDisableNotificationOptions = computed(() => [
  {
    label: t('config.notification_set.telegram_disable_notification_default'),
    value: 'default',
  },
  {
    label: t('config.notification_set.telegram_disable_notification_silent'),
    value: 'true',
  },
  {
    label: t('config.notification_set.telegram_disable_notification_sound'),
    value: 'false',
  },
]);

const telegramProtectContentOptions = computed(() => [
  {
    label: t('config.notification_set.telegram_protect_content_default'),
    value: 'default',
  },
  {
    label: t('config.notification_set.telegram_protect_content_on'),
    value: 'true',
  },
  {
    label: t('config.notification_set.telegram_protect_content_off'),
    value: 'false',
  },
]);

// Dialog state
const showDialog = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');
const editingIndex = ref(-1);
const editingOriginalRow = ref<NotificationProviderConfig | null>(null);
const editingHadTelegram = ref(false);
const editingHadTemplate = ref(false);
const showTelegramAdvanced = ref(false);
const newProvider = ref<NotificationProviderConfig>({
  type: 'telegram',
  enabled: true,
});

const initialTelegramState = createTelegramDraft();
const telegramDraft = ref<TelegramDraftForm>(initialTelegramState.draft);
const telegramSnapshots = ref<TelegramJsonFieldSnapshots>(
  initialTelegramState.snapshots
);
const telegramErrors = ref<TelegramDraftValidationErrors>({});

// Testing state：列表与对话框各用一份结果与代际序号，互不串扰且忽略过时响应
interface TestResult {
  success: boolean;
  message: string;
}
let listTestSeq = 0;
let dialogTestSeq = 0;
const testingIndex = ref(-1);
const dialogTesting = ref(false);
const listResult = ref<TestResult | null>(null);
const dialogResult = ref<TestResult | null>(null);

function invalidateListTest() {
  listTestSeq += 1;
  testingIndex.value = -1;
  listResult.value = null;
}

function invalidateDialogTest() {
  dialogTestSeq += 1;
  dialogTesting.value = false;
  dialogResult.value = null;
}

// 对话框打开或关闭都清掉上一次的测试结果并作废在途响应
watch(
  showDialog,
  (open) => {
    invalidateDialogTest();
    if (!open) {
      telegramErrors.value = {};
    }
  },
  { flush: 'sync' }
);

// 弹窗内任意字段被编辑时清掉过期的测试反馈并作废在途请求
watch(
  [newProvider, telegramDraft],
  () => {
    if (showDialog.value) {
      invalidateDialogTest();
    }
  },
  { deep: true, flush: 'sync' }
);

const normalizedProviderType = computed(() =>
  normalizeProviderType(newProvider.value.type)
);
// 插件提供的渠道没有内置字段，凭据在插件自己的配置里填写
const isPluginType = computed(
  () => !(normalizedProviderType.value in providerFields)
);
const isTelegramType = computed(() => isTelegramProvider(newProvider.value));

// Computed properties to access notification settings
const notificationEnabled = computed({
  get: () => notificationRef.value.enable,
  set: (val) => {
    notificationRef.value.enable = val;
    if (!val) invalidateListTest();
  },
});

const providers = computed({
  get: () => notificationRef.value.providers || [],
  set: (val) => {
    notificationRef.value.providers = val;
  },
});

// Initialize providers array if not exists
if (!notificationRef.value.providers) {
  notificationRef.value.providers = [];
}

// 优先从 Pinia configStore 读取/延续行身份，确保搜索隐藏重挂后不丢失原始已保存下标；
// 仅在精简的单元测试 mock 未提供 store 方法时退化为组件内 WeakMap。
const hasStoreRowIdentity =
  typeof configStore.getNotificationProviderSavedIndex === 'function' &&
  typeof configStore.copyNotificationProviderIdentity === 'function';
const fallbackSavedIndices = new WeakMap<object, number>();

function getSavedIndex(
  provider: NotificationProviderConfig
): number | undefined {
  if (hasStoreRowIdentity) {
    return configStore.getNotificationProviderSavedIndex(provider);
  }
  return fallbackSavedIndices.get(toRaw(provider));
}

function copySavedIdentity(
  from: NotificationProviderConfig | null,
  to: NotificationProviderConfig
) {
  if (!from) return;
  if (hasStoreRowIdentity) {
    configStore.copyNotificationProviderIdentity(from, to);
    return;
  }
  const idx = fallbackSavedIndices.get(toRaw(from));
  if (idx === undefined) {
    fallbackSavedIndices.delete(toRaw(to));
  } else {
    fallbackSavedIndices.set(toRaw(to), idx);
  }
}

if (!hasStoreRowIdentity) {
  watch(
    () => configStore.savedConfig.notification?.providers,
    () => {
      const savedList = configStore.savedConfig.notification?.providers ?? [];
      providers.value.forEach((provider, index) => {
        const saved = savedList[index];
        const raw = toRaw(provider);
        if (
          saved !== undefined &&
          JSON.stringify(saved) === JSON.stringify(provider)
        ) {
          fallbackSavedIndices.set(raw, index);
        } else {
          fallbackSavedIndices.delete(raw);
        }
      });
    },
    { immediate: true }
  );
}

function getProviderLabel(type: string): string {
  const normalized = normalizeProviderType(type);
  return providerTypes.value.find((p) => p.value === normalized)?.label || type;
}

function getProviderMeta(provider: NotificationProviderConfig): string {
  if (!isTelegramProvider(provider)) return '';
  const parts: string[] = [];
  const chatId = provider.chat_id?.trim();
  if (chatId) parts.push(chatId);
  const threadId = provider.telegram?.message_thread_id;
  if (threadId !== null && threadId !== undefined) {
    parts.push(
      t('config.notification_set.telegram_topic_badge', { id: threadId })
    );
  }
  if (provider.telegram?.include_poster === false) {
    parts.push(t('config.notification_set.telegram_text_only_badge'));
  }
  return parts.join(' · ');
}

// 品牌图标走 simple-icons，其余类型用 Lucide，未知（插件）类型回落到 Bell
const brandIcons: Record<string, string> = {
  telegram: 'i-simple-icons-telegram',
  discord: 'i-simple-icons-discord',
  'server-chan': 'i-simple-icons-wechat',
  wecom: 'i-simple-icons-wechat',
};
const lucideIcons: Record<string, Component> = {
  bark: Bell,
  gotify: BellRing,
  pushover: Smartphone,
  webhook: Webhook,
};

function getBrandIcon(type: string): string | undefined {
  return brandIcons[normalizeProviderType(type)];
}

function getLucideIcon(type: string): Component {
  return lucideIcons[normalizeProviderType(type)] ?? Bell;
}

function resetTelegramDraft(settings?: TelegramSettings | null) {
  const state = createTelegramDraft(settings);
  telegramDraft.value = state.draft;
  telegramSnapshots.value = state.snapshots;
  telegramErrors.value = {};
  showTelegramAdvanced.value = state.hasAdvancedValues;
}

function clearTelegramError(field: keyof TelegramDraftValidationErrors) {
  if (telegramErrors.value[field]) {
    const next = { ...telegramErrors.value };
    delete next[field];
    telegramErrors.value = next;
  }
}

function formatTelegramError(error?: TelegramValidationError): string {
  if (!error) return '';
  switch (error.code) {
    case 'invalid_thread_id':
      return t('config.notification_set.telegram_error_thread_id');
    case 'invalid_json':
      return t('config.notification_set.telegram_error_invalid_json');
    case 'expected_json_object':
      return t('config.notification_set.telegram_error_json_object');
    case 'unrepresentable_number':
      return t(
        'config.notification_set.telegram_error_unrepresentable_number',
        { value: error.value }
      );
    case 'reserved_keys':
      return t('config.notification_set.telegram_error_reserved_keys', {
        keys: error.keys.join(', '),
      });
  }
}

function onTelegramThreadIdUpdate(val: string | number) {
  telegramDraft.value.message_thread_id = String(val);
  clearTelegramError('message_thread_id');
}

function onTelegramParseModeUpdate(val: string | number | null) {
  if (
    typeof val === 'string' &&
    (TELEGRAM_PARSE_MODES as readonly string[]).includes(val)
  ) {
    telegramDraft.value.parse_mode = val as TelegramParseModeChoice;
  } else {
    telegramDraft.value.parse_mode = 'none';
  }
}

function onTelegramTriStateUpdate(
  field: 'disable_notification' | 'protect_content',
  val: string | number | null
) {
  const normalized: TriStateValue =
    val === 'true' || val === 'false' ? val : 'default';
  telegramDraft.value[field] = normalized;
}

function onTelegramJsonUpdate(
  field: 'reply_markup' | 'text_parameters' | 'photo_parameters',
  value: string
) {
  if (field === 'reply_markup') {
    telegramDraft.value.reply_markup_text = value;
  } else if (field === 'text_parameters') {
    telegramDraft.value.text_parameters_text = value;
  } else {
    telegramDraft.value.photo_parameters_text = value;
  }
  clearTelegramError(field);
}

function openAddDialog() {
  dialogMode.value = 'add';
  editingIndex.value = -1;
  editingOriginalRow.value = null;
  editingHadTelegram.value = false;
  editingHadTemplate.value = false;
  newProvider.value = {
    type: 'telegram',
    enabled: true,
  };
  resetTelegramDraft();
  invalidateDialogTest();
  showDialog.value = true;
}

// 新增时切换类型：清掉上一类型的字段。Bark 也读 url（点击跳转），
// 残留的 Webhook URL 会被一起发出去
function changeType(type: NotificationProviderConfig['type']) {
  newProvider.value = { type, enabled: newProvider.value.enabled };
  resetTelegramDraft();
  invalidateDialogTest();
}

function openEditDialog(index: number) {
  const existing = providers.value[index];
  dialogMode.value = 'edit';
  editingIndex.value = index;
  editingOriginalRow.value = existing;
  editingHadTelegram.value = existing.telegram !== undefined;
  editingHadTemplate.value = 'template' in existing;
  newProvider.value = cloneProviderConfig(existing);
  resetTelegramDraft(existing.telegram);
  invalidateDialogTest();
  showDialog.value = true;
}

function buildDialogProvider(): NotificationProviderConfig | null {
  if (!isTelegramType.value) {
    return cloneProviderConfig(newProvider.value);
  }
  const built = buildTelegramSettings(
    telegramDraft.value,
    telegramSnapshots.value
  );
  if (!built.ok) {
    telegramErrors.value = built.errors;
    if (
      built.errors.reply_markup ||
      built.errors.text_parameters ||
      built.errors.photo_parameters
    ) {
      showTelegramAdvanced.value = true;
    }
    return null;
  }
  telegramErrors.value = {};
  return applyTelegramDraftToProvider(newProvider.value, built.value, {
    hadTelegram: editingHadTelegram.value,
    hadTemplate: editingHadTemplate.value,
    isNew: dialogMode.value === 'add',
  });
}

function submitDialog() {
  const payload = buildDialogProvider();
  if (!payload) return;
  invalidateListTest();
  if (dialogMode.value === 'add') {
    providers.value = [...providers.value, payload];
  } else if (editingIndex.value >= 0) {
    copySavedIdentity(editingOriginalRow.value, payload);
    const nextProviders = [...providers.value];
    nextProviders[editingIndex.value] = payload;
    providers.value = nextProviders;
  }
  showDialog.value = false;
  editingIndex.value = -1;
  editingOriginalRow.value = null;
}

async function onRemoveProvider(index: number) {
  const ok = await confirm({
    title: t('config.notification_set.remove'),
    body: t('config.notification_set.remove_confirm'),
    confirmText: t('config.notification_set.remove'),
    danger: true,
  });
  if (ok) removeProvider(index);
}

function removeProvider(index: number) {
  invalidateListTest();
  const newProviders = providers.value.filter((_, i) => i !== index);
  providers.value = newProviders;
}

function toggleProvider(index: number) {
  invalidateListTest();
  const current = providers.value[index];
  const updated = {
    ...cloneProviderConfig(current),
    enabled: !current.enabled,
  };
  copySavedIdentity(current, updated);
  const newProviders = [...providers.value];
  newProviders[index] = updated;
  providers.value = newProviders;
}

function formatApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const apiErr = err as {
      msg_en?: string;
      msg_zh?: string;
      detail?: string;
      message?: string;
    };
    const localized = returnUserLangText({
      en: apiErr.msg_en ?? '',
      'zh-CN': apiErr.msg_zh ?? '',
    });
    if (localized) return localized;
    if (typeof apiErr.detail === 'string' && apiErr.detail.trim()) {
      return apiErr.detail.trim();
    }
    if (typeof apiErr.message === 'string' && apiErr.message.trim()) {
      return apiErr.message.trim();
    }
  }
  return t('config.notification_set.test_failed');
}

async function runTest(
  request: () => ReturnType<typeof apiNotification.testProvider>
): Promise<TestResult> {
  try {
    const response = await request();
    const message =
      returnUserLangText({
        en: response.data.message_en,
        'zh-CN': response.data.message_zh,
      }) || response.data.message;
    return {
      success: response.data.success,
      message:
        message ||
        (response.data.success
          ? t('config.notification_set.test_success')
          : t('config.notification_set.test_failed')),
    };
  } catch (err) {
    return {
      success: false,
      message: formatApiError(err),
    };
  }
}

function requestProviderTest(
  provider: NotificationProviderConfig,
  savedIndex: number | undefined
) {
  const saved =
    savedIndex !== undefined
      ? configStore.savedConfig.notification.providers?.[savedIndex]
      : undefined;
  const unchanged =
    savedIndex !== undefined &&
    saved !== undefined &&
    JSON.stringify(saved) === JSON.stringify(provider);
  if (unchanged) {
    return apiNotification.testProvider({ provider_index: savedIndex });
  }
  if (
    savedIndex !== undefined &&
    isTelegramProvider(provider) &&
    isTelegramProvider(saved)
  ) {
    return apiNotification.testProviderConfig(provider, {
      savedProviderIndex: savedIndex,
    });
  }
  return apiNotification.testProviderConfig(provider);
}

// 已保存且未改动的行按原始保存下标走 /notification/test；
// 已编辑的 Telegram 已保存行携带 saved_provider_index 还原掩码凭据；
// 其余未保存或非 Telegram 的修改行直接走 /notification/test-config。
async function testProvider(index: number) {
  const seq = ++listTestSeq;
  testingIndex.value = index;
  listResult.value = null;
  const provider = providers.value[index];
  const savedIndex = getSavedIndex(provider);
  const result = await runTest(() => requestProviderTest(provider, savedIndex));
  if (seq !== listTestSeq) return;
  listResult.value = {
    ...result,
    message: `${getProviderLabel(provider.type)}: ${result.message}`,
  };
  testingIndex.value = -1;
}

async function testDialogProvider() {
  const payload = buildDialogProvider();
  if (!payload) return;
  const seq = ++dialogTestSeq;
  dialogTesting.value = true;
  dialogResult.value = null;
  const savedIndex =
    dialogMode.value === 'edit' && editingOriginalRow.value
      ? getSavedIndex(editingOriginalRow.value)
      : undefined;
  const result = await runTest(() => requestProviderTest(payload, savedIndex));
  if (seq !== dialogTestSeq || !showDialog.value) return;
  dialogResult.value = result;
  dialogTesting.value = false;
}

function getFieldsForType(type: string) {
  return providerFields[normalizeProviderType(type)] || [];
}
</script>

<template>
  <ab-fold-panel :title="$t('config.notification_set.title')">
    <div class="space-y-8">
      <!-- Global enable switch -->
      <ab-setting
        v-model:data="notificationEnabled"
        config-key="enable"
        :label="() => t('config.notification_set.enable')"
        type="switch"
        bottom-line
      />

      <!-- Provider list -->
      <div v-if="notificationEnabled" class="space-y-8">
        <div
          v-for="(provider, index) in providers"
          :key="index"
          class="provider-item"
          :class="{ 'provider-disabled': !provider.enabled }"
        >
          <div class="provider-info">
            <div class="provider-name">
              <div
                v-if="getBrandIcon(provider.type)"
                :class="getBrandIcon(provider.type)"
              />
              <component :is="getLucideIcon(provider.type)" v-else :size="16" />
              {{ getProviderLabel(provider.type) }}
              <ab-tag
                v-if="!provider.enabled"
                type="danger"
                :title="$t('config.notification_set.disabled')"
              />
            </div>
            <div v-if="getProviderMeta(provider)" class="provider-meta">
              {{ getProviderMeta(provider) }}
            </div>
          </div>
          <div class="provider-actions">
            <ab-icon-button
              size="sm"
              :disabled="testingIndex === index"
              :label="$t('config.notification_set.test')"
              @click="testProvider(index)"
            >
              <LoaderCircle
                v-if="testingIndex === index"
                :size="16"
                class="animate-spin"
              />
              <Play v-else :size="16" />
            </ab-icon-button>
            <ab-icon-button
              size="sm"
              :label="$t('config.notification_set.edit')"
              @click="openEditDialog(index)"
            >
              <Pencil :size="16" />
            </ab-icon-button>
            <ab-icon-button
              size="sm"
              :label="
                provider.enabled
                  ? $t('config.notification_set.disable')
                  : $t('config.notification_set.enable_provider')
              "
              @click="toggleProvider(index)"
            >
              <component :is="provider.enabled ? Eye : EyeOff" :size="16" />
            </ab-icon-button>
            <ab-icon-button
              size="sm"
              class="provider-remove"
              :label="$t('config.notification_set.remove')"
              @click="onRemoveProvider(index)"
            >
              <Trash2 :size="16" />
            </ab-icon-button>
          </div>
        </div>

        <!-- Test result message -->
        <ab-alert
          v-if="listResult"
          class="test-result"
          :type="listResult.success ? 'info' : 'danger'"
        >
          {{ listResult.message }}
        </ab-alert>

        <div class="line" />

        <!-- Add provider button -->
        <div class="flex justify-end">
          <ab-button size="sm" variant="primary" @click="openAddDialog">
            <Plus :size="16" />
            {{ $t('config.notification_set.add_provider') }}
          </ab-button>
        </div>
      </div>
    </div>

    <!-- Add / Edit Dialog -->
    <ab-modal
      v-model:show="showDialog"
      :size="isTelegramType ? 'md' : 'sm'"
      :mobile-fullscreen="isTelegramType"
      :title="
        dialogMode === 'add'
          ? $t('config.notification_set.add_provider')
          : $t('config.notification_set.edit_provider')
      "
    >
      <div class="space-y-16">
        <ab-field :label="$t('config.notification_set.type')">
          <NSelect
            :value="
              dialogMode === 'edit' ? normalizedProviderType : newProvider.type
            "
            :options="providerTypes"
            :disabled="dialogMode === 'edit'"
            class="provider-type-select"
            @update:value="changeType"
          />
        </ab-field>

        <template v-if="isTelegramType">
          <ab-field
            label="Bot Token"
            :description="t('config.notification_set.telegram_token_hint')"
          >
            <ab-input
              :model-value="newProvider.token ?? ''"
              type="password"
              autocomplete="off"
              placeholder="bot token"
              data-field="telegram-token"
              @update:model-value="(val) => (newProvider.token = String(val))"
            />
          </ab-field>

          <ab-field label="Chat ID">
            <ab-input
              :model-value="newProvider.chat_id ?? ''"
              placeholder="-1001234567890"
              data-field="telegram-chat-id"
              @update:model-value="(val) => (newProvider.chat_id = String(val))"
            />
          </ab-field>

          <ab-field
            :label="t('config.notification_set.telegram_topic_id')"
            :description="t('config.notification_set.telegram_topic_id_hint')"
            :error="formatTelegramError(telegramErrors.message_thread_id)"
          >
            <ab-input
              :model-value="telegramDraft.message_thread_id"
              placeholder="42"
              data-field="telegram-thread-id"
              @update:model-value="onTelegramThreadIdUpdate"
            />
          </ab-field>

          <ab-field
            :label="t('config.notification_set.telegram_include_poster')"
            :description="
              t('config.notification_set.telegram_include_poster_hint')
            "
          >
            <ab-switch
              v-model="telegramDraft.include_poster"
              data-field="telegram-include-poster"
            />
          </ab-field>

          <ab-field
            :label="t('config.notification_set.telegram_parse_mode')"
            :description="t('config.notification_set.telegram_parse_mode_hint')"
          >
            <ab-select
              :model-value="telegramDraft.parse_mode"
              :options="telegramParseModeOptions"
              data-field="telegram-parse-mode"
              @update:model-value="onTelegramParseModeUpdate"
            />
          </ab-field>

          <ab-field
            class="field-stacked"
            :label="t('config.notification_set.telegram_template')"
            :description="
              t('config.notification_set.telegram_template_hint', {
                placeholders: TELEGRAM_TEMPLATE_PLACEHOLDERS,
              })
            "
          >
            <FieldTextarea
              :model-value="newProvider.template ?? ''"
              placeholder="<b>{{title}}</b> · S{{season}}E{{episode}}"
              data-field="telegram-template"
              :rows="3"
              full-width
              @update:model-value="(val) => (newProvider.template = val)"
            />
          </ab-field>

          <ab-field
            :label="t('config.notification_set.telegram_disable_notification')"
            :description="
              t('config.notification_set.telegram_disable_notification_hint')
            "
          >
            <ab-select
              :model-value="telegramDraft.disable_notification"
              :options="telegramDisableNotificationOptions"
              data-field="telegram-disable-notification"
              @update:model-value="
                onTelegramTriStateUpdate('disable_notification', $event)
              "
            />
          </ab-field>

          <ab-field
            :label="t('config.notification_set.telegram_protect_content')"
            :description="
              t('config.notification_set.telegram_protect_content_hint')
            "
          >
            <ab-select
              :model-value="telegramDraft.protect_content"
              :options="telegramProtectContentOptions"
              data-field="telegram-protect-content"
              @update:model-value="
                onTelegramTriStateUpdate('protect_content', $event)
              "
            />
          </ab-field>

          <advanced-section v-model:open="showTelegramAdvanced">
            <ab-field
              class="field-stacked"
              :label="t('config.notification_set.telegram_reply_markup')"
              :description="
                t('config.notification_set.telegram_reply_markup_hint')
              "
              :error="formatTelegramError(telegramErrors.reply_markup)"
            >
              <FieldTextarea
                :model-value="telegramDraft.reply_markup_text"
                placeholder='{"inline_keyboard": [[{"text": "Open", "url": "https://example.org"}]]}'
                data-field="telegram-reply-markup"
                :spellcheck="false"
                :rows="3"
                full-width
                @update:model-value="
                  onTelegramJsonUpdate('reply_markup', $event)
                "
              />
            </ab-field>

            <ab-field
              class="field-stacked"
              :label="t('config.notification_set.telegram_text_parameters')"
              :description="
                t('config.notification_set.telegram_text_parameters_hint')
              "
              :error="formatTelegramError(telegramErrors.text_parameters)"
            >
              <FieldTextarea
                :model-value="telegramDraft.text_parameters_text"
                placeholder='{"link_preview_options": {"is_disabled": true}}'
                data-field="telegram-text-parameters"
                :spellcheck="false"
                :rows="3"
                full-width
                @update:model-value="
                  onTelegramJsonUpdate('text_parameters', $event)
                "
              />
            </ab-field>

            <ab-field
              class="field-stacked"
              :label="t('config.notification_set.telegram_photo_parameters')"
              :description="
                t('config.notification_set.telegram_photo_parameters_hint')
              "
              :error="formatTelegramError(telegramErrors.photo_parameters)"
            >
              <FieldTextarea
                :model-value="telegramDraft.photo_parameters_text"
                placeholder='{"has_spoiler": true}'
                data-field="telegram-photo-parameters"
                :spellcheck="false"
                :rows="3"
                full-width
                @update:model-value="
                  onTelegramJsonUpdate('photo_parameters', $event)
                "
              />
            </ab-field>
          </advanced-section>
        </template>

        <template v-else-if="!isPluginType">
          <ab-field
            v-for="field in getFieldsForType(newProvider.type)"
            :key="field.key"
            :label="field.label"
          >
            <NSelect
              v-if="field.options"
              v-model:value="(newProvider as any)[field.key]"
              :options="field.options.map((value) => ({ label: value, value }))"
              :placeholder="field.placeholder"
              clearable
            />
            <ab-input
              v-else-if="field.key !== 'template'"
              v-model="(newProvider as any)[field.key]"
              :placeholder="field.placeholder"
            />
            <FieldTextarea
              v-else
              :model-value="String((newProvider as any)[field.key] ?? '')"
              :placeholder="field.placeholder"
              :rows="3"
              @update:model-value="
                (val) => ((newProvider as any)[field.key] = val)
              "
            />
          </ab-field>
        </template>

        <p v-if="isPluginType" class="plugin-hint">
          {{ $t('config.notification_set.plugin_hint') }}
        </p>

        <ab-alert
          v-if="dialogResult"
          class="test-result"
          :type="dialogResult.success ? 'info' : 'danger'"
        >
          {{ dialogResult.message }}
        </ab-alert>
      </div>

      <template #footer>
        <ab-button
          v-if="!isPluginType"
          size="sm"
          class="footer-test"
          :disabled="dialogTesting"
          @click="testDialogProvider"
        >
          <LoaderCircle v-if="dialogTesting" :size="16" class="animate-spin" />
          <Play v-else :size="16" />
          {{ $t('config.notification_set.test') }}
        </ab-button>
        <ab-button size="sm" @click="showDialog = false">
          {{ $t('config.cancel') }}
        </ab-button>
        <ab-button size="sm" variant="primary" @click="submitDialog">
          {{ $t('config.apply') }}
        </ab-button>
      </template>
    </ab-modal>
  </ab-fold-panel>
</template>

<style lang="scss" scoped>
.provider-type-select {
  width: 200px;
  max-width: 100%;
}

.provider-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: var(--color-surface-2);
  border-radius: var(--radius-md);
  transition: background-color var(--transition-normal);
}

.provider-info {
  flex: 1;
  min-width: 0;
  transition: opacity var(--transition-normal);

  // 停用只淡化信息区，“重新启用”等操作按钮保持可点的样子
  .provider-disabled & {
    opacity: 0.5;
  }
}

.provider-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--color-text);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  > :first-child {
    flex-shrink: 0;
  }
}

.provider-meta {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

  .provider-remove {
    color: var(--color-danger);

    &:hover:not(:disabled) {
      color: var(--color-danger);
      background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    }
  }
}

.footer-test {
  margin-right: auto;
}

.field-stacked {
  :deep(.ab-field-main) {
    flex-direction: column;
    align-items: stretch;
  }

  :deep(.ab-field-control) {
    width: 100%;
  }

  :deep(.ab-field-error) {
    text-align: left;
  }
}

.plugin-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
