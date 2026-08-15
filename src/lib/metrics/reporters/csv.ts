import { MetricReporterOptions } from '@/typings/metric';
import { makeDirs } from '@/utils';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import METRIC from '../constants';
import MetricRegistry from '../registry';
import BaseReporter from './base';

const MODE_METRIC = 'metric';
const MODE_LABEL = 'label';

export default class CSVReporter extends BaseReporter {
  public lastChanges: Set<any>;
  public timer: NodeJS.Timeout | null = null;
  public folder: string = '';

  constructor(options: MetricReporterOptions) {
    super(options);

    this.options = _.defaultsDeep(this.options, {
      folder: './reports/metrics',
      delimiter: ',',
      rowDelmiter: '\n',
      mode: MODE_METRIC,
      types: null,
      interval: 5,
      filenameFormatter: null,
      rowFormatter: null
    });

    this.lastChanges = new Set();
  }

  public init(registry: MetricRegistry): void {
    super.init(registry);

    if (this.options.interval > 0) {
      this.timer = setInterval(() => this.flush(), this.options.interval * 1000);
      this.timer.unref();
    }

    this.folder = path.resolve(this.options.folder);
    makeDirs(this.folder);
  }

  public stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return Promise.resolve();
  }

  /**
   * 将标签对象转换为标签字符串
   * @param {Object} labels
   * @returns {String}
   * @memberof CSVReporter
   */
  public labelsToStr(labels: object): string {
    if (labels == null) return '';

    const keys = Object.keys(labels);
    if (keys.length === 0) return '';

    return keys
      .map((key) => `${this.formatLabelName(key)}=${labels[key]}`)
      .join('--')
      .replace(/[\s]/g, '_')
      .replace(/[|&:;$%@"<>()+,/?]/g, '');
  }

  /**
   * 获取指标的文件名
   * @param {*} metric
   * @param {*} item
   */
  public getFilename(metric, item) {
    const metricName = this.formatMetricName(metric.name);
    if (this.options.filenameFormatter) return this.options.filenameFormatter.call(this, metricName, metric, item);

    switch (this.options.mode) {
      case MODE_METRIC: {
        return path.join(this.folder, `${metricName}.csv`);
      }
      case MODE_LABEL: {
        const labelStr = this.labelsToStr(item.labels);
        return path.join(this.folder, metricName, `${metricName}${labelStr ? '--' + labelStr : ''}.csv`);
      }
    }
  }

  /**
   * Write a row in CSV file
   * @param {String} filename
   * @param {Array<String>} fields
   */
  public writeRow(filename: string, headers: string[], fields: string[]): void {
    try {
      if (!fs.existsSync(filename))
        fs.writeFileSync(filename, headers.join(this.options.delimiter) + this.options.rowDelimiter);

      fs.appendFileSync(filename, fields.join(this.options.delimiter) + this.options.rowDelimiter);
    } catch (err: any) {
      /* istanbul ignore next */
      this.logger?.error(
        `Unable to write metrics values to the '${filename}' file. Error: ${err.message}`,
        fields,
        err
      );
    }
  }

  /**
   * 将指标写入文件中
   */
  public flush() {
    const list =
      this.registry?.list({
        types: this.options.types,
        includes: this.options.includes,
        excludes: this.options.excludes
      }) || [];

    if (list.length == 0) return;

    this.logger?.debug('Write metrics values to CSV files...');

    list.forEach((metric) => {
      metric.values.forEach((item) => {
        // Is it changed?
        if (!this.lastChanges.has([metric.name, this.labelsToStr(item.labels)].join('|'))) return;

        const filename = this.getFilename(metric, item);
        makeDirs(path.dirname(filename));
        const metricName = this.formatMetricName(metric.name);

        let headers = ['Timestamp', 'Metric'];
        let data = [item.timestamp, metricName];

        metric.labelNames.forEach((label) => {
          headers.push('Label ' + label);
          data.push(item.labels[label] != null ? item.labels[label].toString() : '');
        });

        switch (metric.type) {
          case METRIC.TYPE_COUNTER:
          case METRIC.TYPE_GAUGE:
          case METRIC.TYPE_INFO: {
            if (item.value == null) return;

            headers.push('Value');
            data.push(item.value.toString());

            break;
          }
          case METRIC.TYPE_HISTOGRAM: {
            headers.push('Count');
            data.push(item.count);
            headers.push('Sum');
            data.push(item.sum);

            if (item.buckets) {
              Object.keys(item.buckets).forEach((b) => {
                headers.push(`Bucket_${b}`);
                data.push(item.buckets[b]);
              });
            }

            if (item.quantiles) {
              headers.push('Min');
              data.push(item.min);
              headers.push('Mean');
              data.push(item.mean);
              headers.push('Var');
              data.push(item.variance);
              headers.push('StdDev');
              data.push(item.stdDev);
              headers.push('Max');
              data.push(item.max);

              Object.keys(item.quantiles).forEach((key) => {
                headers.push(`Quantile_${key}`);
                data.push(item.quantiles[key]);
              });
            }

            break;
          }
        }

        if (this.options.rowFormatter) this.options.rowFormatter.call(this, data, headers, metric, item);

        this.writeRow(filename, headers, data);
      });
    });

    this.lastChanges.clear();
  }

  /**
   * 指标发生变化
   * @param {BaseMetric} metric
   * @param {any} value
   * @param {Object} labels
   * @param {Number?} timestamp
   *
   * @memberof BaseReporter
   */
  public metricChanged(metric, value, labels) {
    /* istanbul ignore next */
    if (!this.matchMetricName(metric.name)) return;

    this.lastChanges.add([metric.name, this.labelsToStr(labels)].join('|'));
  }
}
