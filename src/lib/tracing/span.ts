import { GenericObject } from '@/typings';
import Tracer from './tracer';
import { performance } from 'perf_hooks';
import { LoggerInstance } from '@/typings/logger';
import { SpanLogEntry } from '@/typings/tracing';

function defProp(instance: any, propName: string, value: any, readOnly = false) {
  Object.defineProperty(instance, propName, {
    value,
    writable: !!readOnly,
    enumerable: false
  });
}

export default class Span {
  public id: string;
  public name: string;
  public type: string;
  public options: GenericObject = {};
  public tracer: Tracer | null = null;
  public traceID: string;
  public parentID: string | null;
  public logger: LoggerInstance | null = null;
  public service: { name?: string; version?: string | number | null | undefined; fullName?: string } = {};
  public priority: number;
  public sampled: boolean;
  public startTime: number | null;
  public finishTime: number | null;
  public duration: number | null;
  public startTicks: number = 0;
  public error: Error | boolean | null;
  public logs: SpanLogEntry[];
  public tags: GenericObject;

  constructor(tracer: Tracer, name: string, options?: GenericObject) {
    defProp(this, 'tracer', tracer, true);
    defProp(this, 'logger', this.tracer?.logger, true);
    defProp(this, 'options', options || {});
    defProp(this, 'meta', {});

    this.name = name;
    this.type = this.options.type || 'custom';
    this.id = this.options.id || this.tracer?.star.generateUid();
    this.traceID = this.options.traceID || this.id;
    this.parentID = this.options.parentID;

    if (this.options.service) {
      if (typeof this.options.service == 'string') {
        this.service = { name: this.options.service, fullName: this.options.service };
      } else {
        this.service = {
          name: this.options.service.name,
          version: this.options.service.version,
          fullName: this.options.service.fullName
        };
      }
    }

    this.priority = this.options.priority != null ? this.options.priority : 5;
    this.sampled = this.options.sampled != null ? this.options.sampled : this.tracer?.shouldSample(this);
    this.startTime = null;
    this.finishTime = null;
    this.duration = null;
    this.error = null;
    this.logs = [];
    this.tags = {};

    if (this.options.defaultTags) {
      this.addTags(this.options.defaultTags);
    }

    if (this.options.tags) {
      this.addTags(this.options.tags);
    }
  }

  /**
   * 添加标签
   * @param obj
   * @returns
   */
  public addTags(obj: Object) {
    Object.assign(this.tags, obj);

    return this;
  }

  /**
   * 开始追踪
   */
  public start(time?: number) {
    this.logger?.debug(`[${this.id}] Span '${this.name}' is started.`);

    this.startTime = time || Date.now();
    this.startTicks = performance.now();
    this.tracer?.spanStarted(this);

    return this;
  }

  /**
   * 获取当前时间
   */
  public getTime() {
    return (this.startTime || 0) + performance.now() - this.startTicks;
  }

  /**
   * 打印事件日志
   */
  public log(name: string, fields?: GenericObject, time?: number) {
    time = time || this.getTime();

    this.logs.push({
      name,
      fields: fields || {},
      time,
      elapsed: time - (this.startTime || 0)
    });

    this.logger?.debug(`[${this.id}] Span '${this.name}' has a new log event: ${name}.`);

    return this;
  }

  public setError(err: Error) {
    this.error = err !== null ? err : true;

    return this;
  }

  /**
   * 结束
   */
  public finish(time?: number) {
    this.finishTime = time ? time : this.getTime();
    this.duration = this.finishTime - (this.startTime || 0);

    this.logger?.debug(
      `[${this.id}] Span '${this.name}' is finished. Duration: ${Number(this.duration).toFixed(3)} ms`,
      this.tags
    );

    this.tracer?.spanFinished(this);

    return this;
  }

  /**
   * 是否正在追踪
   */
  public isActive() {
    return this.finishTime == null;
  }

  /**
   * 开始一个子节点的追踪
   */
  public startSpan(name: string, options?: GenericObject) {
    const r = {
      traceID: this.traceID,
      parentID: this.id,
      sampled: this.sampled,
      service: this.service
    };

    return this.tracer?.startSpan(name, options ? Object.assign(r, options) : r);
  }
}
