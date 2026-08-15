/**
 * 指标注册模块
 */
import _ from 'lodash';
import { isFunction, isPlainObject, isString, match } from '@/utils';
import METRIC from './constants';
import Star from '../star';
import { BaseMetricOptions, MetricRegistryOptions } from '@/typings/metric';
import { LoggerInstance } from '@/typings/logger';
import BaseMetric from './type/base';
import { GenericObject } from '@/typings';
import MetricBaseReporter from './reporters/base';
import Reporters from './reporters/index';
import Types from './type/index';
import { registerCommonMetrics, stopCommonMetrics, updateCommonMetrics } from './common';

const METRIC_NAME_REGEXP = /^[a-zA-Z_][a-zA-Z0-9_:.]*$/;
const METRIC_LABEL_REGEXP = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

export default class MetricRegistry {
  public star: Star;
  public logger: LoggerInstance;
  public dirty: boolean;
  public options: MetricRegistryOptions;
  public store: Map<string, BaseMetric>;
  public reporter: MetricBaseReporter[] = [];
  public collectTimer: NodeJS.Timer | null = null;

  constructor(star: Star, options?: MetricRegistryOptions | boolean) {
    this.star = star;
    this.logger = star.getLogger('metrics');
    this.dirty = true;

    if (options === true || options === false) {
      options = {
        enabled: options
      };
    }

    this.options = _.defaultsDeep({}, options, {
      enabled: true,
      collectProcessMetrics: process.env.NODE_ENV !== 'test',
      collectInterval: 5,
      reporter: false,
      defaultBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000], // in milliseconds
      defaultQuantiles: [0.5, 0.9, 0.95, 0.99, 0.999], // percentage
      defaultMaxAgeSeconds: 60,
      defaultAgeBuckets: 10,
      defaultAggregator: 'sum'
    });

    this.store = new Map();

