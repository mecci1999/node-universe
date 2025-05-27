import BaseReporter from './base';
import _ from 'lodash';
import dgram from 'dgram';
import METRIC from '../constants';

export default class StatsdReporter extends BaseReporter {
  private defaultLabels: object = {};

  constructor(options: any) {
    super(options);

    this.options = _.defaultsDeep(this.options, {
      host: 'localhost',
      port: 8125, // statsd 默认端口
      maxPayloadSize: 1300 // statsd 最大 UDP 包大小
    });
  }

  // 初始化
  public init(registry: any) {
    super.init(registry);

    this.flush();
  }

  /**
   * Convert labels to StatsD label string
   *
   * @param {Object} itemLabels
   * @returns {String}
   *
   * @memberof StatsDReporter
   */
  private labelsToTags(itemLabels: object): string {
    const labels = Object.assign({}, this.defaultLabels || {}, itemLabels || {});
    const keys = Object.keys(labels);
    if (keys.length == 0) return '';

    return keys.map((key) => `${this.formatLabelName(key)}:${this.escapeLabelValue(labels[key])}`).join(',');
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
   * 生成指标数据
   *
   * @returns {Array<Object>}
   * @memberof StatsDReporter
   */
  private generateStatsDSeries(): Array<any> {
    const series: string[] = [];

    const list =
      this.registry?.list({
        types: this.options.types,
        includes: this.options.includes,
        excludes: this.options.excludes
      }) || [];

    list.forEach((metric) => {
      metric.values.forEach((item) => {
        const line = this.generateStatDLine(metric, item);
        if (line) series.push(line);
      });
    });

    return series;
  }

  private generateStatDLine(metric, item, lastValue = null): any {
    // 格式化度量名称
    const metricName = this.formatMetricName(metric.name);

    switch (metric.type) {
      case METRIC.TYPE_COUNTER: {
        // 生成计数器类型的统计行
        let line = `${metricName}:${item.value}|c`;
        // 如果度量标签名称数组长度大于0，则将标签添加到行中
        if (metric.labelNames.length > 0) line += '|#' + this.labelsToTags(item.labels);
        return line;
      }
      case METRIC.TYPE_GAUGE: {
        // 生成仪表盘类型的统计行
        let line = `${metricName}:${item.value}|g`;
        // 如果度量标签名称数组长度大于0，则将标签添加到行中
        if (metric.labelNames.length > 0) line += '|#' + this.labelsToTags(item.labels);
        return line;
      }
      case METRIC.TYPE_INFO: {
        // 生成信息类型的统计行
        let line = `${metricName}:${typeof item.value == 'number' ? item.value : '"' + item.value + '"'}|s`;
        // 如果度量标签名称数组长度大于0，则将标签添加到行中
        if (metric.labelNames.length > 0) line += '|#' + this.labelsToTags(item.labels);
        return line;
      }
      case METRIC.TYPE_HISTOGRAM: {
        // 生成直方图类型的统计行
        if (lastValue != null) {
          let line = `${metricName}:${lastValue}|ms`;
          // 如果度量标签名称数组长度大于0，则将标签添加到行中
          if (metric.labelNames.length > 0) line += '|#' + this.labelsToTags(item.labels);
          return line;
        }
      }
    }
  }

  /**
   * 发送指标数据
   */
  public flush() {
    const series = this.generateStatsDSeries();

    if (series.length == 0) return;

    this.sendChunks(series);
  }

  /**
   * 发送数据串
   */
  private sendChunks(series: Array<any>) {
    let len = 0;

    const chunks: any[] = [];

    while (series.length > 0 && (!this.options.maxPayloadSize || len < this.options.maxPayloadSize)) {
      const item = series.shift();
      chunks.push(item);
      len += item.length;
    }

    if (chunks.length > 0) {
      this.send(Buffer.from(chunks.join('\n')));
    }

    if (series.length > 0) {
      setTimeout(() => this.sendChunks(series), 100);
    }
  }

  /**
   * 通过 UDP 协议将合并后的数据发送到 StatsD 服务器
   *
   * @param {Buffer} buf
   */
  private send(buf: any) {
    //this.logger.info("Buffer\n" + buf.toString());
    const sock = dgram.createSocket('udp4');
    sock.send(buf, 0, buf.length, this.options.port, this.options.host, (err, bytes) => {
      if (err) {
        this.logger?.warn('Unable to send metrics to StatsD server. Error:' + err.message, err);
      } else {
        this.logger?.debug('Metrics are uploaded to StatsD. Sent bytes:', bytes);
      }

      sock.close();
    });
  }

  /**
   * 指标数据变化
   *
   * @param {BaseMetric} metric
   * @param {any} value
   * @param {Object} labels
   * @param {Number?} timestamp
   *
   * @memberof BaseReporter
   */
  public metricChanged(metric, value, labels) {
    if (!this.matchMetricName(metric.name)) return;

    const line = this.generateStatDLine(metric, metric.get(labels), value);
    if (line) {
      this.send(Buffer.from(line));
    }
  }
}
