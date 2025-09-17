import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import _ from 'lodash';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import Context from '../context';
import { isFunction } from '@/utils';
import Endpoint from '../registry/endpoint/item';

/**
 * 分片策略
 */
export default class ShardStrategy extends BaseStrategy {
  public cache: LRUCache<number, string>; // 用来存储分片key值对应的nodeID
  public needRebuild: boolean;
  public ring: Array<any>; // 节点对应的切片信息

  constructor(registry: Registry, star: Star, options: GenericObject) {
    super(registry, star, options);

    this.options = _.defaultsDeep(options, {
      shardKey: null,
      vnodes: 10,
      ringSize: null,
      cacheSize: 1000 // 缓存大小
    });

    this.cache = new LRUCache({ max: this.options.cacheSize, maxSize: this.options.cacheSize });
    this.needRebuild = true;
    this.ring = [];
    // 监听所有以 '$node.' 开头的事件
    this.star.localBus?.on('$node.connected', () => (this.needRebuild = true));
    this.star.localBus?.on('$node.disconnected', () => (this.needRebuild = true));
    this.star.localBus?.on('$node.updated', () => (this.needRebuild = true));
    this.star.localBus?.on('$node.removed', () => (this.needRebuild = true));
  }

  /**
   * 从上下文中获取到key值
   */
  private getKeyFromContext(ctx: Context) {
    if (!this.options.shardKey) return null;

    if (isFunction(this.options.shardKey)) return this.options.shardKey.call(this, ctx);

    if ((this.options.shardKey as string).startsWith('#')) return _.get(ctx.meta, this.options.shardKey.slice(1));

    return _.get(ctx.params, this.options.shardKey);
  }

  /**
   * 通过key值获取到节点ID
   */
  private getNodeIDByKey(key: number): string | null {
    // 存在缓存
    if (this.cache) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }

    const hashNum = this.getHash(key.toString());
    let found;
    const ringLen = this.ring.length;
    for (let i = 0; i < ringLen; i++) {
      if (hashNum <= this.ring[i].key) {
        found = this.ring[i];
        break;
      }
    }

    if (found) {
      if (this.cache) this.cache.set(key, found.nodeID);

      return found.nodeID;
    }

    return null;
  }

  /**
   * 生成哈希值
   */
  private getHash(key: string): number {
    // 生成hash值
    const hash = crypto.createHash('md5').update(key).digest('hex');
    const hashNum = parseInt(hash.substring(0, 8), 16);

    return this.options.ringSize ? hashNum % this.options.ringSize : hashNum;
  }

  /**
   * 重新得到节点的hash值
   */
  private rebuild(list: Endpoint[]) {
    // 清除缓存
    this.cache.clear();
    this.ring = [];
    const arr = list.map((item) => item.id).sort();
    const total = arr.length * this.options.vnodes;
    const ringSize = this.options.ringSize ? this.options.ringSize : Math.pow(2, 32);
    const slice = ringSize / total;

    for (let j = 0; j < this.options.vnodes; j++) {
      for (let i = 0; i < arr.length; i++) {
        const nodeID = arr[i];
        this.ring.push({ key: Math.floor(slice * (this.ring.length + 1)), nodeID });
      }
    }

    this.ring[this.ring.length - 1].key = ringSize;
    this.needRebuild = false;
  }

  /**
   * 选择一个节点作为分片策略的一个节点
   */
  public select(list: Endpoint[], ctx?: Context | undefined): Endpoint {
    // 上下文不存在，直接随机返回一个节点
    if (!ctx) return list[_.random(0, list.length - 1)];
    // 获取分片的key值
    let key = this.getKeyFromContext(ctx);
    if (key !== null) {
      if (this.needRebuild) this.rebuild(list);
      const nodeID = this.getNodeIDByKey(key);
      if (nodeID) {
        const endpoint = list.find((item) => item.id === nodeID);
        if (endpoint) return endpoint;
      }
    }

    return list[_.random(0, list.length - 1)];
  }
}
