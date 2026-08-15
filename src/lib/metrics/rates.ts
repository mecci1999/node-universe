import { GenericObject } from '@/typings';
import BaseMetric from './type/base';

const INTERVAL = 5; // 更新间隔时长
const SECONDS_PER_MINUTE = 60.0; // 每分钟60秒

export default class MetricRate {
  public metric: BaseMetric;
  public item: GenericObject;
  public min: number;
  public rate: number;
  public lastValue: number;
  public lastTickTime: number;
  public timer: NodeJS.Timeout | null;
  public value: any;

  constructor(metric: BaseMetric, item: GenericObject, min: number) {
    this.metric = metric;
    this.item = item;
    this.min = min;
    this.rate = 0;
    this.lastValue = 0;
    this.lastTickTime = Date.now();
    this.value = null;
    this.timer = setInterval(() => this.tick(), INTERVAL * 1000);
    this.timer.unref();
  }

  public update(value: any) {
    this.value = value;
  }

  /**
   * 计算数据
   */
  public tick() {
    const now = Date.now();
    // 间隔时间
    const elapsedSec = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    // 价值差值
    const diff = this.value - this.lastValue;
    this.lastValue = this.value;

    // 每分钟比值
    const oneMinRate = (diff / elapsedSec) * SECONDS_PER_MINUTE;

    let rate = this.rate + (oneMinRate - this.rate) * 0.5;

    if (Math.abs(rate) < 0.05) rate = 0;

    const changed = Math.abs(rate - this.rate) > 0.01;

    this.rate = rate;

    if (changed) this.metric.changed(this.item.value, this.item.labels, now);
  }

  /**
   * 重置参数
   */
  public reset() {
    this.lastValue = 0;
    this.value = null;
    this.rate = 0;
  }

  public dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
