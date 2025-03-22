/**
 * 自定义错误模块
 */
import { UniverseErrorOptionsType, UniverseErrorCode, UniverseErrorData, UniverseErrorType } from '@/typings/error';
import BaseError from './base';

/**
 * 自定义基础错误类
 * 该类用来作为微服务应用所有错误类的基础类
 */
export class UniverseError extends BaseError {
  public code: UniverseErrorCode | number; // 错误码
  public type: UniverseErrorOptionsType | string; // 错误类型
  public data?: UniverseErrorData; // 错误数据
  public retryable: boolean; // 是否可以重新连接

  constructor(
    message: string,
    code?: UniverseErrorCode | number,
    type?: UniverseErrorOptionsType | string,
    data?: UniverseErrorData
  ) {
    super(message);
    this.code = code || UniverseErrorCode.BAD_GETWAY;
    this.type = type || UniverseErrorOptionsType.BAD_GETWAY;
    this.data = data;
    this.retryable = false;
  }
}

/**
 * 可重试错误类
 * 为了满足在微服务应用中出现的可重试错误场景，创建该错误类
 */
export class UniverseRetryableError extends UniverseError {
  constructor(
    message: string,
    code?: UniverseErrorCode | number,
    type?: UniverseErrorOptionsType | string,
    data?: UniverseErrorData
  ) {
    super(message, code, type, data);
    this.retryable = true;
  }
}

/**
 * 可重试断开链接错误类
 * 为了处理在微服务应用中star的连接中断时，可重新连接的错误
 */
export class StarDisconnectedError extends UniverseRetryableError {
  constructor() {
    super(
      `The star's transporter has disconnected. Please try again when a connection is reestablished.`,
      502,
      UniverseErrorOptionsType.BAD_GETWAY
    );
    this.stack = '';
  }
}

/**
 * 服务端错误类
 * 为了处理可重试的服务器错误
 */
export class StarServerError extends UniverseRetryableError {}

/**
 * 客户端错误类
 * 为了处理不可重试的客户端错误
 */
export class StarClientError extends UniverseError {
  constructor(
    message: string,
    code: UniverseErrorCode | number,
    type: UniverseErrorOptionsType | string,
    data?: UniverseErrorData
  ) {
    super(message, code || UniverseErrorCode.RESPONSE_ERROR, type, data);
  }
}

/**
 * 服务未发现错误类
 * 为了处理没有找到对应服务错误
 */
export class ServiceNotFoundError extends UniverseRetryableError {
  constructor(data: UniverseErrorData = {}) {
    let msg: string = '';

    if (data?.nodeID && data?.action) msg = `Service '${data?.action}' is not found on '${data?.nodeID}' node.`;
    else if (data?.action) msg = `Service '${data?.action}' is not found.`;
    if (data?.service && data?.version) msg = `Service '${data?.version}.${data?.service}' not found.`;
    else if (data?.service) msg = `Service '${data?.service}' not found.`;

    super(msg, UniverseErrorCode.SERVICE_NOT_FOUND, UniverseErrorOptionsType.SERVICE_NOT_FOUND, data);
  }
}

/**
 * 服务不可用错误类
 * 为了处理服务当前无法提供服务，例如正在维护、服务停止、网络错误、数据中心故障等
 */
export class ServiceNotAvailableError extends UniverseRetryableError {
  constructor(data: UniverseErrorData = {}) {
    let msg: string = '';
    if (data?.nodeID) msg = `Service '${data?.action}' is not available on '${data?.nodeID}' node.`;
    else msg = `Service '${data?.action}' is not available.`;

    super(msg, UniverseErrorCode.SERVICE_NOT_FOUND, UniverseErrorOptionsType.SERVICE_NOT_AVAILABLE, data);
  }
}

/**
 * 请求超时错误类
 */
export class RequestTimeoutError extends UniverseRetryableError {
  constructor(data: UniverseErrorData = {}) {
    super(
      `Request is timed out when call '${data?.action}' action on '${data?.nodeID}' node.`,
      UniverseErrorCode.REQUEST_TIMEOUT,
      UniverseErrorOptionsType.REQUEST_TIMEOUT,
      data
    );
  }
}

/**
 * 请求完成前已超时错误类
 * 为了处理某个请求完成太慢，导致超时错误
 */
