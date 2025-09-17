/**
 * 辅助方法模块
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import BaseError from '@/lib/error/base';
import kleur from 'kleur';
import { promiseAllControl } from './promiseAllControl';
import { sleep } from './sleep';
import { getMilliseconds } from './getMilliseconds';
import { promiseMethod } from './promiseMethod';
import { functionArguments } from './functionArguments';
import { isNewSignature } from './isNewSignature';
import clearRequireCache from './clearRequireCache';

const RegexCache = new Map();

const deprecateList: Array<any> = [];

const units = ['h', 'm', 's', 'ms', 'μs', 'ns'];
const divisors = [60 * 60 * 1000, 60 * 1000, 1000, 1, 1e-3, 1e-6];

const lut: string[] = [];
for (let i = 0; i < 256; i++) {
  lut[i] = (i < 16 ? '0' : '') + i.toString(16);
}

class TimeoutError extends BaseError {}

// 检查参数是否为对象
export function isObject(o: any): boolean {
  return o !== null && typeof o === 'object' && !(o instanceof String);
}

// 检查参数是否为字符串
export function isString(s: any): boolean {
  return s !== null && (typeof s === 'string' || s instanceof String);
}

// 检查参数是否为方法
export function isFunction(fn: any): boolean {
  return typeof fn === 'function';
}

// 检查是否是继承对象
export function isPlainObject(o) {
  return o != null ? Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null : false;
}

/**
 * 获取一个对象参数的构造方法名
 *
 * @param {Object} obj
 * @returns {String}
 */
export function getConstructorName(obj: any): string | undefined {
  if (obj == null) return undefined;

  let target = obj.prototype;
  if (target && target.constructor && target.constructor.name) {
    return target.constructor.name;
  }
  if (obj.constructor && obj.constructor.name) {
    return obj.constructor.name;
  }
  return undefined;
}

/**
 * 检查一个实例参数是否是另一个类生成的实例对象
 *
 * @param {Object} instance
 * @param {Object} baseClass
 * @returns {Boolean}
 */
export function isInheritedClass(instance: object, baseClass: object): boolean {
  const baseClassName = getConstructorName(baseClass);
  let proto = instance;
  // 循环遍历寻找对象的继承链
  while ((proto = Object.getPrototypeOf(proto))) {
    const protoName = getConstructorName(proto);
    if (baseClassName == protoName) return true;
  }

  return false;
}

/**
 * 字符串匹配器，用来匹配带有分隔符的事件或动作名称
 * @param text 待匹配的文本
 * @param pattern 待匹配的模式
 * @returns
 */
export function matchActionOrEvent(text: string, pattern: string): boolean {
  // 模式是否带有?
  if (pattern.indexOf('?') == -1) {
    // 找到第一个*的索引
    const firstStarPosition = pattern.indexOf('*');
    if (firstStarPosition == -1) {
      return pattern === text;
    }

    // 获取模式长度
    const len = pattern.length;
    if (len > 2 && pattern.endsWith('**') && firstStarPosition > len - 3) {
      pattern = pattern.substring(0, len - 2);
      return text.startsWith(pattern);
    }

    // Eg. "prefix*"
    if (len > 1 && pattern.endsWith('*') && firstStarPosition > len - 2) {
      pattern = pattern.substring(0, len - 1);
      if (text.startsWith(pattern)) {
        return text.indexOf('.', len) == -1;
      }
      return false;
    }

    // Accept simple text, without point character (*)
    if (len == 1 && firstStarPosition == 0) {
      return text.indexOf('.') == -1;
    }

    // Accept all inputs (**)
    if (len == 2 && firstStarPosition == 0 && pattern.lastIndexOf('*') == 1) {
      return true;
    }
  }

  const origPattern = pattern;
  let regex = RegexCache.get(origPattern);
  if (regex == null) {
    if (pattern.startsWith('$')) {
      pattern = '\\' + pattern;
    }
    pattern = pattern.replace(/\?/g, '.');
    pattern = pattern.replace(/\*\*/g, '§§§');
    pattern = pattern.replace(/\*/g, '[^\\.]*');
    pattern = pattern.replace(/§§§/g, '.*');

    pattern = '^' + pattern + '$';

    // eslint-disable-next-line security/detect-non-literal-regexp
    regex = new RegExp(pattern, '');
    RegexCache.set(origPattern, regex);
  }
  return regex.test(text);
}

/**
 * 根据文件路径创建对应的目录结构
 */
