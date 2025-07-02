import { LogLevelConfig, LoggerBindings } from '@/typings/logger';
import Star from '../star';
import Loggers from '../logger/index';
import _ from 'lodash';
import { isPlainObject, isString } from '@/utils';
import { LEVELS } from './base';

const noop = () => { };
const cwd = process.cwd();

/**
 * 日志实例工厂模式创建
 */
export class LoggerFactory {
  public star: Star;
  public options: any;
  public appenders: any[] = [];
  public cache: Map<any, any>; // 缓存

  constructor(star: Star) {
    this.star = star;
    this.appenders = []; // 处理队列
    this.cache = new Map();
  }

  /**
   * Initialize module
   * 日志模块初始化
   */
  init(options: LogLevelConfig | LogLevelConfig[] | boolean | null) {
    this.options = options;
    const globalLogLevel = this.star.options.logLevel || 'info';

    if (options === false || options == null) {
      // 没有日志
      this.appenders = [];
    } else if (options === true || options === console) {
      this.appenders = [Loggers.resolve({ type: 'Console', options: { level: globalLogLevel } })];
    } else {
      if (!Array.isArray(options)) {
        options = [options];
      }

      this.appenders = _.compact(options).map((item) => {
        // 如果是字符串格式
        if (isString(item)) return Loggers.resolve({ type: item, options: { level: globalLogLevel } });
        // 如果是对象格式
        if (isPlainObject(item))
          return Loggers.resolve(_.defaultsDeep({}, item, { options: { level: globalLogLevel } }));
        // 默认兜底
        return Loggers.resolve(item);
      });
    }

    // 初始化队列中的实例
    this.appenders.forEach((app) => app.init(this));
  }

  // 结束队列中所有的日志实例
  stop() {
    return (this.star.Promise as any).all(this.appenders.map((app) => app.stop()));
  }

  /**
   * Get caller information from error stack trace.
   * 获取所有错误栈中的信息
   */
  getCallerFromStack() {
    const _prepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack;
    Error.prepareStackTrace = _prepareStackTrace;

    if (stack && stack.length > 2) {
      const site = stack[2];
      return {
        filename: (site as any).getFileName().substring(cwd.length + 1),
        lineNumber: (site as any).getLineNumber(),
        columnNumber: (site as any).getColumnNumber(),
        methodName: (site as any).getMethodName(),
        functionName: (site as any).getFunctionName()
      };
    }
  }

  /**
   * Create a key from bindings for logger caching.
   *
   * @param {object} bindings
   * @returns {String}
   */
  getBindingsKey(bindings: LoggerBindings): string {
    if (!bindings) return '';

    return ['nodeID', 'namespace', 'mod'].map((key) => bindings[key]).join('|');
  }

  // 获取日志
  getLogger(bindings: LoggerBindings) {
    let logger = this.cache.get(this.getBindingsKey(bindings));
    // 存在
    if (logger) return logger;
    // 不存在
    logger = {};
    const star = this.star;
    const appenders = this.appenders;

    // 获取日志处理方法
    const logHandlers = _.compact(appenders.map((app) => app.getLogHandler(bindings)));

    // 服务是否拥有中间件
    const hasNewLogEntryMiddleware = star.middlewares && star.middlewares.registeredHooks.newLogEntry;

    LEVELS.forEach((type) => {
      if (logHandlers.length == 0 && !hasNewLogEntryMiddleware) return (logger[type] = noop);

      logger[type] = function (...args) {
        if (hasNewLogEntryMiddleware)
          star.middlewares && star.middlewares?.callSyncHandlers('newLogEntry', [type, args, bindings], {});

        if (logHandlers.length == 0) return;

        for (let i = 0; i < logHandlers.length; i++) {
          logHandlers[i](type, args);
        }
      };
    });

    logger.appenders = appenders;

    this.cache.set(this.getBindingsKey(bindings), logger);

    return logger;
  }
}
