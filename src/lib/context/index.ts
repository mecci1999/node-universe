/**
 * 上下文模块，用作处理各个服务之间的请求、响应和事件
 */

import { GenericObject } from '@/typings';
import Endpoint from '../registry/endpoint/item';
import Star from '../star';
import { ActionSchema, CallingOptions } from '@/typings/context';
import Service from '../star/service';
import { EventSchema } from '@/typings/context/event';
import { MaxCallLevelError, RequestSkippedError } from '../error/custom';
import { MCallCallingOptions, StarMCallActionParams } from '@/typings/star';
import { isString } from '@/utils';
import _ from 'lodash';
import util from 'util';
import Span from '../tracing/span';

function mergeMeta(ctx: Context, newMeta: GenericObject) {
  if (newMeta) {
    Object.assign(ctx.meta, newMeta);
  }

  return ctx.meta;
}

export default class Context {
  public id: string = '';
  public star: Star;
  public nodeID: string | null = '';
  public endpoint: Endpoint | null = null; // 端口
  public action: ActionSchema | null = null; // 动作
  public service: Service | null = null; // 服务
  public event: EventSchema | null = null; // 事件
  public eventName: string | null;
  public eventType: string | null;
  public eventGroups: string[] | null;
  public options: CallingOptions;
  public parentID: string | null;
  public caller: string | null;
  public tracing: boolean | null;
  public span: Span | null;
  public _spanStack: Span[];
  public needAck: boolean | null;
  public ackID: string | null;
  public locals: GenericObject;
  public level: number;
  public params: any;
  public meta: GenericObject;
  public requestID: string | null;
  public cachedResult: boolean;
  public starHrTime: any = null; // 开始时间

  constructor(star: Star, endpoint?: Endpoint) {
    this.star = star;
    if (this.star) {
      this.nodeID = this.star.nodeID || '';
      this.id = this.star.generateUid();
    } else {
      this.nodeID = null;
    }

    if (endpoint) {
      this.setEndpoint(endpoint);
    } else {
      this.endpoint = null;
      this.service = null;
      this.action = null;
      this.event = null;
    }

    this.eventName = null;
    this.eventType = null;
    this.eventGroups = null;

    this.options = {
      timeout: null,
      retries: null
    };

    this.parentID = null;
    this.caller = null;
    this.level = 1;
    this.params = null;
    this.meta = {};
    this.locals = {};
    this.requestID = this.id;
    this.tracing = null;
    this.span = null;
    this._spanStack = [];
    this.needAck = null;
    this.ackID = null;

    this.cachedResult = false;
  }

  /**
   * 创建一个上下文实例
   */
  public static create(star: Star, endpoint: Endpoint, params?: GenericObject, options?: GenericObject) {
    const ctx = new Context(star, endpoint);

    // endpoint
    if (endpoint != null) {
      ctx.setEndpoint(endpoint);
    }

    // params
    if (params != null) {
      let cloning = star ? star.options.contextParamsCloning : false;
      if (options && options.paramsCloning != null) {
        cloning = options.paramsCloning;
      }
      ctx.setParams(params, cloning);
    }

    // options
    if (options) ctx.options = options;

    // requestID
    if (options?.requestID) ctx.requestID = options.requestID;
    else if (options?.parentCtx && options.parentCtx.requestID) ctx.requestID = options.parentCtx.requestID;

    // meta
    if (options?.parentCtx && options.parentCtx.meta)
      ctx.meta = Object.assign({}, options.parentCtx.meta || {}, options.meta || {});
    else if (options?.meta) ctx.meta = options.meta;

    // parentID, Level, Caller, Tracing
    if (options?.parentCtx) {
      ctx.tracing = options.parentCtx.tracing;
      ctx.level = options.parentCtx.level + 1;

      if (options.parentCtx?.span) {
        ctx.parentID = options.parentCtx.span?.id;
      } else {
        ctx.parentID = options.parentCtx.id;
      }

      if (options.parentCtx.service) ctx.caller = options.parentCtx.service.fullName;
    }

    // caller
    if (options?.caller) {
      ctx.caller = options.caller;
    }

    // Parent span
    if (options?.parentSpan) {
      ctx.parentID = options.parentSpan?.id;
      ctx.requestID = options.parentSpan?.traceID;
      ctx.tracing = options.parentSpan?.sampled;
    }

    // Event acknowledgement
    if (options?.needAck) {
      ctx.needAck = options.needAck;
    }

    return ctx;
  }

