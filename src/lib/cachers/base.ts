import _ from 'lodash';
import crypto from 'crypto';
import { isObject, isFunction, isDate } from '@/utils';
import { GenericObject } from '@/typings';
import { CacherOptions } from '@/typings/cachers';
import Star from '../star';
import { LoggerInstance } from '@/typings/logger';
import Context from '../context';
import { METRIC, MetricRegistry } from '../metrics/index';

export default class BaseCacher {
  public options: CacherOptions;
  public connected: any;
  public star: Star | null = null;
  public logger: LoggerInstance | null = null;
  public prefix: string = '';
  public metrics: MetricRegistry | null = null;

  constructor(options: CacherOptions) {
    this.options = _.defaultsDeep(options, {
      ttl: null,
      keygen: null,
      maxParamsLength: null
    });

    this.connected = null;
  }

  /**
   * 初始化
   */
  public init(star: Star) {
    this.star = star;
    this.metrics = star.metrics;

    if (this.star) {
      this.logger = star.getLogger('cacher');

      if (this.options.prefix) {
        this.prefix = this.options.prefix + '-';
      } else {
        this.prefix = 'UNVS-';

        if (this.star.namespace) this.prefix += this.star.namespace + '-';
      }

      // 注册指标数据
      this.registerStarCacherMetrics();
    }
  }

