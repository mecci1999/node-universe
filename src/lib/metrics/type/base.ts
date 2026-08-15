import { BaseMetricOptions, MetricSnapshot } from '@/typings/metric';
import MetricRegistry from '../registry';
import { GenericObject } from '@/typings';

export default class BaseMetric {
  public type: string; // 指标类型
  public registry: MetricRegistry;
  public name: string; // 指标名
  public description: string; // 指标描述
  public labelNames: string[];
  public unit: string;
  public aggregator: string;
  public lastSnapshot: Array<MetricSnapshot> | null;
  public dirty: boolean;
  public values: Map<string, GenericObject>;

  constructor(options: BaseMetricOptions, registry: MetricRegistry) {
    this.registry = registry;
    this.type = options.type;
    this.name = options.name;
    this.description = options.description || '';
    this.labelNames = options.labelNames || [];
    this.unit = options.unit || '';
    this.aggregator = options.aggregator || registry.options.defaultAggregator || '';
    this.lastSnapshot = null;
    this.dirty = true;
    this.values = new Map();
  }

  /**
   * 改变dirty
   */
  public setDirty() {
    this.dirty = true;
  }

  /**
   * 清除dirty
   */
  public clearDirty() {
    this.dirty = false;
  }

  /**
   * 通过lables获取指标信息
   */
  public get(labels: GenericObject) {
    const hash = this.hashingLabels(labels);

    return this.values.get(hash);
  }

  /**
   * 设置指标信息
   */
  public set(value: number | string, labels?: GenericObject, timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 重置数据
   */
  public reset(labels?: GenericObject, timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 重置所有的数据
   */
  public resetAll(timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 清除指标值
   */
  public clear() {
    this.disposeValues();
    this.values = new Map();
    this.changed(null);
  }

  public dispose() {
    this.disposeValues();
  }

  protected disposeValues() {
    this.values.forEach((item) => {
      item.rate?.dispose();
      item.quantileValues?.dispose();
    });
  }

  /**
   * hash处理Labels信息，用来作为key值
   */
  public hashingLabels(labels?: GenericObject) {
    if (this.labelNames.length === 0 || labels == null || typeof labels !== 'object') return '';

    const parts: Array<string | number> = [];
    for (let i = 0; i < this.labelNames.length; i++) {
      const v = labels[this.labelNames[i]];

      if (typeof v === 'number') {
        parts.push(v);
      } else if (typeof v === 'string') {
        parts.push('"' + v + '"');
      } else if (typeof v === 'boolean') {
        parts.push('' + v);
      } else {
        parts.push('');
      }
    }

    return parts.join('|');
  }

  /**
   * 指标改变
   */
  public changed(value: any | null, labels?: any, timestamp?: number) {
    this.setDirty();
    this.registry.changed(this, value, labels, timestamp);
  }

  /**
   * 获得快照
   */
  public snapshot(): MetricSnapshot[] | null {
    if (!this.dirty && this.lastSnapshot) return this.lastSnapshot;

    this.lastSnapshot = this.generateSnapshot();
    this.clearDirty();

    return this.lastSnapshot;
  }

  /**
   * 自增
   */
  public increment(labels?: GenericObject, value?: number, timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 自减
   */
  public decrement(labels?: GenericObject, value?: number, timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 监控
   */
  public observe(value: number, labels?: GenericObject, timestamp?: number) {
    throw new Error('Not implemented');
  }

  /**
   * 生成快照
   */
  public generateSnapshot(): any {
    throw new Error('Not implemented');
  }

  /**
   * 导出一个POJO
   */
  public toObject() {
    return {
      type: this.type,
      name: this.name,
      description: this.description,
      labelNames: this.labelNames,
      unit: this.unit,
      values: this.snapshot()
    };
  }
}
