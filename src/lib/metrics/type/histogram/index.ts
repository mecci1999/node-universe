import { BaseMetricOptions } from '@/typings/metric';
import BaseMetric from '../base';
import MetricRegistry from '../../registry';
import METRICS from '../../constants';
import { isPlainObject } from '@/utils';
import { GenericObject } from '@/typings';
import TimeWindowQuantiles from './timeWindowQuantiles';
import _ from 'lodash';
import MetricRate from '../../rates';

const setProp = (o, k, v) => {
  o[k] = v;
  return o;
};

/**
 * 柱状图展示类
 */
export default class HistogramMetric extends BaseMetric {
  public buckets: Array<number> = [];
  public quantiles: Array<any> = [];
  public maxAgeSeconds: number = 0;
  public ageBuckets: number = 0;
  public rate: any;

  constructor(options: BaseMetricOptions, registry: MetricRegistry) {
    super(options, registry);
    this.type = METRICS.TYPE_HISTOGRAM;

    if (isPlainObject(options.linearBuckets)) {
      this.buckets = HistogramMetric.generateLinearBuckets(
        options.linearBuckets.start,
        options.linearBuckets.width,
        options.linearBuckets.count
      );
    } else if (isPlainObject(options.exponentialBuckets)) {
      this.buckets = HistogramMetric.generateExponentialBuckets(
        options.exponentialBuckets.start,
        options.exponentialBuckets.factor,
        options.exponentialBuckets.count
      );
    } else if (Array.isArray(options.buckets)) {
      this.buckets = Array.from(options.buckets);
    } else if (options.buckets === true) {
      this.buckets = this.registry.options.defaultBuckets || [];
    }

    if (this.buckets.length > 0) {
      this.buckets.sort((a, b) => a - b);
    }

    if (Array.isArray(options.quantiles)) {
      this.quantiles = Array.from(options.quantiles);
    } else if (options.quantiles === true) {
      this.quantiles = this.registry.options.defaultQuantiles || [];
    }

    if (this.quantiles.length > 0) {
      this.quantiles.sort((a, b) => a - b);
      this.maxAgeSeconds = options.maxAgeSeconds || this.registry.options.defaultMaxAgeSeconds;
      this.ageBuckets = options.ageBuckets || this.registry.options.defaultAgeBuckets;
    }

    this.rate = options.rate;
  }

  /**
   * 观察一个值
   */
  public observe(value: number, labels?: GenericObject, timestamp?: number) {
    const hash = this.hashingLabels(labels || {});

    let item = this.values.get(hash);
    if (!item) {
      // 不存在该值
      item = this.resetItem({ labels: _.pick(labels, this.labelNames) });

      if (this.rate) item.rate = new MetricRate(this, item, 1);

      this.values.set(hash, item);
    }

    // 存在该值，进行更新
    item.timestamp = timestamp == null ? Date.now() : timestamp;
    item.sum += value;
    item.count++;
    item.lastValue = value;

    if (item.bucketValues) {
      const len = this.buckets.length;

      for (let i = 0; i < len; i++) {
        if (value <= this.buckets[i]) {
          item.bucketValues[this.buckets[i]] += 1;
        }
      }
    }

    if (item.quantileValues) {
      item.quantileValues.add(value);
    }

    if (item.rate) item.rate.update(item.count);

    this.changed(value, labels, timestamp);

    return item;
  }

  /**
   * 重置某个值
   */
  public resetItem(item: GenericObject, timestamp?: number) {
    item.quantileValues?.dispose();
    item.timestamp = timestamp == null ? Date.now() : timestamp;
    item.sum = 0;
    item.count = 0;
    item.lastValue = null;

    if (this.buckets) {
      item.bucketValues = this.createBucketValues();
    }

    if (this.quantiles) {
      item.quantileValues = new TimeWindowQuantiles(this, this.quantiles, this.maxAgeSeconds, this.ageBuckets);
    }

    return item;
  }

  /**
   * 根据配置的值创建一个桶的值
   */
  public createBucketValues() {
    return this.buckets.reduce((a, bound) => setProp(a, bound, 0), {});
  }

  /**
   * 生成快照
   */
  public generateSnapshot() {
    return Array.from(this.values.keys()).map((key) => this.generateItemSnapshot(this.values.get(key), key));
  }

  /**
   * 生成某个项的快照信息
   */
  public generateItemSnapshot(item?: GenericObject, key?: string) {
    if (!item && !key) return;

    const snapshot = {
      key,
      labels: (item as GenericObject).labels,
      count: (item as GenericObject).count,
      sum: (item as GenericObject).sum,
      lastValue: (item as GenericObject).lastValue,
      timestamp: (item as GenericObject).timestamp
    };

    if (this.buckets) {
      (snapshot as GenericObject).buckets = this.buckets.reduce(
        (a, b) => setProp(a, b, (item as GenericObject).bucketValues[b]),
        {}
      );
    }

    if (this.quantiles) Object.assign(snapshot, (item as GenericObject).quantileValues.snapshot());

    if ((item as GenericObject).rate) (snapshot as GenericObject).rate = (item as GenericObject).rate.rate;

    return snapshot;
  }

  /**
   * 重置某个项的数据
   */
  public reset(labels: GenericObject, timestamp: number): void {
    const hash = this.hashingLabels(labels);
    const item = this.values.get(hash);

    if (item) {
      this.resetItem(item, timestamp);
      this.changed(null, labels, timestamp);
    }
  }

  /**
   * 重置所有的数据
   */
  public resetAll(timestamp: number): void {
    this.values.forEach((item) => this.resetItem(item, timestamp));

    this.changed(null);
  }

  public dispose(): void {
    super.dispose();
  }

  /**
   * 生成线性数据桶
   */
  public static generateLinearBuckets(start: number, width: number, count: number) {
    const buckets: number[] = [];
    for (let i = 0; i < count; i++) {
      buckets.push(start + i * width);
    }

    return buckets;
  }

  /**
   * 生成指数数据桶
   */
  public static generateExponentialBuckets(start: number, factor: number, count: number) {
    const buckets: number[] = [];
    for (let i = 0; i < count; i++) buckets[i] = start * Math.pow(factor, i);

    return buckets;
  }
}
