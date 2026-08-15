import { MetricsReporterOptions } from '@/typings/metric';
import BaseReporter from './base';
import _ from 'lodash';
import kleur from 'kleur';
import MetricRegistry from '../registry';
import { GenericObject } from '@/typings';
import { isFunction } from '@/utils';
import BaseMetric from '../type/base';
import METRIC from '../constants';

export default class ConsoleReporter extends BaseReporter {
  public lastChanges: Set<string>;
  public timer: NodeJS.Timeout | null = null;

  constructor(options: MetricsReporterOptions) {
    super(options);

    this.options = _.defaultsDeep(this.options, {
      interval: 5,
      logger: null,
      colors: true,
      onlyChanges: true
    });

    if (!this.options.colors) kleur.enabled = false;

    this.lastChanges = new Set();
  }

  public init(registry: MetricRegistry): void {
    super.init(registry);

    if (this.options.interval > 0) {
      this.timer = setInterval(() => this.print(), this.options.interval * 1000);
    }
  }

  public stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return Promise.resolve();
  }

  /**
   * 将标签名转换为字符串
   */
  private labelToStr(labels: GenericObject) {
    const keys = Object.keys(labels);
    if (keys.length === 0) return kleur.gray('{}');

    return (
      kleur.gray('{') +
      keys.map((key) => `${kleur.gray(this.formatLabelName(key))}: ${kleur.magenta('' + labels[key])}`).join(', ') +
      kleur.gray('}')
    );
  }

  /**
   * 指标数据打印方法
   */
  public print() {
    let list = this.registry?.list({
      includes: this.options.includes,
      excludes: this.options.excludes
    });

    if (this.options.onlyChanges) {
      list = list?.filter((metric) => this.lastChanges.has(metric.name));
    }

    if (list?.length === 0) return;

    this.log(kleur.gray(`------------------- [ METRICS START (${list?.length}) ] -------------------`));

    list?.forEach((metric) => {
      this.log(kleur.cyan().bold(this.formatMetricName(metric.name)) + ' ' + kleur.gray('(' + metric.type + ')'));
      if (metric.values.size === 0) {
        this.log(kleur.gray(' <no values>'));
      } else {
        const unit = metric.unit ? kleur.gray(this.registry?.pluralizeUnit(metric.unit) || '') : '';
        metric.values.forEach((item) => {
          let val: string;
          const labelStr = this.labelToStr(item.labels);

          switch (metric.type) {
            case METRIC.TYPE_COUNTER:
            case METRIC.TYPE_GAUGE:
            case METRIC.TYPE_INFO: {
              val = item.value === '' ? kleur.grey('<empty string>') : kleur.green().bold(item.value);
              if (item.rate != null) {
                val =
                  val + kleur.grey(' | Rate: ') + (item.rate != null ? kleur.green().bold(item.rate.toFixed(2)) : '-');
              }
              break;
            }

            case METRIC.TYPE_HISTOGRAM: {
              const s: string[] = [];
              s.push(`Count: ${item.count}`);

              if (item.buckets) {
                Object.keys(item.buckets).forEach((bucket) => {
                  s.push(`${bucket}: ${item.buckets[bucket] != null ? item.buckets[bucket] : '-'}`);
                });
              }

              if (item.quantiles) {
                s.push(`Min: ${item.min != null ? item.min.toFixed(2) : '-'}`);
                s.push(`Mean: ${item.mean != null ? item.mean.toFixed(2) : '-'}`);
                s.push(`Var: ${item.variance != null ? item.variance.toFixed(2) : '-'}`);
                s.push(`StdDev: ${item.stdDev != null ? item.stdDev.toFixed(2) : '-'}`);
                s.push(`Max: ${item.max != null ? item.max.toFixed(2) : '-'}`);

                Object.keys(item.quantiles).forEach((key) => {
                  s.push(`${key}: ${item.quantiles[key] != null ? item.quantiles[key].toFixed(2) : '-'}`);
                });
              }

              if (item.rate != null) {
                s.push(`Rate: ${item.rate != null ? item.rate.toFixed(2) : '-'}`);
              }

              val = kleur.green().bold(s.join(' | '));

              break;
            }
          }
        });
      }

      this.log('');
    });

    this.log(kleur.gray(`-------------------- [ METRICS END (${list?.length}) ] --------------------`));

    this.lastChanges.clear();
  }

  /**
   * 日志打印
   */
  private log(...args: any) {
    if (isFunction(this.options.logger)) {
      return this.options.logger(...args);
    } else {
      return this.logger?.info(...args);
    }
  }

  public metricChanged(metric: BaseMetric, value: any, labels?: GenericObject, timestamp?: number): void {
    if (!this.matchMetricName(metric.name)) return;

    this.lastChanges.add(metric.name);
  }
}
