import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';
import crypto from 'crypto';

/**
 * 一致性哈希策略模式
 * 使用哈希环算法分配请求，保证节点变化时的最小重新分配
 * 适用于缓存场景和需要会话保持的应用
 */
export default class ConsistentHashingStrategy extends BaseStrategy {
  private hashRing: Map<number, Endpoint>;
  private virtualNodes: number;
  private sortedHashes: number[];

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
    
    this.hashRing = new Map();
    this.virtualNodes = options?.virtualNodes || 150; // 每个物理节点的虚拟节点数
    this.sortedHashes = [];
  }

  /**
   * 计算字符串的哈希值
   * @param str 输入字符串
   * @returns 哈希值
   */
  private hash(str: string): number {
    const hash = crypto.createHash('md5').update(str).digest('hex');
    // 取前8位转换为32位整数
    return parseInt(hash.substring(0, 8), 16);
  }

  /**
   * 构建哈希环
   * @param list 服务节点列表
   */
  private buildHashRing(list: Endpoint[]): void {
    this.hashRing.clear();
    this.sortedHashes = [];

    for (const endpoint of list) {
      const nodeId = endpoint.node?.id || endpoint.id;
      
      // 为每个物理节点创建多个虚拟节点
      for (let i = 0; i < this.virtualNodes; i++) {
        const virtualNodeKey = `${nodeId}:${i}`;
        const hashValue = this.hash(virtualNodeKey);
        
        this.hashRing.set(hashValue, endpoint);
        this.sortedHashes.push(hashValue);
      }
    }

    // 对哈希值进行排序
    this.sortedHashes.sort((a, b) => a - b);
  }

  /**
   * 在哈希环上查找节点
   * @param key 查找键
   * @returns 对应的服务节点
   */
  private findNodeOnRing(key: string): Endpoint {
    if (this.sortedHashes.length === 0) {
      throw new Error('Hash ring is empty');
    }

    const keyHash = this.hash(key);
    
    // 使用二分查找找到第一个大于等于keyHash的节点
    let left = 0;
    let right = this.sortedHashes.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midHash = this.sortedHashes[mid];
      
      if (midHash === keyHash) {
        return this.hashRing.get(midHash)!;
      } else if (midHash < keyHash) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    // 如果没有找到大于keyHash的节点，则选择环上的第一个节点（环形特性）
    const targetIndex = left >= this.sortedHashes.length ? 0 : left;
    const targetHash = this.sortedHashes[targetIndex];
    
    return this.hashRing.get(targetHash)!;
  }

  /**
   * 获取哈希键
   * @param ctx 上下文
   * @returns 哈希键
   */
  private getHashKey(ctx?: Context): string {
    // 优先使用上下文中的会话ID或用户ID
    if (ctx?.meta?.sessionId) {
      return ctx.meta.sessionId;
    }
    
    if (ctx?.meta?.userId) {
      return ctx.meta.userId;
    }
    
    // 使用请求ID作为备选
    if (ctx?.requestID) {
      return ctx.requestID;
    }
    
    // 使用调用者节点ID
    if (ctx?.caller) {
      return ctx.caller;
    }
    
    // 最后使用随机字符串
    return Math.random().toString(36).substring(2);
  }

  /**
   * 请求选择服务节点（一致性哈希算法）
   * @param list Endpoint[] 服务集群
   * @param ctx Context | undefined
   * @returns Endpoint 服务节点
   */
  public select(list: Endpoint[], ctx?: Context | undefined): Endpoint {
    if (list.length === 0) {
      throw new Error('No available endpoints');
    }

    if (list.length === 1) {
      return list[0];
    }

    // 构建哈希环
    this.buildHashRing(list);
    
    // 获取哈希键
    const hashKey = this.getHashKey(ctx);
    
    // 在哈希环上查找节点
    return this.findNodeOnRing(hashKey);
  }

  /**
   * 重置哈希环
   */
  public reset(): void {
    this.hashRing.clear();
    this.sortedHashes = [];
  }

  /**
   * 获取哈希环统计信息
   * @returns 统计信息
   */
  public getHashRingStats(): {
    totalVirtualNodes: number;
    physicalNodes: number;
    virtualNodesPerPhysical: number;
  } {
    const physicalNodes = new Set();
    
    for (const endpoint of this.hashRing.values()) {
      const nodeId = endpoint.node?.id || endpoint.id;
      physicalNodes.add(nodeId);
    }
    
    return {
      totalVirtualNodes: this.hashRing.size,
      physicalNodes: physicalNodes.size,
      virtualNodesPerPhysical: this.virtualNodes
    };
  }
}