    if (this.options.enabled) {
      this.logger.info('Metrics: Enabled');
    }
  }

  /**
   * 初始化
   */
  public init() {
    if (this.options.enabled) {
      if (this.options.reporter) {
        const resporters = Array.isArray(this.options.reporter) ? this.options.reporter : [this.options.reporter];

        this.reporter = _.compact(resporters).map((r) => {
          const reporter = Reporters.resolve(r);
          reporter.init(this);
          return reporter;
        });

        const reporterNames = this.reporter.map((reporter) => this.star.getConstructorName(reporter));

        this.logger.info(`Metric reporter${reporterNames.length > 1 ? 's' : ''}: ${reporterNames.join(', ')}`);
      }

      if (this.options.collectProcessMetrics) {
        this.collectTimer = setInterval(() => {
          // 更新通用指标
          updateCommonMetrics(this);
        }, (this.options.collectInterval || 5) * 1000);
        this.collectTimer.unref();

        // 注册通用指标
        registerCommonMetrics(this);
        // 更新通用指标
        updateCommonMetrics(this);
      }
    }
  }

  /**
   * 停止指标注册
   */
  public stop() {
    if (this.collectTimer) {
      clearInterval(this.collectTimer as NodeJS.Timeout);
      this.collectTimer = null;
    }
    stopCommonMetrics(this);
    this.store.forEach((metric) => metric.dispose());

    if (this.reporter) {
      return Promise.all(this.reporter.map((item) => item.stop())).then(() => {
        this.reporter = [];
      });
    }
  }

  /**
   * 检查指标模块是否被禁用
   */
  public isEnabled() {
    return this.options.enabled;
  }

  /**
   * 改变指标的值
   */
  public changed(metric: BaseMetric, value: any, labels?: GenericObject, timestamp?: number) {
    this.dirty = true;

    if (Array.isArray(this.reporter)) {
      this.reporter.forEach((reporter) => reporter.metricChanged(metric, value, labels, timestamp));
    }
  }

  /**
   * 注册指标
   */
  public register(options: BaseMetricOptions): BaseMetric | null {
    if (!isPlainObject(options)) throw new Error('Wrong argument. Must be an Object.');

    if (!options.type) throw new Error(`The metric 'type' property is mandatory.`);

    if (!options.name) throw new Error(`The metric 'name' property is mandatory.`);

    // 检查指标名称是否符合规则
    if (!METRIC_NAME_REGEXP.test(options.name)) {
      throw new Error(`The metric 'name' is not valid: ` + options.name);
    }

    // 检查标签名称是否符合规则
    if (Array.isArray(options.labelNames)) {
      options.labelNames.forEach((name) => {
        if (!METRIC_LABEL_REGEXP.test(name)) {
          throw new Error(`The '${options.name}' metric label name is not valid: ${name}`);
        }
      });
    }

    const MetricClass = Types.resolve(options.type);

    if (!this.options.enabled) return null;

    const item = new MetricClass(options, this);

    this.store.set(options.name, item);

    return item;
  }

  /**
   * 通过名称检查是否存在指标
   */
  public hasMetric(name: string) {
    return this.store.has(name);
  }

  /**
   * 通过指标名获取指标
   */
  public getMetric(name: string) {
    const item = this.store.get(name);
    if (!item) return null;

    return item;
  }

  /**
   * 设置指标数据
   */
  public set(name: string, value: any | null, labels?: GenericObject, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);
    if (item && !isFunction(item.set)) {
      throw new Error('Invald metric type. Value setting works only with counter, gauge & info metric types.');
    }

    return item?.set(value, labels, timestamp);
  }

  /**
   * 增加
   */
  public increment(name: string, labels?: GenericObject | null, value?: number, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);
    if (item && !isFunction(item.increment)) {
      throw new Error('Invalid metric type. Incrementing works only with counter & gauge metric types.');
    }

    return item?.increment(labels || undefined, value || 1, timestamp);
  }

  /**
   * 减少
   */
  public decrement(name: string, labels?: GenericObject | null, value?: number, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);
    if (item && !isFunction(item.decrement))
      throw new Error('Invalid metric type. Decrementing works only with gauge metric type.');

    return item?.decrement(labels || undefined, value || 1, timestamp);
  }

  /**
   * 监听
   */
  public observe(name: string, value: number, labels?: GenericObject, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);

    if (item && !isFunction(item.observe)) {
      throw new Error('Invalid metric type. Observing works only with histogram metric type.');
    }

    return item?.observe(value, labels, timestamp);
  }

  /**
   * 重置某个指标数据
   */
  public reset(name: string, labels?: GenericObject, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);
    item?.reset(labels, timestamp);
  }

  /**
   * 重置所有的指标数据
   */
  public resetAll(name: string, timestamp?: number) {
    if (!this.options.enabled) return null;

    const item = this.getMetric(name);
    item?.resetAll(timestamp);
  }

  /**
   * 开启一个计时器监听指标变化时间
   */
  public timer(name?: string, labels?: GenericObject, timestamp?: number): () => number {
    let item: BaseMetric | null;
    if (name && this.options.enabled) {
      item = this.getMetric(name);

      if (item && !isFunction(item.observe) && !isFunction(item.set)) {
        throw new Error('Invalid metric type. Timing works only with histogram or gauge metric types');
      }
    }

    const start = process.hrtime();

    return () => {
      const delta = process.hrtime(start);
      const duration = (delta[0] + delta[1] / 1e9) * 1000;

      if (item) {
        if (item.type === METRIC.TYPE_HISTOGRAM) {
          item.observe(duration, labels, timestamp);
        } else if (item.type === METRIC.TYPE_GAUGE) {
          item.set(duration, labels, timestamp);
        }
      }

      return duration;
    };
  }

  /**
   * 返回所有的指标数据列表
   */
  public list(options?: GenericObject) {
    const res: GenericObject[] = [];
    options = options || {};

    const types = options.types != null ? (isString(options.types) ? [options.types] : options.types) : null;
    const includes =
      options.includes != null ? (isString(options.includes) ? [options.includes] : options.includes) : null;
    const excludes =
      options.excludes != null ? (isString(options.excludes) ? [options.excludes] : options.excludes) : null;

    this.store.forEach((metric) => {
      if (types && !types.some((type) => metric.type == type)) return;

      if (includes && !includes.some((pattern) => match(metric.name, pattern))) return;

      if (excludes && !excludes.every((pattern) => !match(metric.name, pattern))) return;

      res.push(metric.toObject());
    });

    return res;
  }

  /**
   * 公制单位复数化
   */
  public pluralizeUnit(unit: string) {
    switch (unit) {
      case METRIC.UNIT_GHZ: {
        return unit;
      }
    }

    return unit + 's';
  }
}