export class RequestSkippedError extends UniverseError {
  constructor(data: UniverseErrorData = {}) {
    super(
      `Calling '${data.action}' is skipped because timeout reached on '${data.nodeID}' node.`,
      UniverseErrorCode.REQUEST_SKIPPED,
      UniverseErrorOptionsType.REQUEST_SKIPPED,
      data
    );
    this.retryable = false;
  }
}

/**
 * 请求被拒绝错误类
 * 为了处理某个请求被拒绝产生的错误，例如权限不够、资源不足、无效的参数等场景
 */
export class RequestRejectedError extends UniverseRetryableError {
  constructor(data: UniverseErrorData = {}) {
    super(
      `Request is rejected when call '${data?.action}' action on '${data?.nodeID}' node.`,
      UniverseErrorCode.REQUEST_REJECTED,
      UniverseErrorOptionsType.REQUEST_REJECTED,
      data
    );
  }
}

/**
 * 服务操作队列已满错误类
 */
export class QueueIsFullError extends UniverseRetryableError {
  constructor(data: UniverseErrorData = {}) {
    super(
      `Queue is full. Request '${data?.action}' action on '${data?.nodeID}' node is rejected.`,
      UniverseErrorCode.QUEUE_FULL,
      UniverseErrorOptionsType.QUEUE_FULL,
      data
    );
  }
}

/**
 * 动作调用参数验证错误类
 */
export class ValidationError extends StarClientError {
  constructor(message: string, type?: UniverseErrorOptionsType | string, data?: UniverseErrorData) {
    super(message, UniverseErrorCode.VALIDATION_ERROR, type || UniverseErrorOptionsType.VALIDATION_ERROR, data);
  }
}

/**
 * 最大请求调用级别错误
 */
export class MaxCallLevelError extends UniverseError {
  constructor(data?: UniverseErrorData) {
    super(
      `Request level is reached the limit (${data?.level}) on '${data?.nodeID}' node.`,
      UniverseErrorCode.SERVICE_ERROR,
      UniverseErrorOptionsType.MAX_CALL_LEVEL,
      data
    );
    this.retryable = false;
  }
}

/**
 * 服务器模式错误
 */
export class ServiceSchemaError extends UniverseError {
  constructor(message: string, data?: UniverseErrorData) {
    super(message, UniverseErrorCode.SERVICE_ERROR, UniverseErrorOptionsType.SERVICE_SCHEMA_ERROR, data);
  }
}

/**
 * 微服务应用选项错误
 */
export class StarOptionsError extends UniverseError {
  constructor(message: string, data?: UniverseErrorData) {
    super(message, UniverseErrorCode.SERVICE_ERROR, UniverseErrorOptionsType.STAR_OPTIONS_ERROR, data);
  }
}

/**
 * 停止微服务应用动作超时错误
 */
export class GracefulStopTimeoutError extends UniverseError {
  constructor(data: UniverseErrorData | undefined) {
    if (data && data?.service) {
      super(
        `Unable to stop '${data?.service.name}' service gracefully.`,
        UniverseErrorCode.SERVICE_ERROR,
        UniverseErrorOptionsType.GRACEFUL_STOP_TIMEOUT,
        data && data?.service
          ? {
              name: data?.service.name,
              version: data?.service.version
            }
          : undefined
      );
    } else {
      super(
        'Unable to stop ServiceBroker gracefully.',
        UniverseErrorCode.SERVICE_ERROR,
        UniverseErrorOptionsType.GRACEFUL_STOP_TIMEOUT
      );
    }
  }
}

/**
 * 协议版本不匹配
 */
export class ProtocolVersionMismatchError extends UniverseError {
  constructor(data: UniverseErrorData | undefined) {
    super(
      'Protocol version mismatch.',
      UniverseErrorCode.SERVICE_ERROR,
      UniverseErrorOptionsType.PROTOCOL_VERSION_MISMATCH,
      data
    );
  }
}

/**
 * 无效数据包格式错误
 */
export class InvalidPacketDataError extends UniverseError {
  constructor(data) {
    super('Invalid packet data.', UniverseErrorCode.SERVICE_ERROR, UniverseErrorOptionsType.INVALID_PACKET_DATA, data);
  }
}
