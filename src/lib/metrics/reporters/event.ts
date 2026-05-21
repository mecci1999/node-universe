import { MetricReporterOptions } from '@/typings/metric';
import BaseReporter from './base';
import _ from 'lodash';
import MetricRegistry from '../registry';
import { GenericObject } from '@/typings';
import BaseMetric from '../type/base';

export default class EventRepoter extends BaseReporter {
  public lastChanges: Set<any>;
  public timer: NodeJS.Timer | null = null;

  constructor(options: MetricReporterOptions) {
    super(options);

    this.options = _.defaultsDeep(this.options, {
      eventName: '$metrics.snapshot',
      broadcast: false,
      groups: null,
      onlyChanges: false,
      interval: 5 // 计时器触发时间间隔，默认5秒
    });

    this.lastChanges = new Set();
  }

  /**
   * 初始化
   */
  public init(registry: MetricRegistry): void {
    super.init(registry);

    if (this.options.interval) {
      this.timer = setInterval(() => this.sendEvent(), this.options.interval * 1000);
      this.timer.unref();
    }
  }

  /**
   * 发送指标快照事件
   */
  public sendEvent() {
    let list = this.registry?.list({
      includes: this.options.includes,
      excludes: this.options.excludes
    });

    if (this.options.onlyChanges) {
      list = list?.filter((metric) => this.lastChanges.has(metric.name));
    }

    if (list?.length === 0) return;

    if (this.options.broadcast) {
      // 使用广播进行通信
      // this.logger?.debug(`Send metrics.snapshot (${list?.length} metrics) broadcast events.`);
      this.star?.broadcast(this.options.eventName, list, { groups: this.options.groups });
    } else {
      // 使用事件通讯进行通信
      // this.logger?.debug(`Send metrics.snapshot (${list?.length} metrics) events.`);
      this.star?.emit(this.options.eventName, list, { groups: this.options.groups });
    }

    this.lastChanges.clear();
  }

  public metricChanged(
    metric: BaseMetric,
    value: any,
    labels?: GenericObject | undefined,
    timestamp?: number | undefined
  ): void {
    if (!this.matchMetricName(metric.name)) return;

    this.lastChanges.add(metric.name);
  }
}