  /**
   * 注册缓存相关指标
   */
  private registerStarCacherMetrics() {
    // 缓存读取总次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_GET_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '缓存读取总次数',
      rate: true
    });

    // 缓存读取耗时，单位毫秒
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_GET_TIME,
      type: METRIC.TYPE_HISTOGRAM,
      description: '缓存读取耗时（毫秒）',
      quantiles: true,
      unit: METRIC.UNIT_MILLISECONDS
    });

    // 缓存命中次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_FOUND_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '缓存命中总次数',
      rate: true
    });

    // 缓存写入次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_SET_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '缓存写入总次数',
      rate: true
    });

    // 缓存写入耗时，单位毫秒
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_SET_TIME,
      type: METRIC.TYPE_HISTOGRAM,
      description: '缓存写入耗时（毫秒）',
      quantiles: true,
      unit: METRIC.UNIT_MILLISECONDS
    });

    // 缓存删除次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_DEL_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '缓存删除总次数',
      rate: true
    });

    // 缓存删除耗时，单位毫秒
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_DEL_TIME,
      type: METRIC.TYPE_HISTOGRAM,
      description: '缓存删除耗时（毫秒）',
      quantiles: true,
      unit: METRIC.UNIT_MILLISECONDS
    });

    // 缓存清理次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_CLEAN_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '按匹配规则清理缓存的总次数',
      rate: true
    });

    // 缓存清理耗时，单位毫秒
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_CLEAN_TIME,
      type: METRIC.TYPE_HISTOGRAM,
      description: '按匹配规则清理缓存的耗时（毫秒）',
      quantiles: true,
      unit: METRIC.UNIT_MILLISECONDS
    });

    // 缓存过期次数
    this.metrics?.register({
      name: METRIC.UNIVERSE_CACHER_EXPIRED_TOTAL,
      type: METRIC.TYPE_COUNTER,
      description: '读取或清理时发现缓存已过期的总次数',
      rate: true
    });
  }

  /**
   * 关闭缓存
   */
  public close(): Promise<any> {
    return Promise.resolve();
  }

  /**
   * 获取缓存内容
   */
  public get(key: string): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 获取缓存内容
   */
  public getWithTTL(key: string): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 设置缓存
   */
  public set(key: string, data: any, ttl?: number): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 删除缓存
   */
  public delete(key: string | string[]): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 根据匹配规则，清除缓存
   */
  public clean(match?: string | string[]): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 创建一个进程锁
   */
  public tryLock(key: string | string[], ttl?: number): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 锁住进程
   */
  public lock(key: string | string[], ttl?: number): Promise<any> {
    throw new Error('Not implemented method!');
  }

  /**
   * 通过key获取参数对应的值
   */
  public getParamMetaValue(key: string, params: GenericObject, meta: GenericObject) {
    if (key.startsWith('#') && meta != null) {
      return _.get(meta, key.slice(1));
    } else if (params != null) {
      return _.get(params, key);
    }
  }

  /**
   * 默认的缓存key生成
   */
  public defaultKeygen(actionName: string, params: GenericObject, meta: GenericObject, keys: Array<any> | null) {
    if (params || meta) {
      const keyPrefix = actionName + ':';
      if (keys) {
        if (keys.length === 1) {
          const val = this.getParamMetaValue(keys[0], params, meta);

          return keyPrefix + this._hashedKey(isObject(val) ? this._hashedKey(this._generateKeyFromObject(val)) : val);
        }

        if (keys.length > 0) {
          return keyPrefix + this._hashedKey(this._generateKeyFromObject(params));
        }
      } else {
        return keyPrefix + this._hashedKey(this._generateKeyFromObject(params));
      }
    }

    return actionName;
  }

  /**
   * 生成hash加密key
   */
  public _hashedKey(key: string): string {
    const maxParamsLength = this.options.maxParamsLength;
    if (!maxParamsLength || maxParamsLength < 44 || key.length <= maxParamsLength) return key;

    const prefixLength = maxParamsLength - 44;
    const base64Hash = crypto.createHash('sha256').update(key).digest('base64');
    if (prefixLength < 1) return base64Hash;

    return key.substring(0, prefixLength) + base64Hash;
  }

  /**
   * 使用递归，将对象转换为key
   */
  public _generateKeyFromObject(obj: any) {
    if (Array.isArray(obj)) {
      return '[' + obj.map((item) => this._generateKeyFromObject(item)).join('|') + ']';
    } else if (isDate(obj)) {
      return (obj as Date).valueOf();
    } else if (isObject(obj)) {
      return Object.keys(obj)
        .map((key) => [key, this._generateKeyFromObject(obj[key])].join('|'))
        .join('|');
    } else if (obj != null) {
      return obj.toString();
    } else {
      return 'null';
    }
  }

  /**
   * 获得一个缓存key通过name或params
   */
  public getCacheKey(
    actionName: string,
    params: GenericObject,
    meta: GenericObject,
    keys: string[],
    actionKeygen?: Function
  ): any {
    if (actionKeygen && isFunction(actionKeygen)) {
      return actionKeygen.call(this, actionName, params, meta, keys);
    } else if (this.options.keygen && isFunction(this.options.keygen)) {
      return this.options.keygen.call(this, actionName, params, meta, keys);
    } else {
      return this.defaultKeygen(actionName, params, meta, keys);
    }
  }

  /**
   * 获得所有的缓存key
   */
  public getCacheKeys(): Promise<any> {
    return Promise.resolve(null);
  }

  /**
   * 将缓存作为中间件
   */
  public middleware() {
    return {
      name: 'Cacher',
      localAction: (handler: any, action: any) => {
        const options = _.defaultsDeep({}, isObject(action.cache) ? action.cache : { enabled: !!action.cache });
        options.lock = _.defaultsDeep({}, isObject(options.lock) ? options.lock : { enabled: !!options.lock });

        if (options.enabled !== false) {
          const isEnabledFunction = isFunction(options.enabled);

          return (ctx: Context) => {
            if (isEnabledFunction) {
              if (!options.enabled.call(ctx.service, ctx)) {
                return handler(ctx);
              }
            }

            // 排除不使用缓存的情况
            if (ctx.meta['$cache'] === false) return handler(ctx);

            if (this.connected === false) {
              this.logger?.debug('Cacher is enabled but it is not connected at the moment... Calling the handler');

              return handler(ctx);
            }

            const cacheKey = this.getCacheKey(action.name, ctx.params, ctx.meta, options.keys, options.keygen);
            // 使用锁
            if (options.lock.enabled !== false) {
              let cachePromise: Promise<any>;
              if (options.lock.staleTime && this.getWithTTL) {
                // If enable cache refresh
                cachePromise = this.getWithTTL(cacheKey).then(({ data, ttl }) => {
                  if (data != null) {
                    if (options.lock.staleTime && ttl && ttl < options.lock.staleTime) {
                      // Cache is stale, try to refresh it.
                      this.tryLock(cacheKey, options.lock.ttl)
                        .then((unlock) => {
                          return handler(ctx)
                            .then((result) => {
                              // Save the result to the cache and realse the lock.
                              return this.set(cacheKey, result, options.ttl).then(() => unlock());
                            })
                            .catch((err) => {
                              this.logger?.error('Cacher middleware cachePromise  handler', err);

                              return this.delete(cacheKey).then(() => unlock());
                            });
                        })
                        .catch((err) => {
                          this.logger?.error('Cacher middleware cachePromise tryLock', err);
                        });
                    }
                  }
                  return data;
                });
              } else {
                cachePromise = this.get(cacheKey);
              }
              return cachePromise.then((data) => {
                if (data != null) {
                  // 缓存中发现内容,直接返回
                  ctx.cachedResult = true;

                  return data;
                }
                // 没有发现该内容，锁住进程，开始存储
                return this.lock(cacheKey, options.lock.ttl).then((unlock) => {
                  // 再次确认缓存中是否存在该内容
                  return this.get(cacheKey).then((content) => {
                    if (content != null) {
                      // 缓存中发现该内容，直接返回
                      ctx.cachedResult = true;

                      return unlock().then(() => {
                        return content;
                      });
                    }
                    // Call the handler
                    return handler(ctx)
                      .then((result) => {
                        // Save the result to the cache and realse the lock.
                        this.set(cacheKey, result, options.ttl).then(() => unlock());
                        return result;
                      })
                      .catch((e) => {
                        return unlock().then(() => {
                          return Promise.reject(e);
                        });
                      });
                  });
                });
              });
            }
          };
        }

        return handler;
      }
    };
  }
}
