/**
 * 使用 DataDog 格式的 Reporter
 * @see  DataDog 格式的 Reporter
 * @see https://www.datadoghq.com/
 */
import BaseReporter from './base';
import _ from 'lodash';
import METRIC from '../constants';
import os from 'os';
import fetch from 'node-fetch';
import { UniverseError } from '@/lib/error';
import { isFunction } from '@/utils';

const BASE_URL = 'https://api.datadoghq.com/api/';

export default class DataDogReporter extends BaseReporter {
  private timer: any = null;
  private defaultLabels: object = {};

  constructor(options: any) {
    super(options);

    this.options = _.defaultsDeep(this.options, {
      host: os.hostname(),
      baseUrl: BASE_URL,
      apiVersion: 'v1',
      path: '/series',
      apiKey: process.env.DATADOG_API_KEY,
      //appKey: process.env.DATADOG_APP_KEY,
      defaultLabels: (registry) => ({
        namespace: registry.broker.namespace,
        nodeID: registry.broker.nodeID
      }),
      interval: 10
    });

    if (!this.options.apiKey)
      throw new UniverseError('Datadog API key is missing. Set DATADOG_API_KEY environment variable.');
  }

  /**
   * 初始化
   */
  public init(registry: any) {
    super.init(registry);

    if (this.options.interval > 0) {
      this.timer = setInterval(() => this.flush(), this.options.interval * 1000);
      this.timer.unref();
    }

    this.defaultLabels = isFunction(this.options.defaultLabels)
      ? this.options.defaultLabels.call(this, registry)
      : this.options.defaultLabels;
  }

  /**
   * 发送数据
   */
  public flush() {
    const series = this.generateDatadogSeries();

    if (series.length == 0) return;

    return fetch(
      `${this.options.baseUrl}${this.options.apiVersion}${this.options.path}?api_key=${this.options.apiKey}`,
      {
        method: 'post',
        body: JSON.stringify({ series }),
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
      .then((res) => {
        this.logger?.debug('Metrics are uploaded to DataDog. Status: ', res.statusText);
      })
      .catch((err) => {
        /* istanbul ignore next */
        this.logger?.warn('Unable to upload metrics to Datadog server. Error:' + err.message, err);
      });
  }

  /**
   * 停止采集指标
   *
   * @memberof DatadogReporter
   */
  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return Promise.resolve();
  }

  /**
   * Escape label value characters.
   * @param {String} str
   * @returns {String}
   * @memberof DatadogReporter
   */
  private escapeLabelValue(str) {
    if (typeof str == 'string') return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return str;
  }

  /**
   * Convert labels to Prometheus label string
   *
   * @param {Object} itemLabels
   * @returns {Array<String>}
   *
   * @memberof DatadogReporter
   */
  private labelsToTags(itemLabels) {
    const labels = Object.assign({}, this.defaultLabels || {}, itemLabels || {});
    const keys = Object.keys(labels);
    if (keys.length == 0) return [];

    return keys.map((key) => `${this.formatLabelName(key)}:${this.escapeLabelValue(labels[key])}`);
  }

  private posixTimestamp(time: number) {
    return time != null ? Math.floor(time / 1000) : undefined;
  }

  /**
   * 生成 Datadog 格式的指标数据
   *
   * @returns
   */
  private generateDatadogSeries() {
    const series: any[] = [];

    const now = this.posixTimestamp(Date.now());

    this.registry?.store.forEach((metric) => {
      // Filtering
      if (!this.matchMetricName(metric.name)) return;
      // Skip datetime metrics (register too much labels)
      if (metric.name.startsWith('os.datetime')) return;

      /* More info: https://docs.datadoghq.com/api/?lang=bash#post-timeseries-points

				metric [required]:
					The name of the timeseries
				type [optional, default=gauge]:
					Type of your metric either: gauge, rate, or count
				interval [optional, default=None]:
					If the type of the metric is rate or count, define the corresponding interval.
				points [required]:
					A JSON array of points. Each point is of the form:
					[[POSIX_timestamp, numeric_value], ...]
					Note: The timestamp should be in seconds, current, and its format should be a 32bit float gauge-type value. Current is defined as not more than 10 minutes in the future or more than 1 hour in the past.
				host [optional]:
					The name of the host that produced the metric.
				tags [optional, default=None]:
					A list of tags associated with the metric.
			*/

      const snapshot = metric.snapshot() || [];
      if (snapshot.length == 0) return;

      switch (metric.type) {
        case METRIC.TYPE_COUNTER:
        case METRIC.TYPE_GAUGE: {
          snapshot.forEach((item: any) => {
            series.push({
              metric: this.formatMetricName(metric.name),
              type: 'gauge',
              points: [[now, item.value]],
              tags: this.labelsToTags(item.labels),
              host: this.options.host
            });
          });

          break;
        }
        /*case METRIC.TYPE_INFO: {
					series.push(`# HELP ${metricName} ${metricDesc}`);
					series.push(`# TYPE ${metricName} gauge`);
					snapshot.forEach(item => {
						const labelStr = this.labelsToStr(item.labels, { value: item.value });
						series.push(`${metricName}${labelStr} 1`);
					});
					series.push("");

					break;
				}*/
        case METRIC.TYPE_HISTOGRAM: {
          snapshot.forEach((item: any) => {
            if (item.buckets) {
              Object.keys(item.buckets).forEach((le) => {
                series.push({
                  metric: this.formatMetricName(metric.name + '.bucket_' + le),
                  type: 'rate',
                  points: [[now, item.buckets[le]]],
                  tags: this.labelsToTags(item.labels),
                  host: this.options.host
                });
              });
              // +Inf
              series.push({
                metric: this.formatMetricName(metric.name + '.bucket_inf'),
                type: 'rate',
                points: [[now, item.count]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });
            }

            if (item.quantiles) {
              Object.keys(item.quantiles).forEach((key) => {
                series.push({
                  metric: this.formatMetricName(metric.name + '.q' + key),
                  type: 'rate',
                  points: [[now, item.quantiles[key]]],
                  tags: this.labelsToTags(item.labels),
                  host: this.options.host
                });
              });

              // Add other calculated values
              series.push({
                metric: this.formatMetricName(metric.name + '.sum'),
                type: 'rate',
                points: [[now, item.sum]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.count'),
                type: 'rate',
                points: [[now, item.count]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.min'),
                type: 'rate',
                points: [[now, item.min]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.mean'),
                type: 'rate',
                points: [[now, item.mean]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.variance'),
                type: 'rate',
                points: [[now, item.variance]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.stddev'),
                type: 'rate',
                points: [[now, item.stdDev]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });

              series.push({
                metric: this.formatMetricName(metric.name + '.max'),
                type: 'rate',
                points: [[now, item.max]],
                tags: this.labelsToTags(item.labels),
                host: this.options.host
              });
            }
          });
          break;
        }
      }
    });

    return series;
  }
}
