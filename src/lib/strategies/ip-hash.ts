import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';
import crypto from 'crypto';

/**
 * IP哈希策略模式
 * 根据客户端IP地址进行哈希，确保同一IP的请求总是路由到同一节点
 * 适用于需要会话保持的应用场景
 */
export default class IPHashStrategy extends BaseStrategy {
  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
  }

  /**
   * 计算字符串的哈希值
   * @param str 输入字符串
   * @returns 哈希值
   */
  private hash(str: string): number {
    const hash = crypto.createHash('md5').update(str).digest('hex');
    // 转换为32位无符号整数
    return parseInt(hash.substring(0, 8), 16);
  }

  /**
   * 从上下文中提取客户端IP地址
   * @param ctx 上下文
   * @returns IP地址
   */
  private extractClientIP(ctx?: Context): string {
    if (!ctx) {
      return '127.0.0.1'; // 默认本地IP
    }

    // 优先从meta中获取真实IP
    if (ctx.meta?.clientIP) {
      return ctx.meta.clientIP;
    }

    // 从HTTP头中获取IP（如果是HTTP请求）
    if (ctx.meta?.headers) {
      const headers = ctx.meta.headers;
      
      // 检查常见的代理头
      const ipHeaders = [
        'x-forwarded-for',
        'x-real-ip',
        'x-client-ip',
        'cf-connecting-ip', // Cloudflare
        'true-client-ip',
        'x-cluster-client-ip'
      ];
      
      for (const header of ipHeaders) {
        const ip = headers[header];
        if (ip) {
          // x-forwarded-for可能包含多个IP，取第一个
          return ip.split(',')[0].trim();
        }
      }
      
      // 从远程地址获取
      if (headers['remote-addr']) {
        return headers['remote-addr'];
      }
    }

    // 从调用者信息中获取IP
    if (ctx.caller) {
      // 如果调用者包含IP信息
      const callerParts = ctx.caller.split('@');
      if (callerParts.length > 1) {
        return callerParts[1];
      }
    }

    // 从节点信息中获取IP
    if (ctx.nodeID && this.registry) {
      const node = this.registry.nodes.get(ctx.nodeID);
      if (node?.ipList && node.ipList.length > 0) {
        return node.ipList[0];
      }
    }

    // 默认返回本地IP
    return '127.0.0.1';
  }

  /**
   * 标准化IP地址
   * @param ip IP地址
   * @returns 标准化后的IP地址
   */
  private normalizeIP(ip: string): string {
    // 移除端口号
    const ipWithoutPort = ip.split(':')[0];
    
    // 处理IPv6映射的IPv4地址
    if (ipWithoutPort.startsWith('::ffff:')) {
      return ipWithoutPort.substring(7);
    }
    
    // 处理本地回环地址
    if (ipWithoutPort === '::1') {
      return '127.0.0.1';
    }
    
    return ipWithoutPort;
  }

  /**
   * 请求选择服务节点（IP哈希算法）
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

    // 提取并标准化客户端IP
    const clientIP = this.extractClientIP(ctx);
    const normalizedIP = this.normalizeIP(clientIP);
    
    // 计算IP的哈希值
    const ipHash = this.hash(normalizedIP);
    
    // 根据哈希值选择节点
    const index = ipHash % list.length;
    
    return list[index];
  }

  /**
   * 重置策略状态（IP哈希策略无状态，无需重置）
   */
  public reset(): void {
    // IP哈希策略是无状态的，无需重置
  }

  /**
   * 获取IP哈希统计信息
   * @param list 节点列表
   * @param sampleIPs 样本IP列表
   * @returns 统计信息
   */
  public getHashDistribution(list: Endpoint[], sampleIPs: string[] = []): {
    distribution: Map<string, number>;
    evenness: number;
  } {
    if (sampleIPs.length === 0) {
      // 生成一些样本IP用于测试分布
      for (let i = 0; i < 1000; i++) {
        const ip = `192.168.${Math.floor(i / 256)}.${i % 256}`;
        sampleIPs.push(ip);
      }
    }

    const distribution = new Map<string, number>();
    
    // 初始化分布计数
    for (const endpoint of list) {
      const nodeId = endpoint.node?.id || endpoint.id;
      distribution.set(nodeId, 0);
    }

    // 计算每个IP的分布
    for (const ip of sampleIPs) {
      const normalizedIP = this.normalizeIP(ip);
      const ipHash = this.hash(normalizedIP);
      const index = ipHash % list.length;
      const selectedEndpoint = list[index];
      const nodeId = selectedEndpoint.node?.id || selectedEndpoint.id;
      
      const currentCount = distribution.get(nodeId) || 0;
      distribution.set(nodeId, currentCount + 1);
    }

    // 计算分布均匀度（标准差）
    const counts = Array.from(distribution.values());
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - average, 2), 0) / counts.length;
    const standardDeviation = Math.sqrt(variance);
    const evenness = 1 - (standardDeviation / average); // 越接近1越均匀

    return {
      distribution,
      evenness: Math.max(0, evenness) // 确保不为负数
    };
  }
}