  /**
   * 复制一个上下文实例
   */
  public copy(endpoint?: Endpoint) {
    const newCtx = new Context(this.star);
    newCtx.nodeID = this.nodeID;
    newCtx.setEndpoint(endpoint || (this.endpoint as Endpoint));
    newCtx.options = this.options;
    newCtx.parentID = this.parentID;
    newCtx.caller = this.caller;
    newCtx.level = this.level;
    newCtx.params = this.params;
    newCtx.meta = this.meta;
    newCtx.locals = this.locals;
    newCtx.requestID = this.requestID;
    newCtx.tracing = this.tracing;
    newCtx.span = this.span;
    newCtx.needAck = this.needAck;
    newCtx.ackID = this.ackID;
    newCtx.eventName = this.eventName;
    newCtx.eventType = this.eventType;
    newCtx.eventGroups = this.eventGroups;

    newCtx.cachedResult = this.cachedResult;

    return newCtx;
  }

  /**
   * 给上下文设置参数
   * @param newParams
   * @param cloning
   */
  public setParams(newParams: GenericObject, cloning: boolean = false) {
    if (cloning && newParams) {
      this.params = Object.assign({}, newParams);
    } else {
      this.params = newParams;
    }
  }

  /**
   * 设置上下文对应的端口
   * @param endpoint
   */
  public setEndpoint(endpoint: Endpoint) {
    this.endpoint = endpoint;

    if (this.endpoint) {
      this.nodeID = endpoint.id;

      if (endpoint.action) {
        this.action = endpoint.action;

        if (this.action.service) {
          this.service = this.action.service;
        }

        this.event = null;
      } else if (endpoint.event) {
        this.event = endpoint.event;

        if (this.event.service) {
          this.service = this.event.service;
        }

        this.action = null;
      }
    }
  }

  /**
   * 根据代指向的动作名创建一个子级上下文
   * ctx.call('post.get', {id: 12}, {timeout: 1000})
   * @param actionName 动作名
   * @param params 参数
   * @param options 选项
   */
  public call(actionName: string, params?: GenericObject, options?: GenericObject) {
    const _options = Object.assign({ parentCtx: this }, options);

    if (this.options.timeout && this.options.timeout > 0 && this.starHrTime) {
      const diff = process.hrtime(this.starHrTime); // 距离开始时间的时间差
      const duration = diff[0] * 1e3 + diff[1] / 1e6;
      const distTimeout = this.options.timeout - duration;

      if (distTimeout <= 0) {
        // 抛出请求超时的错误
        return Promise.reject(new RequestSkippedError({ action: actionName, nodeID: this.star.nodeID || '' }));
      }

      if (!_options.timeout || distTimeout < _options.timeout) _options.timeout = distTimeout;
    }

    if (
      this.star.options?.maxCallLevel &&
      this.star.options.maxCallLevel > 0 &&
      this.level >= this.star.options.maxCallLevel
    ) {
      return Promise.reject(new MaxCallLevelError({ nodeID: this.star.nodeID || '', level: this.level }));
    }

    let p = this.star.call(actionName, params, _options);

    return p
      .then((res) => {
        if ((p as any).ctx) {
          mergeMeta(this, (p as any).ctx.meta);
        }

        return res;
      })
      .catch((err) => {
        if ((p as any).ctx) {
          mergeMeta(this, (p as any).ctx.meta);
        }

        return Promise.reject(err);
      });
  }

