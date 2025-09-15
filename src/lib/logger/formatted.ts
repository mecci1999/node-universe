import util from 'util';
import _ from 'lodash';
import kleur from 'kleur';
import { isObject, isFunction } from '@/utils/index';
import BaseLogger, { LEVELS } from './base';
import { BaseLoggerLevels } from '@/typings/logger';
import { GenericObject } from '@/typings';
import { LoggerFactory } from './factory';
import { FormattedLoggerOptions } from '@/typings/logger/index';
import { getMilliseconds } from '@/utils';

export function getColor(type: BaseLoggerLevels) {
  switch (type) {
    case BaseLoggerLevels.fatal:
      return kleur.red().inverse;
    case BaseLoggerLevels.error:
      return kleur.red;
    case BaseLoggerLevels.warn:
      return kleur.yellow;
    case BaseLoggerLevels.debug:
      return kleur.magenta;
    case BaseLoggerLevels.trace:
      return kleur.gray;
    case BaseLoggerLevels.info:
      return kleur.green;
    default:
      return kleur.green;
  }
}

export default class FormattedLogger extends BaseLogger {
  public options: GenericObject | FormattedLoggerOptions = {};
  public maxPrefixLength: number = 0;
  public objectPrinter: any;
  public levelColorStr: object = {};

  constructor(options: GenericObject | FormattedLoggerOptions) {
    super(options);

    this.options = _.defaultsDeep(this.options, options, {
      colors: true,
      moduleColors: false,
      formatter: 'full',
      objectPrinter: null,
      autoPadding: false
    });
    this.maxPrefixLength = 0;
  }

  /**
   * init
   * 初始化
   */
  public init(loggerFactory: LoggerFactory) {
    super.init(loggerFactory);

    if (!this.options.colors) kleur.enabled = false; // 禁止颜色输出
    // 对象输出打印方法
    this.objectPrinter = this.options.objectPrinter
      ? this.options.objectPrinter
      : (object: any) =>
          util.inspect(object, {
            showHidden: false,
            depth: 2,
            colors: kleur.enabled,
            breakLength: Number.POSITIVE_INFINITY
          });
    // 获取日志级别对应的颜色
    this.levelColorStr = LEVELS.reduce((err, level) => {
      err[level] = getColor(level)(_.padEnd(level.toUpperCase(), 5));
      return err;
    }, {});
    if (this.options.colors && this.options.moduleColor === true) {
      this.options.moduleColor = [
        'yellow',
        'bold.yellow',
        'cyan',
        'bold.cyan',
        'green',
        'bold.green',
        'magenta',
        'bold.magenta',
        'blue',
        'bold.blue'
        /*"red",*/
        /*"grey",*/
        /*"white,"*/
      ];
    }
  }

  // 获取模块对应的颜色
  public getNextColor(mod: string): string {
    if (this.options.colors && Array.isArray(this.options.moduleColor)) {
      let hash = 0; // 哈希值
      for (let i = 0; i < mod.length; i++) {
        hash = (hash << 5) - hash + mod.charCodeAt(i);
        hash |= 0; // 强制转换为32位有符号整数，如果 hash 不是 32 位有符号整数，可能会导致位运算结果不正确。
      }

      return this.options.moduleColor[Math.abs(hash) % this.options.moduleColor.length];
    }

    return 'grey';
  }

  public padLeft(len: number) {
    if (this.options.autoPadding) return ' '.repeat(this.maxPrefixLength - len);

    return '';
  }

  public render(str: string, obj: any): string {
    return str.replace(/\{\s?(\w+)\s?\}/g, (match, v) => obj[v] || '');
  }

  public getFormatter(bindings: GenericObject) {
    const formatter = this.options.formatter;

    const mod = bindings && bindings.mod ? bindings.mod.toUpperCase() : '';
    const color = this.getNextColor(mod);
    const modColorName = color.split('.').reduce((a: any, b: any) => a[b] || a()[b], kleur)(mod); // 颜色名
    const moduleColorName = bindings ? kleur.grey(bindings.nodeID + '/') + modColorName : '';
    // 将对象输出为JSON格式
    const printArgs = (args: Array<any>) => {
      return args.map((p) => {
        if (isObject(p) || Array.isArray(p)) return this.objectPrinter(p);
        return p;
      });
    };
    if (isFunction(formatter)) {
      return (type: BaseLoggerLevels, args: any) => formatter.call(this, type, args, bindings, { printArgs });
    } else if (formatter === 'json') {
      // {"timestamp":1581243299731,"level":"info","msg":"Universe is creating...","nodeID":"console","namespace":"","mod":"star"}
      kleur.enabled = false;
      return (type: BaseLoggerLevels, args: any) => [
        JSON.stringify({ time: Date.now(), level: type, msg: printArgs(args).join(' '), ...bindings })
      ];
    } else if (formatter === 'jsonext') {
      // {"time":"2020-02-09T10:44:35.285Z","level":"info","message":"Universe is creating...","nodeID":"console","namespace":"","mod":"star"}
      return (type: BaseLoggerLevels, args: any) => {
        const timestamp = `${new Date().toLocaleString('zh-CN', { hour12: false })}:${getMilliseconds()}`;
        const res = {
          time: timestamp,
          level: type,
          message: '',
          ...bindings
        };
        if (args.length > 0) {
          if (typeof args[0] == 'object') {
            Object.assign(res, args[0]);
            res.message = printArgs(args.slice(1)).join(' ');
          } else {
            res.message = printArgs(args).join(' ');
          }
        }

        return [JSON.stringify(res)];
      };
    } else if (formatter === 'simple') {
      // INFO  - Universe is creating...
      return (type: BaseLoggerLevels, args: any) => [this.levelColorStr[type], '-', ...printArgs(args)];
    } else if (formatter === 'short') {
      // [08:42:12.973Z] INFO STAR: Universe is creating...
      const prefixLen = 23 + bindings.mod.length;
      this.maxPrefixLength = Math.max(prefixLen, this.maxPrefixLength);
      return (type: BaseLoggerLevels, args: any) => [
        kleur.grey(`[${new Date().toDateString().substring(11)}]`),
        this.levelColorStr[type],
        modColorName + this.padLeft(prefixLen) + kleur.grey(':'),
        ...printArgs(args)
      ];
    } else if (formatter === 'full') {
      // [2019-08-31T08:40:53.481Z] INFO STAR: Universe is creating...
      const prefixLen = 35 + bindings.nodeID.length + bindings.mod.length;
      this.maxPrefixLength = Math.max(prefixLen, this.maxPrefixLength);

      return (type: BaseLoggerLevels, args: any) => [
        kleur.grey(`[${new Date().toLocaleString('zh-CN', { hour12: false })}:${getMilliseconds()}]`),
        this.levelColorStr[type],
        modColorName + this.padLeft(prefixLen) + kleur.grey(':'),
        ...printArgs(args)
      ];
    } else {
      // [{timestamp}] {level} {nodeID}/{mod}: {msg}
      return (type: BaseLoggerLevels, args: any) => {
        const timestamp = `${new Date().toLocaleString('zh-CN', { hour12: false })}:${getMilliseconds()}`;

        return [
          this.render(formatter, {
            timestamp: kleur.grey(timestamp),
            time: kleur.grey(timestamp.substring(11)),
            level: this.levelColorStr[type],
            nodeID: kleur.grey(bindings.nodeID),
            mod: modColorName,
            msg: printArgs(args).join(' ')
          })
        ];
      };
    }
  }
}
