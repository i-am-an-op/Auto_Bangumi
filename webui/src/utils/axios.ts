import Axios from 'axios';
import type {
  AxiosError,
  AxiosRequestTransformer,
  AxiosResponse,
  AxiosResponseTransformer,
} from 'axios';
import { router } from '@/router';
import type { ApiError, ApiErrorResponse, StatusCode } from '#/api';
import {
  hasRawJsonNumberToken,
  parseJsonPreservingNumbers,
  stringifyJsonPreservingNumbers,
} from '@/utils/json-raw-numbers';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * Suppress the interceptor's error toast — the caller surfaces failures
     * itself (background polls, optional data with its own inline state).
     */
    silent?: boolean;
  }
}

const RAW_NUMBER_RESPONSE_PATHS = ['api/v1/config/get'] as const;
const RAW_NUMBER_REQUEST_PATHS = [
  'api/v1/config/update',
  'api/v1/notification/test-config',
] as const;

function matchesApiPath(
  url: string | undefined,
  allowedPaths: readonly string[]
): boolean {
  if (!url) return false;
  const withoutQuery = url.split(/[?#]/, 1)[0];
  let path = withoutQuery;
  if (/^https?:\/\//i.test(withoutQuery)) {
    try {
      path = new URL(withoutQuery).pathname;
    } catch {
      path = withoutQuery;
    }
  }
  const normalized = path.replace(/^\/+/, '');
  return allowedPaths.some(
    (allowed) => normalized === allowed || normalized.endsWith(`/${allowed}`)
  );
}

const rawDefaultRequestTransformers = Axios.defaults?.transformRequest;
const defaultRequestTransformers: AxiosRequestTransformer[] = Array.isArray(
  rawDefaultRequestTransformers
)
  ? rawDefaultRequestTransformers
  : rawDefaultRequestTransformers
    ? [rawDefaultRequestTransformers]
    : [];

const rawDefaultResponseTransformers = Axios.defaults?.transformResponse;
const defaultResponseTransformers: AxiosResponseTransformer[] = Array.isArray(
  rawDefaultResponseTransformers
)
  ? rawDefaultResponseTransformers
  : rawDefaultResponseTransformers
    ? [rawDefaultResponseTransformers]
    : [];

const preserveRawNumbersRequest: AxiosRequestTransformer = function (
  data,
  headers
) {
  const contentType = String(headers?.getContentType?.() || '');
  const isNonJsonContentType =
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data');
  if (
    matchesApiPath(this.url, RAW_NUMBER_REQUEST_PATHS) &&
    !isNonJsonContentType &&
    hasRawJsonNumberToken(data)
  ) {
    headers?.setContentType?.('application/json', false);
    return stringifyJsonPreservingNumbers(data);
  }
  return defaultRequestTransformers.reduce(
    (acc, fn) => fn.call(this, acc, headers),
    data
  );
};

const preserveRawNumbersResponse: AxiosResponseTransformer = function (
  data,
  headers,
  status
) {
  if (
    matchesApiPath(this.url, RAW_NUMBER_RESPONSE_PATHS) &&
    typeof data === 'string' &&
    data.length > 0 &&
    (!this.responseType || this.responseType === 'json')
  ) {
    try {
      return parseJsonPreservingNumbers(data);
    } catch {
      // 非 JSON 响应回退给 Axios 默认转换器原样返回
    }
  }
  return defaultResponseTransformers.reduce(
    (acc, fn) => fn.call(this, acc, headers, status),
    data
  );
};

export const axios = Axios.create({
  withCredentials: true,
  transformRequest: [preserveRawNumbersRequest],
  transformResponse: [preserveRawNumbersResponse],
});

// Throttle repeated identical error toasts (e.g. background polling during a
// backend restart would otherwise fire the same "Network error" toast once
// per failed request and produce a toast storm).
const recentToastAt = new Map<string, number>();
const TOAST_THROTTLE_MS = 4000;

function showErrorThrottled(msg: string) {
  const now = Date.now();
  const last = recentToastAt.get(msg) ?? 0;
  if (now - last < TOAST_THROTTLE_MS) return;
  recentToastAt.set(msg, now);
  useMessage().error(msg);
}

function normalizeFastApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (!Array.isArray(detail)) return '';

  return detail
    .map((issue) => {
      if (typeof issue === 'string') return issue.trim();
      if (!issue || typeof issue !== 'object') return '';

      const candidate = issue as { loc?: unknown; msg?: unknown };
      const message =
        typeof candidate.msg === 'string' ? candidate.msg.trim() : '';
      if (!message) return '';

      const location = Array.isArray(candidate.loc)
        ? candidate.loc
            .filter((part) => part !== 'body')
            .map(String)
            .join('.')
        : '';
      return location ? `${location}: ${message}` : message;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * A 401 means the session is gone — drop the flag and get back to the login
 * page. Skip the redirect when we're already there (a bad-credentials 401 on
 * the login form) so it doesn't fight the login flow.
 */
function handleAuthExpired() {
  const { isLoggedIn } = useAuth();
  isLoggedIn.value = false;
  const cur = router.currentRoute.value;
  if (cur.path !== '/login' && cur.name !== 'Login') {
    router.replace({ name: 'Login' });
  }
}

export function onResponseError(err: AxiosError<ApiErrorResponse>) {
  const status = err.response?.status as StatusCode;
  const responseData = err.response?.data;
  const msg_en =
    typeof responseData?.msg_en === 'string' ? responseData.msg_en : '';
  const msg_zh =
    typeof responseData?.msg_zh === 'string' ? responseData.msg_zh : '';
  const detail = normalizeFastApiDetail(responseData?.detail);

  const { returnUserLangText } = useMyI18n();

  const errorMsg =
    returnUserLangText({
      en: msg_en,
      'zh-CN': msg_zh,
    }) || detail;

  const silent = err.config?.silent === true;

  // Handle network errors (no response from server)
  if (!err.response) {
    // 页面跳转中断的请求（ECONNABORTED）不是网络故障，不弹提示
    if (!silent && err.code !== 'ECONNABORTED') {
      showErrorThrottled(
        returnUserLangText({
          en: 'Network error. Please check your connection.',
          'zh-CN': '网络错误，请检查连接。',
        })
      );
    }
    const error: ApiError = {
      status: 0,
      msg_en: 'Network error',
      msg_zh: '网络错误',
    };
    return Promise.reject(error);
  }

  const error: ApiError = {
    status,
    msg_en,
    msg_zh,
    ...(detail ? { detail } : {}),
  };

  if (silent) {
    // Still handle the auth side effect (logout + redirect), but no toast.
    if (status === 401) handleAuthExpired();
    return Promise.reject(error);
  }

  switch (status) {
    /** token 过期 - only logout on auth errors */
    case 401:
      handleAuthExpired();
      showErrorThrottled(
        errorMsg ||
          returnUserLangText({
            en: 'Authentication failed. Please check your credentials or sign in again.',
            'zh-CN': '身份验证失败，请检查凭据或重新登录。',
          })
      );
      break;
    /** 执行失败 */
    case 406:
      if (errorMsg) showErrorThrottled(errorMsg);
      break;
    /** 服务器错误 - don't logout, just show error */
    case 500:
      showErrorThrottled(
        errorMsg ||
          returnUserLangText({
            en: 'Server error. Please try again later.',
            'zh-CN': '服务器错误，请稍后重试。',
          })
      );
      break;
    /**
     * Anything else (400/404/422/...) - still surface it instead of
     * failing silently
     */
    default:
      showErrorThrottled(
        errorMsg ||
          returnUserLangText({
            en: 'Request failed. Please try again.',
            'zh-CN': '请求失败，请重试。',
          })
      );
      break;
  }

  return Promise.reject(error);
}

axios.interceptors.response.use((res: AxiosResponse) => res, onResponseError);