  /**
   * 多个通信动作
   */
  public mcall(
    def: Array<StarMCallActionParams> | Record<string, StarMCallActionParams>,
    opts: MCallCallingOptions = {}
  ) {
    const options = Object.assign({ parentCtx: this }, opts);

    if (this.options.timeout && this.options.timeout > 0 && this.starHrTime) {
      // 分发超时处理
      const diff = process.hrtime(this.starHrTime);
      const duration = diff[0] * 1e3 + diff[1] / 1e6;
      const distTimeout = this.options.timeout - duration;

      if (distTimeout <= 0) {
        // 超时
        const action = (Array.isArray(def) ? def : Object.values(def)).map((d) => d.action).join(', ');

        return Promise.reject(new RequestSkippedError({ action, nodeID: this.star.nodeID || '' }));
      }

      if (!options.timeout || distTimeout < options.timeout) options.timeout = distTimeout;
    }

    // 设置最大的通信数量，避免出现循环调用
    if (
      this.star.options.maxCallLevel &&
      this.star.options.maxCallLevel > 0 &&
      this.level >= this.star.options.maxCallLevel
    ) {
      return Promise.reject(new MaxCallLevelError({ nodeID: this.star.nodeID || '', level: this.level }));
    }

    let p = this.star.mcall(def, options);

    return p
      .then((res) => {
        if (Array.isArray((p as any).ctx) && (p as any).ctx.length) {
          (p as any).ctx.forEach((ctx) => mergeMeta(this, ctx.meta));
        }

        return res;
      })
      .catch((err) => {
        if (Array.isArray((p as any).ctx) && (p as any).ctx.length) {
          (p as any).ctx.forEach((ctx) => mergeMeta(this, ctx.meta));
        }

        return Promise.reject(err);
      });
  }

  /**
   * 事件触发方法
   */
  public emit(eventName: string, data?: any, options?: GenericObject) {
    if (Array.isArray(options) || isString(options)) {
      options = { groups: options };
    } else if (options == null) {
      options = {};
    }

    if (options.groups && !Array.isArray(options.groups)) {
      options.groups = [options.groups];
    }

    options.parentCtx = this;

    return this.star.emit(eventName, data, options);
  }

  /**
   * 广播
   */
  public broadcast(eventName: string, data?: any, options?: GenericObject) {
    if (Array.isArray(options) || isString(options)) {
      options = { groups: options };
    } else if (options == null) {
      options = {};
    }

    if (options.groups && !Array.isArray(options.groups)) {
      options.groups = [options.groups];
    }

    options.parentCtx = this;

    return this.star.broadcast(eventName, data, options);
  }

  /**
   * 修改上下文中的属性
   */
  public setContextEventData(options: { eventName?: string; eventType?: string; eventGroups?: string[] }) {
    if (options.eventName) {
      this.eventName = options.eventName;
    }
    if (options.eventType) {
      this.eventType = options.eventType;
    }
    if (options.eventGroups) {
      this.eventGroups = options.eventGroups;
    }
  }

  /**
   * 开始追踪
   *
   * @param {String} name
   * @param {Object?} opts
   * @returns {Span}
   * @memberof Context
   */
  public startSpan(name: string, opts?: GenericObject) {
    let span: any;
    if (this.span) {
      span = this.span.startSpan(name, Object.assign({ ctx: this }, opts));
    } else {
      span = this.star.tracer?.startSpan(name, Object.assign({ ctx: this }, opts));
    }

    this._spanStack.push(span);
    this.span = span;

    return span;
  }

  /**
   * Finish an active span.
   *
   * @param {Span} span
   * @param {Number?} time
   */
  public finishSpan(span: Span, time?: number) {
    if (!span.isActive()) return;

    span.finish(time);

    const idx = this._spanStack.findIndex((sp) => sp == span);
    if (idx !== -1) {
      this._spanStack.splice(idx, 1);
      this.span = this._spanStack[this._spanStack.length - 1];
    } else {
      this.service?.logger?.warn('This span is not assigned to this context', span);
    }
  }

  /**
   * 将Context类转换为一个可读JSON对象
   */
  public toJSON() {
    const res = _.pick(this, [
      'id',
      'nodeID',
      'action.name',
      'event.name',
      'service.name',
      'service.version',
      'service.fullName',
      'options',
      'parentID',
      'caller',
      'level',
      'params',
      'meta',
      //"locals",
      'requestID',
      'tracing',
      'span',
      'needAck',
      'ackID',
      'eventName',
      'eventType',
      'eventGroups',
      'cachedResult'
    ]);

    return res;
  }

  [util.inspect.custom](depth: number, options: any) {
    if (depth < 0) {
      return options?.stylize('[Context]', 'special');
    }

    const inner = util.inspect(this.toJSON(), options);

    return `${options?.stylize('Context', 'special')}< ${inner} >`;
  }
}