export function makeDirs(filePath: string) {
  filePath.split(path.sep).reduce((prevPath, folder) => {
    // 当前路径
    const currentPath = path.join(prevPath, folder, path.sep);
    // 判断目录是否存在
    if (!fs.existsSync(currentPath)) {
      // 不存在，就创建目录，这里使用同步创建，是为了避免创建目录顺序错乱导致创建失败
      fs.mkdirSync(currentPath);
    }

    return currentPath;
  }, '');
}

/**
 * 生成一个nodeID，生成规则为系统主机名-进程id
 */
export function getNodeID(): string {
  return os.hostname().toLocaleLowerCase() + '-' + process.pid;
}

/**
 * 生成uuid  https://jsperf.com/uuid-generator-opt/18
 */
export function generateToken() {
  const d0 = (Math.random() * 0xffffffff) | 0;
  const d1 = (Math.random() * 0xffffffff) | 0;
  const d2 = (Math.random() * 0xffffffff) | 0;
  const d3 = (Math.random() * 0xffffffff) | 0;
  return (
    lut[d0 & 0xff] +
    lut[(d0 >> 8) & 0xff] +
    lut[(d0 >> 16) & 0xff] +
    lut[(d0 >> 24) & 0xff] +
    '-' +
    lut[d1 & 0xff] +
    lut[(d1 >> 8) & 0xff] +
    '-' +
    lut[((d1 >> 16) & 0x0f) | 0x40] +
    lut[(d1 >> 24) & 0xff] +
    '-' +
    lut[(d2 & 0x3f) | 0x80] +
    lut[(d2 >> 8) & 0xff] +
    '-' +
    lut[(d2 >> 16) & 0xff] +
    lut[(d2 >> 24) & 0xff] +
    lut[d3 & 0xff] +
    lut[(d3 >> 8) & 0xff] +
    lut[(d3 >> 16) & 0xff] +
    lut[(d3 >> 24) & 0xff]
  );
}

/**
 * 补充Promise的方法
 */
export function polyfillPromise(P: any) {
  if (!isFunction(P.method)) {
    P.method = function (fn: Function) {
      return () => {
        try {
          const val = fn.apply(this, arguments);
          return P.resolve(val);
        } catch (error) {
          return P.reject(error);
        }
      };
    };
  }

  if (!isFunction(P.delay)) {
    P.delay = function (ms: number) {
      return new P((resolve: any) => setTimeout(resolve, ms));
    };

    P.prototype.delay = function (ms: number) {
      return this.then((res: any) => P.delay(ms).then(() => res));
    };
  }

  if (!isFunction(P.prototype.timeout)) {
    P.TimeoutError = TimeoutError;

    P.prototype.timeout = function (ms: number, message: string) {
      let timer: any = null;
      const timeout = new P((resolve, reject) => {
        timer = setTimeout(() => reject(new P.TimeoutError(message)), +ms);
      });

      return P.race([timeout, this])
        .then((value) => {
          clearTimeout(timer);
          return value;
        })
        .catch((err) => {
          clearTimeout(timer);
          throw err;
        });
    };
  }

  if (!isFunction(P.mapSeries)) {
    P.mapSeries = function (arr, fn) {
      const promFn = P.method(fn);
      const res: Array<any> = [];

      return arr
        .reduce((p, item, i) => {
          return p.then((r) => {
            res[i] = r;
            return promFn(item, i);
          });
        }, P.resolve())
        .then((r) => {
          res[arr.length] = r;
          return res.slice(1);
        });
    };
  }
}

/**
 * 获取ip地址
 */
export function getIpList() {
  const list: string[] = [];
  const ipList: string[] = [];
  const interfaces = os.networkInterfaces();
  for (let iface in interfaces) {
    for (let i in interfaces[iface]) {
      if (interfaces[iface]?.length) {
        const f = (interfaces[iface] as os.NetworkInterfaceInfo[])[i] as os.NetworkInterfaceInfo;
        if (f.family === 'IPv4') {
          if (f.internal) {
            ipList.push(f.address);
            break;
          } else {
            list.push(f.address);
            break;
          }
        }
      }
    }
  }

  return list.length > 0 ? list : ipList;
}

/**
 * 是否满足匹配条件
 */
