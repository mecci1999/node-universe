import BaseCacher from './base';
import _, { chain } from 'lodash';
import { StarOptionsError } from '../error';
import C from '../star/constants';
import Redis, { Cluster, ClusterNode } from 'ioredis';
import { RedisCacherOptions } from '@/typings/cachers';
import Redlock from 'redlock';
import Star from '../star';
import { Serialize } from '@/typings/serializers';
import serializers from '../serializers';
import { METRIC } from '../metrics';

export default class RedisCacher extends BaseCacher {
  public pingIntervalHandle: any;
  public redlock: Redlock | null;
  public redlockNonBlocking: Redlock | null;
  public client: any;
  public serializer: Serialize | null = null;
  private monitorClient: Redis | Cluster | null = null;
  private onMonitorEvent: ((time: string, args: string[]) => void) | null = null;

  constructor(options: RedisCacherOptions) {
    if (typeof options === 'string') options = { redis: options };

    super(options);
    this.options = _.defaultsDeep(this.options, {
      prefix: null,
      pingInterval: null
    });
    this.pingIntervalHandle = null;
    this.redlock = null;
    this.redlockNonBlocking = null;
  }

  public init(star: Star): void {
    super.init(star);

    if (!Redis) {
      this.star?.fatal(
        "The 'ioredis' package is missing. Please install it with 'npm install ioredis --save' command.",
        true
      );
    }

    // 创建redis实例
    if (this.options.cluster) {
      if (!this.options.cluster.nodes || this.options.cluster.nodes.length === 0) {
        throw new StarOptionsError('No nodes defined for cluster.');
      }

      this.client = new Redis.Cluster(this.options.cluster.nodes, this.options.cluster.options);
    } else {
      this.client = new Redis(this.options.redis);
    }

    this.connected = false;

    this.client.on('connect', () => {
      this.connected = true;
      // 日志
      this.logger?.info('Redis cacher connected.');
    });

    this.client.on('error', (err) => {
      this.connected = false;
      // 广播
      this.star?.broadcastLocal('$cacher.error', {
        error: err,
        module: 'cacher',
        type: C.CLIENT_ERROR
      });
      this.logger?.error(err);
    });

    // 使用redlock进行分布式锁
    if (this.options.redlock !== false) {
      if (Redlock != null) {
        let redlockClients = (this.options.redlock ? this.options.redlock.client : null) || [this.client];

        this.redlock = new Redlock(redlockClients, _.omit(this.options.redlock, ['clients']));
        this.redlockNonBlocking = new Redlock(redlockClients, { retryCount: 0 });
      }
    }

    if ((this.options as RedisCacherOptions).monitor) {
      this.client.monitor((err, monitor) => {
        if (err || !monitor) return;
        this.logger?.debug('Redis cacher entering monitoring mode...');
        this.monitorClient = monitor;
        this.onMonitorEvent = (time, args) => {
          this.logger?.debug(args);
        };
        monitor.on('monitor', this.onMonitorEvent);
      });
    }

    this.serializer = serializers.resolve(this.options.serializer);
    if (this.star) {
      this.serializer?.init(this.star);
    }

    if (this.options.pingInterval && this.options.pingInterval > 0) {
      this.pingIntervalHandle = setInterval(() => {
        this.client
          .ping()
          .then(() => {
            this.connected = true;
            this.logger?.info('Sent PING to Redis Server.');
          })
          .catch((err) => {
            this.connected = false;
            this.star?.broadcastLocal('$cacher.error', {
              error: err,
              module: 'cacher',
              type: C.FAILED_SEND_PING
            });
            this.logger?.error('Failed to send PING to Redis Server', err);
          });
      }, Number(this.options.pingInterval));
    }

    this.logger?.debug('Redis Cacher created. Prefix:' + this.prefix);
  }

