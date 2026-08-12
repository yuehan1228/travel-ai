type WechatJsonValue =
  string | number | boolean | null | WechatJsonValue[] | { [key: string]: WechatJsonValue };

type WechatRequestData = WechatJsonValue | ArrayBuffer | object;

interface WechatRequestResponse {
  statusCode: number;
  data: unknown;
  header?: Record<string, string>;
}

interface WechatRequestFailure {
  errMsg: string;
}

interface WechatRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: WechatRequestData;
  header?: Record<string, string>;
  timeout?: number;
  success?: (response: WechatRequestResponse) => void;
  fail?: (failure: WechatRequestFailure) => void;
}

interface WechatRequestTask {
  abort(): void;
}

interface WechatNavigateToOptions {
  url: string;
  success?: () => void;
  fail?: (failure: WechatRequestFailure) => void;
}

interface WechatShowModalOptions {
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  success?: (response: { confirm: boolean; cancel: boolean }) => void;
  fail?: (failure: WechatRequestFailure) => void;
}

type WxRequestFunction = (options: WechatRequestOptions) => WechatRequestTask;

interface WechatLoginSuccess {
  code: string;
}

interface WechatLoginOptions {
  success?: (response: WechatLoginSuccess) => void;
  fail?: (failure: WechatRequestFailure) => void;
}

type WxLoginFunction = (options: WechatLoginOptions) => void;

declare namespace wx {
  function request(options: WechatRequestOptions): WechatRequestTask;
  function login(options: WechatLoginOptions): void;
  function navigateTo(options: WechatNavigateToOptions): void;
  function showModal(options: WechatShowModalOptions): void;
  function getStorageSync(key: string): string | undefined;
  function setStorageSync(key: string, value: string): void;
  function removeStorageSync(key: string): void;
}

interface AppOptions<TGlobalData extends object> {
  globalData: TGlobalData;
}

interface PageInstance<TData extends object> {
  data: TData;
  setData(data: Partial<TData>): void;
}

interface PageOptions<TData extends object> {
  data: TData;
}

declare function App<TGlobalData extends object>(options: AppOptions<TGlobalData>): void;

declare function Page<TData extends object>(
  options: PageOptions<TData> & Record<string, unknown>,
): void;

declare function getApp<TGlobalData extends object>(): { globalData: TGlobalData };