export function match(text: string, pattern: string) {
  // Simple patterns
  if (pattern.indexOf('?') == -1) {
    // Exact match (eg. "prefix.event")
    const firstStarPosition = pattern.indexOf('*');
    if (firstStarPosition == -1) {
      return pattern === text;
    }

    // Eg. "prefix**"
    const len = pattern.length;
    if (len > 2 && pattern.endsWith('**') && firstStarPosition > len - 3) {
      pattern = pattern.substring(0, len - 2);
      return text.startsWith(pattern);
    }

    // Eg. "prefix*"
    if (len > 1 && pattern.endsWith('*') && firstStarPosition > len - 2) {
      pattern = pattern.substring(0, len - 1);
      if (text.startsWith(pattern)) {
        return text.indexOf('.', len) == -1;
      }
      return false;
    }

    // Accept simple text, without point character (*)
    if (len == 1 && firstStarPosition == 0) {
      return text.indexOf('.') == -1;
    }

    // Accept all inputs (**)
    if (len == 2 && firstStarPosition == 0 && pattern.lastIndexOf('*') == 1) {
      return true;
    }
  }

  // Regex (eg. "prefix.ab?cd.*.foo")
  const origPattern = pattern;
  let regex = RegexCache.get(origPattern);
  if (regex == null) {
    if (pattern.startsWith('$')) {
      pattern = '\\' + pattern;
    }
    pattern = pattern.replace(/\?/g, '.');
    pattern = pattern.replace(/\*\*/g, '§§§');
    pattern = pattern.replace(/\*/g, '[^\\.]*');
    pattern = pattern.replace(/§§§/g, '.*');

    pattern = '^' + pattern + '$';

    // eslint-disable-next-line security/detect-non-literal-regexp
    regex = new RegExp(pattern, '');
    RegexCache.set(origPattern, regex);
  }

  return regex.test(text);
}

/**
 * 废弃一个方法或者属性
 */
export function deprecate(prop: any, msg?: any) {
  if (arguments.length === 1) {
    msg = prop;
  }

  if (deprecateList.indexOf(prop) === -1) {
    console.warn(kleur.yellow().bold(`DeprecationWarning: ${msg}`));
    deprecateList.push(prop);
  }
}

export function wrapToArray(o: any) {
  return Array.isArray(o) ? o : [o];
}

export function wrapToHandler(o: Function | object): any {
  return isFunction(o) ? { handler: o } : o;
}

export function circularReplacer(options = { maxSafeObjectSize: Infinity }) {
  const seen = new WeakSet();
  return function (key, value) {
    if (typeof value === 'object' && value !== null) {
      const objectType = (value.constructor && value.constructor.name) || typeof value;

      if (options.maxSafeObjectSize && 'length' in value && value.length > options.maxSafeObjectSize) {
        return `[${objectType} ${value.length}]`;
      }

      if (options.maxSafeObjectSize && 'size' in value && value.size > options.maxSafeObjectSize) {
        return `[${objectType} ${value.size}]`;
      }

      if (seen.has(value)) {
        //delete this[key];
        return;
      }
      seen.add(value);
    }
    return value;
  };
}

/**
 * 安全改造一个对象
 */
export function safetyObject(obj: any, options?: any) {
  return JSON.parse(JSON.stringify(obj, circularReplacer(options)));
}

/**
 * 移除数组中的某个元素
 */
export function removeFromArray(arr: Array<any>, item: any) {
  if (!arr || arr.length === 0) return arr;

  const index = arr.indexOf(item);
  if (index !== -1) arr.splice(item, 1);
  return arr;
}

/**
 * 时间展示
 */
export function humanize(milli: any) {
  if (milli == null) return '?';

  for (let i = 0; i < divisors.length; i++) {
    const value = milli / divisors[i];
    if (value >= 1.0) return '' + Math.floor(value) + units[i];
  }

  return 'now';
}

/**
 * 随机输出一个整数
 */
export function randomInt(a: number = 1, b: number = 0) {
  const lower = Math.ceil(Math.min(a, b));
  const upper = Math.floor(Math.max(a, b));

  return Math.floor(lower + Math.random() * (upper - lower + 1));
}

/**
 * 判断是否是一个日期
 */
export function isDate(date: any) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

export {
  promiseAllControl,
  sleep,
  getMilliseconds,
  promiseMethod,
  functionArguments,
  isNewSignature,
  clearRequireCache
};

export { CloneOptimizer, performanceMonitor } from './cloneOptimizer';
export { EnhancedErrorHandler, ErrorRecoveryStrategy } from './errorHandler';
export { 
  TypeValidator, 
  isServiceSchema, 
  isMethodDefinition, 
  isActionDefinition, 
  isEventDefinition,
  assertServiceSchema,
  assertMethodDefinition,
  assertActionDefinition,
  assertEventDefinition
} from './typeValidation';
export type { 
  ServiceSchema, 
  MethodDefinition, 
  ActionDefinition, 
  EventDefinition 
} from './typeValidation';
export { 
  InputValidator, 
  BoundaryChecker, 
  SecurityChecker 
} from './inputValidation';
export type { 
  ValidationResult, 
  ValidationRule 
} from './inputValidation';
