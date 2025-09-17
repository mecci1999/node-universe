import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';

/**
 * 最少响应时间策略
 * 选择平均响应时间最短的节点处理请求
 * 适用于对响应速度要求较高的场景
 */
export default class LeastResponseTimeStrategy extends BaseStrategy {
  private responseTimes: Map<string, number[]>;
  private averageResponseTimes: Map<string, number>;
  private maxSamples: number;
  private defaultResponseTime: number;

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
    
    this.responseTimes = new Map();
    this.averageResponseTimes = new Map();
    this.maxSamples = options?.maxSamples || 10; // 保留最近10次响应时间
    this.defaultResponseTime = options?.defaultResponseTime || 100; // 默认响应时间100ms
    
    // 监听请求完成事件，记录响应时间
    this.star.localBus?.on('$node.response', this.recordResponseTime.bind(this));
  }

  /**
   * 记录节点响应时间
   * @param data 响应数据
   */
  private recordResponseTime(data: any): void {
    if (!data.nodeID || !data.responseTime) return;
    
    const nodeId = data.nodeID;
    const responseTime = data.responseTime;
    
    // 获取当前节点的响应时间历史
    let times = this.responseTimes.get(nodeId) || [];
    
    // 添加新的响应时间
    times.push(responseTime);
    
    // 保持样本数量在限制范围内
    if (times.length > this.maxSamples) {
      times = times.slice(-this.maxSamples);
    }
    
    this.responseTimes.set(nodeId, times);
    
    // 计算平均响应时间
    const avgResponseTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    this.averageResponseTimes.set(nodeId, avgResponseTime);
  }

  /**
   * 获取节点的平均响应时间
   * @param endpoint 服务节点
   * @returns 平均响应时间（毫秒）
   */
  private getAverageResponseTime(endpoint: Endpoint): number {
    const nodeId = endpoint.node?.id || endpoint.id;
    
    // 如果有历史数据，返回平均响应时间
    if (this.averageResponseTimes.has(nodeId)) {
      return this.averageResponseTimes.get(nodeId)!;
    }
    
    // 如果没有历史数据，返回默认响应时间
    return this.defaultResponseTime;
  }

  /**
   * 获取节点的响应时间样本数量
   * @param endpoint 服务节点
   * @returns 样本数量
   */
  private getSampleCount(endpoint: Endpoint): number {
    const nodeId = endpoint.node?.id || endpoint.id;
    const times = this.responseTimes.get(nodeId) || [];
    return times.length;
  }

  /**
   * 计算节点的权重分数
   * 综合考虑响应时间和样本数量
   * @param endpoint 服务节点
   * @returns 权重分数（越小越好）
   */
  private calculateScore(endpoint: Endpoint): number {
    const avgResponseTime = this.getAverageResponseTime(endpoint);
    const sampleCount = this.getSampleCount(endpoint);
    
    // 如果样本数量不足，给予一定的惩罚
    const samplePenalty = sampleCount < this.maxSamples ? 1.2 : 1.0;
    
    return avgResponseTime * samplePenalty;
  }

  /**
   * 请求选择服务节点（最少响应时间算法）
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

    // 找到响应时间最短的节点
    let bestEndpoint = list[0];
    let bestScore = this.calculateScore(bestEndpoint);

    for (let i = 1; i < list.length; i++) {
      const endpoint = list[i];
      const score = this.calculateScore(endpoint);
      
      if (score < bestScore) {
        bestScore = score;
        bestEndpoint = endpoint;
      }
    }

    return bestEndpoint;
  }

  /**
   * 重置响应时间统计
   */
  public reset(): void {
    this.responseTimes.clear();
    this.averageResponseTimes.clear();
  }

  /**
   * 获取响应时间统计信息
   * @returns 统计信息
   */
  public getResponseTimeStats(): {
    totalNodes: number;
    nodesWithData: number;
    averageResponseTimes: Map<string, number>;
    responseTimes: Map<string, number[]>;
  } {
    return {
      totalNodes: this.responseTimes.size,
      nodesWithData: this.averageResponseTimes.size,
      averageResponseTimes: new Map(this.averageResponseTimes),
      responseTimes: new Map(this.responseTimes)
    };
  }

  /**
   * 手动设置节点响应时间
   * @param nodeId 节点ID
   * @param responseTime 响应时间
   */
  public setNodeResponseTime(nodeId: string, responseTime: number): void {
    this.recordResponseTime({ nodeID: nodeId, responseTime });
  }

  /**
   * 获取节点的详细响应时间信息
   * @param nodeId 节点ID
   * @returns 响应时间信息
   */
  public getNodeResponseTimeInfo(nodeId: string): {
    averageResponseTime: number;
    sampleCount: number;
    responseTimes: number[];
    score: number;
  } | null {
    const times = this.responseTimes.get(nodeId);
    if (!times) return null;

    const avgResponseTime = this.averageResponseTimes.get(nodeId) || this.defaultResponseTime;
    const sampleCount = times.length;
    const samplePenalty = sampleCount < this.maxSamples ? 1.2 : 1.0;
    const score = avgResponseTime * samplePenalty;

    return {
      averageResponseTime: avgResponseTime,
      sampleCount,
      responseTimes: [...times],
      score
    };
  }
}