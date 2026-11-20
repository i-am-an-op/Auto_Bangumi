import { toRaw } from 'vue';
import type { Config, NotificationProviderConfig } from '#/config';
import { initConfig } from '#/config';
import { dirtyConfigGroups } from '@/utils/config-diff';

function cloneConfig(value: Config): Config {
  return JSON.parse(JSON.stringify(value));
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<Config>(cloneConfig(initConfig));
  // 最近一次从服务端加载/成功保存的快照，用于脏值比对
  const savedConfig = ref<Config>(cloneConfig(initConfig));
  const lastSaveError = ref<unknown>(null);

  // 为每条通知渠道行绑定稳定的客户端身份，在设置页搜索卸载/重挂、列表删除/重排
  // 或保存期间并发编辑时保留它对应的服务端已保存下标。
  const providerRowIds = new WeakMap<object, symbol>();
  const savedIndexByProviderRowId = new Map<symbol, number>();

  function ensureProviderRowId(provider: NotificationProviderConfig): symbol {
    const raw = toRaw(provider);
    let id = providerRowIds.get(raw);
    if (!id) {
      id = Symbol('notification-provider');
      providerRowIds.set(raw, id);
    }
    return id;
  }

  function resetNotificationProviderSavedIndices(
    rows: NotificationProviderConfig[] | undefined
  ) {
    savedIndexByProviderRowId.clear();
    (rows ?? []).forEach((row, index) => {
      const id = Symbol('notification-provider');
      providerRowIds.set(toRaw(row), id);
      savedIndexByProviderRowId.set(id, index);
    });
  }

  function commitNotificationProviderSavedIndices(submittedRowIds: symbol[]) {
    savedIndexByProviderRowId.clear();
    submittedRowIds.forEach((id, index) => {
      savedIndexByProviderRowId.set(id, index);
    });
  }

  function getNotificationProviderSavedIndex(
    provider: NotificationProviderConfig
  ): number | undefined {
    const id = providerRowIds.get(toRaw(provider));
    return id ? savedIndexByProviderRowId.get(id) : undefined;
  }

  function copyNotificationProviderIdentity(
    from: NotificationProviderConfig,
    to: NotificationProviderConfig
  ) {
    const id = ensureProviderRowId(from);
    providerRowIds.set(toRaw(to), id);
  }

  const dirtyGroups = computed(() =>
    dirtyConfigGroups(savedConfig.value, config.value)
  );
  const isDirty = computed(() => dirtyGroups.value.length > 0);

  function snapshot(source: Config = config.value) {
    savedConfig.value = cloneConfig(source);
  }

  async function getConfig() {
    const res = await apiConfig.getConfig();
    config.value = res;
    snapshot(res);
    resetNotificationProviderSavedIndices(config.value.notification?.providers);
  }

  const { execute: set } = useApi(apiConfig.updateConfig, {
    showMessage: true,
    onSuccess() {
      // 保存 config 后重启，以应用最新配置
      const { restart } = useProgramStore();
      restart();
    },
  });

  const setConfig = async () => {
    // 快照本次真正提交给服务端的配置与通知行身份：请求在途期间用户如果继续
    // 编辑/删行，成功后只把已提交的那一份标为已保存，避免未提交的改动被吞掉。
    const submitted = cloneConfig(config.value);
    const submittedRowIds = (config.value.notification?.providers ?? []).map(
      ensureProviderRowId
    );
    const result = await set(submitted);
    lastSaveError.value = result.ok ? null : result.error;
    if (result.ok) {
      snapshot(submitted);
      commitNotificationProviderSavedIndices(submittedRowIds);
    }
    return result;
  };

  /**
   * 某个配置段在别处（如插件卡片走 /plugins 接口）被直接保存后，用服务端的值
   * 同时刷新编辑态与快照，避免之后的全局保存用旧值把它覆盖回去。
   * 只刷新 ``fields``，段内其它未保存的修改（如下载器实例）保留。
   */
  async function refreshGroup<Tkey extends keyof Config>(
    key: Tkey,
    fields: (keyof Config[Tkey])[]
  ) {
    const res = await apiConfig.getConfig();
    for (const field of fields) {
      config.value[key][field] = res[key][field];
      savedConfig.value[key][field] = JSON.parse(
        JSON.stringify(res[key][field])
      );
      if (key === 'notification' && field === 'providers') {
        resetNotificationProviderSavedIndices(
          config.value.notification?.providers
        );
      }
    }
  }

  function getSettingGroup<Tkey extends keyof Config>(key: Tkey) {
    return computed<Config[Tkey]>({
      get() {
        return config.value[key];
      },
      set(newVal) {
        config.value[key] = newVal;
      },
    });
  }

  return {
    config,
    savedConfig,
    lastSaveError,
    dirtyGroups,
    isDirty,
    getConfig,
    setConfig,
    getSettingGroup,
    refreshGroup,
    getNotificationProviderSavedIndex,
    copyNotificationProviderIdentity,
  };
});