  /**
   * 关闭缓存
   */
  public close(): Promise<any> {
    if (this.pingIntervalHandle != null) {
      clearInterval(this.pingIntervalHandle);
      this.pingIntervalHandle = null;
    }

    this.monitorClient?.disconnect();
    this.monitorClient = null;
    this.onMonitorEvent = null;
    // 退出redis客户端
    return this.client != null ? this.client.quit().finally(() => (this.client = null)) : Promise.resolve();
  }

  /**
   * 通过key获取缓存内容
   */
  public get(key: string): Promise<any> {
    this.logger?.debug(`GET ${key}`);
    // 指标注入
    const timeEnd = this.metrics?.timer(METRIC.UNIVERSE_CACHER_GET_TIME);

    return this.client.getBuffer(this.prefix + key).then((data) => {
      if (data) {
        // 获取到了缓存
        this.logger?.debug(`FOUND ${key}`);
        // 指标增加
        this.metrics?.increment(METRIC.UNIVERSE_CACHER_FOUND_TOTAL);

        try {
          // 解析数据
          const res = this.serializer?.deserialize(data);

          if (timeEnd) {
            timeEnd();
          }

          return res;
        } catch (error) {
          this.logger?.error('Redis result parse error.', error, data);
        }
      }

      if (timeEnd) {
        timeEnd();
      }

      return null;
    });
  }

  /**
   * 存储缓存
   */
  public set(key: string, data: any, ttl?: number | undefined): Promise<any> {
    // 指标注入
    this.metrics?.increment(METRIC.UNIVERSE_CACHER_SET_TOTAL);
    const timeEnd = this.metrics?.timer(METRIC.UNIVERSE_CACHER_SET_TIME);

    // 序列化数据
    data = this.serializer?.serialize(data);
    this.logger?.debug(`SET ${key}`);

    if (ttl == null) {
      ttl = this.options.ttl;
    }

    let p: Promise<any>;
    if (ttl) {
      p = (this.client as Redis).setex(this.prefix + key, ttl, data);
    } else {
      p = (this.client as Redis).set(this.prefix + key, data);
    }

    return p
      .then((res) => {
        if (timeEnd) {
          timeEnd();
        }

        return res;
      })
      .catch((error) => {
        if (timeEnd) {
          timeEnd();
        }

        throw error;
      });
  }

  /**
   * 删除缓存
   */
  public delete(key: string | string[]): Promise<any> {
    this.metrics?.increment(METRIC.UNIVERSE_CACHER_DEL_TOTAL);
    const timeEnd = this.metrics?.timer(METRIC.UNIVERSE_CACHER_DEL_TIME);

    const deleteTargets = Array.isArray(key) ? key : [key];
    const keysToDelete = deleteTargets.map((key) => this.prefix + key);
    this.logger?.debug(`DELETE ${keysToDelete}`);

    return (this.client as Redis)
      .del(keysToDelete)
      .then((res) => {
        if (timeEnd) {
          timeEnd();
        }

        return res;
      })
      .catch((error) => {
        if (timeEnd) {
          timeEnd();
        }
        this.logger?.error(`Redis 'delete' error. Key: ${keysToDelete}`, error);
        throw error;
      });
  }

  /**
   * 清除所有的缓存
   */
  public clean(match: string | string[] = '*'): Promise<any> {
    this.metrics?.increment(METRIC.UNIVERSE_CACHER_CLEAN_TOTAL);
    const timeEnd = this.metrics?.timer(METRIC.UNIVERSE_CACHER_CLEAN_TIME);
    const cleaningPatters = Array.isArray(match) ? match : [match];
    // 初始化匹配项
    const normalizePatterns = cleaningPatters.map((match) => this.prefix + match.replace(/\*\*/g, '*'));
    this.logger?.debug(`CLEAN ${match}`);

    return this._sequentialPromises(normalizePatterns)
      .then((res) => {
        if (timeEnd) {
          timeEnd();
        }

        return res;
      })
      .catch((err) => {
        if (timeEnd) {
          timeEnd();
        }
        this.logger?.error(`Redis 'scanDel' error. Pattern: ${err.pattern}`, err);

        throw err;
      });
  }

