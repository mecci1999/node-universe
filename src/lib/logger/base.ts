/**
 * 日志模块中的基础类
 */
import _ from 'lodash';
import { isObject, isString, matchActionOrEvent } from '@/utils/index';
import { BaseLoggerLevels } from '@/typings/logger';
import { LoggerFactory } from './factory';
import { GenericObject } from '@/typings';

// 日志模块分类
export const LEVELS: BaseLoggerLevels[] = [
  BaseLoggerLevels.fatal, // 崩溃
  BaseLoggerLevels.error, // 错误
  BaseLoggerLevels.warn, // 警告
  BaseLoggerLevels.info, // 信息
  BaseLoggerLevels.debug, // debug
  BaseLoggerLevels.trace // 跟踪
];

// 基础类
export default class BaseLogger {
  // 选项
  public options: GenericObject;
  public Promise: any;
  // 日志工厂实例
  public loggerFactory: any;
  // 微服务对象
  public star: any;

  constructor(options: GenericObject) {
    this.options = _.defaultsDeep(options, { level: BaseLoggerLevels.info, createLogger: null });
  }

  // 初始化
  public init(loggerFactory: LoggerFactory) {
    this.loggerFactory = loggerFactory;
    this.star = loggerFactory.star;
  }

  // 停止日志写入
  public stop() {
    return Promise.resolve();
  }

  // 获取日志类型
  public getLogLevel(mod: string): BaseLoggerLevels | null {
    const logMod = mod ? mod.toUpperCase() : '';
    const level = this.options.level;

    // 字符串
    if (isString(level)) return level as BaseLoggerLevels;

    // 对象
    if (isObject(level)) {
      if (level[logMod]) return level[logMod] as BaseLoggerLevels;

      const key = Object.keys(level).find((item) => matchActionOrEvent(logMod, item) && item !== '**');
      if (key) return level[key];
      else if (level['**']) {
        return level['**'];
      }
    }

    return null;
  }

  public getLogHandler(bindings: GenericObject) {
    return null;
  }
}
