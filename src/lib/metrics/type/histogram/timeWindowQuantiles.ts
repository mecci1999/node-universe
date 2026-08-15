import BaseMetric from '../base';
import Bucket from './bucket';

const setProp = (o, k, v) => {
  o[k] = v;
  return o;
};

/**
 * 用于在时间窗口内计算样本数据的快照，比如最小值、平均值、方差、标准差、最大值以及指定分位数的值
 */
export default class TimeWindowQuantiles {
  public metric: BaseMetric;
  public quantiles: Array<number>; // 一个包含分位数的数组
  public maxAgeSeconds: number;
  public ageBuckets: number;
  public ringBuckets: Bucket[]; // 存储样本数据的不同时间窗口
  public dirty: boolean; // 是否需要更新数据
  public currentBucket: number; // 当前使用的桶的索引，初始化为-1表示还未开始轮转
  public lastSnapshot: any; // 缓存上一次计算的快照
  public rotateTimer: NodeJS.Timeout | null = null;

  constructor(metric: BaseMetric, quantiles: any, maxAgeSeconds: number, ageBuckets: number) {
    this.metric = metric;
    this.quantiles = Array.from(quantiles);
    this.maxAgeSeconds = maxAgeSeconds;
    this.ageBuckets = ageBuckets;
    this.ringBuckets = [];

    for (let i = 0; i < ageBuckets; i++) {
      this.ringBuckets.push(new Bucket());
    }

    this.dirty = true;
    this.currentBucket = -1;
    this.rotate();
    this.lastSnapshot = null;
    this.setDirty();
  }

  /**
   * 设置标记，标记数据需要进行更新
   */
  public setDirty() {
    this.dirty = true;
    this.metric.setDirty();
  }

  /**
   * 已经更新过数据
   */
  public clearDirty() {
    this.dirty = false;
  }

  /**
   * 轮转操作，用于定期清理数据
   */
  public rotate() {
    this.currentBucket = (this.currentBucket + 1) % this.ageBuckets;
    this.ringBuckets[this.currentBucket].clear();
    this.setDirty();
    // 定期执行轮转操作，将当前桶索引递增并清空对应桶的数据，用于定期清理数据
    this.rotateTimer = setTimeout(() => this.rotate(), (this.maxAgeSeconds / this.ageBuckets) * 1000);
    this.rotateTimer.unref();
  }

  /**
   * 添加一个值进入当前的桶
   */
  public add(value: number) {
    this.setDirty();
    this.ringBuckets[this.currentBucket].add(value);
  }

  public dispose() {
    if (this.rotateTimer) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
  }

  /**
   * 生成当前桶的快照
   */
  public snapshot() {
    if (!this.dirty && this.lastSnapshot) return this.lastSnapshot;

    const samples = this.ringBuckets.reduce((a, b) => a.concat(b.samples), [] as number[]);
    // 按值大小顺序排序
    samples.sort((a, b) => a - b);
    // 计算平均值
    const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
    let variance: number | null = null;

    if (mean) {
      variance =
        samples.length > 1 ? samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (samples.length - 1) : null;
    }
    const stdDev = variance ? Math.sqrt(variance) : null;

    this.lastSnapshot = {
      min: samples.length ? samples[0] : null,
      mean,
      variance,
      stdDev,
      max: samples.length ? samples[samples.length - 1] : null,
      quantiles: this.quantiles.reduce((a, q) => setProp(a, q, samples[Math.ceil(q * samples.length) - 1]), {})
    };

    this.clearDirty();

    return this.lastSnapshot;
  }
}
