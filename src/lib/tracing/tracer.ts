import { GenericObject } from '@/typings';
import Star from '../star';
import { LoggerInstance } from '@/typings/logger';
import _ from 'lodash';
import RateLimiter from './rate-limiter';
import { isFunction } from '@/utils';
import { TraceExporter, TracerOptions } from '@/typings/tracing';
import Expoters from './exporters/index';
import Span from './span';

export default class Tracer {
  public star: Star;
  public logger: LoggerInstance;
  public options: GenericObject;
  public sampleCounter: number;
  public rateLimiter: RateLimiter | null = null;
  public defaultTags: GenericObject | Function | null = null;
  public exporter: TraceExporter[] | null = null;

  constructor(star: Star, options: TracerOptions | boolean) {
    this.star = star;
    this.logger = star.getLogger('tracer');

    if (options === true || options === false) {
      options = { enabled: options };
    }

    this.options = _.defaultsDeep({}, options, {
      enabled: true,
      exporter: null,
      sampling: {
        rate: 1.0,
        tracesPerSecond: null,
        minPriority: null
      },
      actions: true,
      events: false,
      errorFields: ['name', 'message', 'code', 'type', 'data'],
      stackTrace: false,
      defaultTags: null,
      tags: {
        action: null,
        event: null
      }
    });

    if (this.options.stackTrace && this.options.errorFields.indexOf('stack') === -1) {
      this.options.errorFields.push('stack');
    }

    this.sampleCounter = 0;

    if (this.options.sampling.tracesPerSecond != null && this.options.sampling.tracesPerSecond > 0) {
      this.rateLimiter = new RateLimiter({
        tracesPerSecond: this.options.sampling.tracesPerSecond
      });
    }

    if (this.options.enabled) {
      this.logger.info(`Tracing: Enabled`);
    }
  }

  public init() {
    if (this.options.enabled) {
      this.defaultTags = isFunction(this.options.defaultTags)
        ? this.options.defaultTags.call(this, this)
        : this.options.defaultTags;
    }

    if (this.options.exporter) {
      const exporters = Array.isArray(this.options.exporter) ? this.options.exporter : [this.options.exporter];

      this.exporter = _.compact(exporters).map((r) => {
        const exporter = Expoters.resolve(r);
        exporter.init(this);

        return exporter as TraceExporter;
      });

      const exporterNames = this.exporter.map((exporter) => this.star.getConstructorName(exporter));

      this.logger.info(`Tracing exporter${exporterNames.length > 1 ? 's' : ''}: ${exporterNames.join(', ')}`);
    }
  }

  public stop(): Promise<any> {
    if (this.exporter) {
      return Promise.all(this.exporter.map((r) => r.stop()));
    }

    return Promise.resolve();
  }

  /**
   * 是否启用追踪模块
   */
  public isEnabled() {
    return this.options.enabled;
  }

  public shouldSample(span: Span) {
    if (this.options.sampling.minPriority != null) {
      if (span.priority < this.options.sampling.minPriority) {
        return false;
      }
    }

    if (this.rateLimiter) {
      return this.rateLimiter.check();
    }

    if (this.options.sampling.rate == 0) {
      return false;
    }

    if (this.options.sampling.rate == 1) {
      return true;
    }

    if (++this.sampleCounter * this.options.sampling.rate >= 1.0) {
      this.sampleCounter = 0;

      return true;
    }

    return false;
  }

  /**
   * 开始追踪
   */
  public startSpan(name: string, options: GenericObject = {}) {
    let parentOptions: GenericObject = {};

    if (options?.parentSpan) {
      parentOptions.traceID = options.parentOptions.traceID;
      parentOptions.parentID = options.parentOptions.id;
      parentOptions.sampled = options.parentSpan.sampled;
    }

    const span = new Span(
      this,
      name,
      Object.assign(
        {
          type: 'custom',
          defaultTags: this.defaultTags
        },
        parentOptions,
        options,
        {
          parentSpan: undefined
        }
      )
    );

    span.start();

    return span;
  }

  public spanStarted(span: Span) {
    if (span.sampled) {
      this.invokeExporter('spanStarted', [span]);
    }
  }

  public spanFinished(span: Span) {
    if (span.sampled) {
      this.invokeExporter('spanFinished', [span]);
    }
  }

  /**
   * 注入运输方法
   */
  public invokeExporter(method: string, args: Array<any>) {
    if (this.exporter) {
      this.exporter.forEach((exporter) => exporter[method].apply(exporter, args));
    }
  }

  public getCurrentTraceID() {
    return null;
  }

  public getActiveSpanID() {
    return null;
  }
}
