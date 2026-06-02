import { LogLevelConfig, LoggerBindings } from '@/typings/logger';
import Star from '../star';
import Loggers from '../logger/index';
import _ from 'lodash';
import { isPlainObject, isString, matchActionOrEvent } from '@/utils';
import { LEVELS } from './base';

const noop = () => { };
const cwd = process.cwd();

type LoggerCategoryEnabledConfig = boolean | Record<string, boolean>;

type LoggerSuppressRule = string | RegExp | ((entry: {
  type: string;
  args: any[];
  bindings: LoggerBindings;
}) => boolean);

function normalizeCategoryEnabledConfig(options: any): LoggerCategoryEnabledConfig {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return true;
  const enabled = options.enabled ?? options.categories ?? options.categoryEnabled;
  if (enabled === undefined) return true;
  return enabled;
}

function getBindingCategory(bindings: LoggerBindings): string {
  return String(bindings?.mod || bindings?.svc || '').toUpperCase();
}

function isCategoryEnabled(config: LoggerCategoryEnabledConfig, bindings: LoggerBindings): boolean {
  if (typeof config === 'boolean') return config;

  const category = getBindingCategory(bindings);
  if (Object.prototype.hasOwnProperty.call(config, category)) {
    return config[category] !== false;
  }

  const key = Object.keys(config).find((item) => matchActionOrEvent(category, item) && item !== '**');
  if (key) return config[key] !== false;

  if (Object.prototype.hasOwnProperty.call(config, '**')) {
    return config['**'] !== false;
  }

  return true;
}

function normalizeSuppressRules(options: any): LoggerSuppressRule[] {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return [];
  const rules = options.suppress || options.suppressLogs;
  if (!rules) return [];
  return Array.isArray(rules) ? rules : [rules];
}

function stringifyLogArg(arg: any): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function shouldSuppressLogEntry(
  rules: LoggerSuppressRule[],
  type: string,
  args: any[],
  bindings: LoggerBindings,
): boolean {
  if (rules.length === 0) return false;

  const message = args.map(stringifyLogArg).join(' ');
  const entry = { type, args, bindings };

  return rules.some((rule) => {
    if (typeof rule === 'string') return message.includes(rule);
    if (rule instanceof RegExp) return rule.test(message);
    if (typeof rule === 'function') return rule(entry);
    return false;
  });
}

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
    const categoryEnabled = normalizeCategoryEnabledConfig(this.options);
    const suppressRules = normalizeSuppressRules(this.options);

    // 获取日志处理方法
    const logHandlers = _.compact(appenders.map((app) => app.getLogHandler(bindings)));

    // 服务是否拥有中间件
    const hasNewLogEntryMiddleware = star.middlewares && star.middlewares.registeredHooks.newLogEntry;
    if (!isCategoryEnabled(categoryEnabled, bindings)) {
      LEVELS.forEach((type) => {
        logger[type] = noop;
      });
      logger.appenders = appenders;
      this.cache.set(this.getBindingsKey(bindings), logger);
      return logger;
    }

    LEVELS.forEach((type) => {
      if (logHandlers.length == 0 && !hasNewLogEntryMiddleware) return (logger[type] = noop);

      logger[type] = function (...args: any[]) {
        if (shouldSuppressLogEntry(suppressRules, type, args, bindings)) return;

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