  /**
   * 获取缓存携带ttl
   */
  public getWithTTL(key: string): Promise<any> {
    return (this.client as Redis)
      .pipeline()
      .getBuffer(this.prefix + key)
      .ttl(this.prefix + key)
      .exec()
      .then((res: any) => {
        let [err0, data] = res[0];
        let [err1, ttl] = res[1];

        if (err0) {
          return Promise.reject(err0);
        }

        if (err1) {
          return Promise.reject(err1);
        }

        if (data) {
          this.logger?.debug(`FOUND ${key}`);
          try {
            data = this.serializer?.deserialize(data);
          } catch (error) {
            this.logger?.error('Redis result parse error.', error, data);
            data = null;
          }
        }

        return { data, ttl };
      });
  }

  /**
   * 分布式进程锁
   */
  public lock(key: string | string[], ttl?: number): Promise<any> {
    if (this.redlock == null) {
      return this._handleMissingRedlock();
    }

    key = Array.isArray(key) ? key.map((item) => this.prefix + item + '-lock') : [this.prefix + key + '-lock'];

    return this.redlock.acquire(key, ttl || 15000).then((lock) => {
      return () => lock.release();
    });
  }

  /**
   * 创建一个进程锁
   */
  public tryLock(key: string | string[], ttl?: number): Promise<any> {
    if (this.redlockNonBlocking == null) {
      return this._handleMissingRedlock();
    }

    key = Array.isArray(key) ? key.map((item) => this.prefix + item + '-lock') : [this.prefix + key + '-lock'];

    return this.redlockNonBlocking.acquire(key, ttl || 15000).then((lock) => {
      return () => lock.release();
    });
  }

  /**
   * 顺序执行异步操作
   */
  private _sequentialPromises(elements: string[]): Promise<any> {
    return elements.reduce((chain, element: string) => {
      return chain.then(() => this._scanDel(element));
    }, Promise.resolve());
  }

  /**
   * 删除所有的缓存
   */
  private _scanDel(pattern: string): Promise<any> {
    if (this.client instanceof Redis.Cluster) {
      return this._clusterScanDel(pattern);
    } else {
      return this._nodeScanDel(this.client, pattern);
    }
  }

  /**
   * Redis.Cluster类清除缓存
   */
  private _clusterScanDel(pattern: string): Promise<any> {
    const scanDelPromises: Promise<any>[] = [];
    const nodes = (this.client as Cluster).nodes('master');

    nodes.forEach((node) => scanDelPromises.push(this._nodeScanDel(node, pattern)));

    return Promise.all(scanDelPromises);
  }

  /**
   * 清除Redis中的缓存
   */
  private _nodeScanDel(node, pattern: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = node.scanStream({ match: pattern, count: 100 });

      stream.on('data', (keys = []) => {
        if (!keys.length) {
          return;
        }

        stream.pause();
        node
          .del(keys)
          .then(() => {
            stream.resume();
          })
          .catch((error) => {
            error.pattern = pattern;

            return reject(error);
          });
      });

      stream.on('error', (error) => {
        this.logger?.error(`Error occured while deleting keys '${pattern}' from node.`, error);
        reject(error);
      });

      stream.on('end', () => {
        resolve();
      });
    });
  }

  /**
   * 获取所有的缓存key
   */
  public getCacheKeys(): Promise<any> {
    return new Promise((resolve, reject) => {
      const res = [];
      const stream = this.client.scanStream({
        match: this.prefix + '*',
        count: 100
      });

      stream.on('data', (keys = []) => res.push(...keys));

      stream.on('error', (error) => {
        this.logger?.error('Error occured while listing keys from node.', error);

        reject(error);
      });

      stream.on('end', () => {
        resolve(res.map((key: string) => ({ key: key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key })));
      });
    });
  }

  /**
   * 处理丢失redis的分布式进程锁实例
   */
  private _handleMissingRedlock() {
    this.logger?.error(
      `The 'redlock' package is missing or redlock is disabled. If you want to enable cache lock, please install it with 'npm install redlock --save' command.`
    );

    return Promise.resolve();
  }
}
