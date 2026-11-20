<script lang="ts" setup>
import { computed, inject } from 'vue';
import { abFieldInjectionKey } from '@/components/basic/ab-field.vue';

// 多行文本输入：消费 ab-field 注入的 id/describedby/invalid，确保 <label for>、
// 描述文本与校验错误和 textarea 正确关联。
const {
  placeholder = '',
  rows = 3,
  disabled = false,
  error = false,
  spellcheck,
  fullWidth = false,
} = defineProps<{
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  error?: boolean;
  spellcheck?: boolean;
  fullWidth?: boolean;
}>();

const model = defineModel<string>({ default: '' });

const field = inject(abFieldInjectionKey, null);
if (field) field.adopted.value = true;

const invalid = computed(() => error || field?.invalid.value === true);

function onInput(event: Event) {
  model.value = (event.target as HTMLTextAreaElement).value;
}
</script>

<template>
  <textarea
    :id="field?.controlId"
    :value="model"
    :placeholder="placeholder"
    :rows="rows"
    :disabled="disabled"
    :spellcheck="spellcheck"
    :aria-describedby="field?.describedBy.value"
    :aria-invalid="invalid || undefined"
    class="field-textarea"
    :class="{
      'field-textarea--full': fullWidth,
      'field-textarea--error': invalid,
    }"
    @input="onInput"
  />
</template>

<style lang="scss" scoped>
.field-textarea {
  // Soft Ink 填充式多行输入（ab-input 组件暂不支持 textarea）
  width: 100%;
  padding: 8px 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text);
  outline: none;
  resize: none;
  font-family: var(--font-mono);
  font-size: 13px;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);

  &:focus {
    background: var(--color-surface);
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-alpha);
  }

  @include forTablet {
    width: 220px;
  }

  &--full {
    resize: vertical;

    @include forTablet {
      width: 100%;
    }
  }

  &--error {
    border-color: var(--color-danger);

    &:focus {
      border-color: var(--color-danger);
      box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--color-danger) 20%, transparent);
    }
  }
}
</style>
