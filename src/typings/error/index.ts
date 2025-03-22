import { UniverseError } from '@/lib/error';

/**
 * 错误类型选项枚举
 */
export enum UniverseErrorOptionsType {
  BAD_GETWAY = 'BAD_GETWAY', // 网关错误
  SERVICE_NOT_FOUND = 'SERVICE_NOT_FOUND', // 未发现对应服务错误
  SERVICE_NOT_AVAILABLE = 'SERVICE_NOT_AVAILABLE', // 服务不可用错误
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT', // 服务请求超时
  REQUEST_SKIPPED = 'REQUEST_SKIPPED', // 服务请求完成前超时
  REQUEST_REJECTED = 'REQUEST_REJECTED', // 服务请求被拒绝
  QUEUE_FULL = 'QUEUE_FULL', // 当前操作队列已满
  VALIDATION_ERROR = 'VALIDATION_ERROR', // 调用参数验证错误
  MAX_CALL_LEVEL = 'MAX_CALL_LEVEL', // 最大请求调用级别错误
  SERVICE_SCHEMA_ERROR = 'SERVICE_SCHEMA_ERROR', // 服务器模式错误
  STAR_OPTIONS_ERROR = 'STAR_OPTIONS_ERROR', // 微服务选项错误
  GRACEFUL_STOP_TIMEOUT = 'GRACEFUL_STOP_TIMEOUT', // 微服务应用停止超时错误
  PROTOCOL_VERSION_MISMATCH = 'PROTOCOL_VERSION_MISMATCH', // 协议版本不匹配错误
  INVALID_PACKET_DATA = 'INVALID_PACKET_DATA', // 无效数据包错误
  MISSING_PAYLOAD = 'MISSING_PAYLOAD',
  INVALID_ENDPOINT = 'INVALID_ENDPOINT',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS', // 无效的参数
  METRICS_DISABLED = 'METRICS_DISABLED', // 禁用指标
  NOT_FOUND_EVENT = 'NOT_FOUND_EVENT', // 没找到服务对应的事件
  WAITFOR_SERVICES = 'WAITFOR_SERVICES' // 等待服务超时
}

export enum UniverseErrorType {
  UniverseError = 'UniverseError',
  UniverseRetryableError = 'UniverseRetryableError',
  StarDisconnectedError = 'StarDisconnectedError',
  StarServerError = 'StarServerError',
  StarClientError = 'StarClientError',
  ServiceNotFoundError = 'ServiceNotFoundError',
  ServiceNotAvailableError = 'ServiceNotAvailableError',
  RequestTimeoutError = 'RequestTimeoutError',
  RequestSkippedError = 'RequestSkippedError',
  RequestRejectedError = 'RequestRejectedError',
  QueueIsFullError = 'QueueIsFullError',
  ValidationError = 'ValidationError',
  MaxCallLevelError = 'MaxCallLevelError',
  ServiceSchemaError = 'ServiceSchemaError',
  StarOptionsError = 'StarOptionsError',
  GracefulStopTimeoutError = 'GracefulStopTimeoutError',
  ProtocolVersionMismatchError = 'ProtocolVersionMismatchError',
  InvalidPacketDataError = 'InvalidPacketDataError'
}

/**
 * 错误码
 */
export enum UniverseErrorCode {
  RESPONSE_ERROR = 400,
  SERVICE_NOT_FOUND = 404,
  VALIDATION_ERROR = 422,
  QUEUE_FULL = 429,
  SERVICE_ERROR = 500,
  BAD_GETWAY = 502,
  REQUEST_REJECTED = 503,
  REQUEST_TIMEOUT = 504,
  REQUEST_SKIPPED = 514
}

/**
 * 错误数据
 */
export interface UniverseErrorData {
  nodeID?: string;
  name?: string;
  action?: any;
  version?: string;
  level?: number;
  type?: UniverseErrorOptionsType | string;
  service?: {
    name: string;
    version: string;
  };
  actual?: string;
  received?: string;
  strategy?: string | null;
  value?: any;
  schema?: any;
  size?: number;
  limit?: number;
  eventName?: string;
  services?: any[];
  statuses?: any[];
  [key: string]: any;
}

export interface UniverseErrorOptions {
  name: UniverseErrorType;
  message: string;
  type: UniverseErrorOptionsType | string;
  code: UniverseErrorCode | number;
  data: UniverseErrorData;
}

export interface UniversePlainError extends UniverseError {
  nodeID?: string;

  [key: string]: any;
}
