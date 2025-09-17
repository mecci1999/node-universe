import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';

/**
 * 最少连接策略模式
 * 选择当前连接数最少的节点处理请求
 * 适用于请求处理时间差异较大的场景
 */
export default class LeastConnectionsStrategy extends BaseStrategy {
  private connections: Map<string, number>;

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
    
    this.connections = new Map();
  }

  /**
   * 获取节点当前连接数
   * @param endpoint 服务节点
   * @returns 连接数
   */
  private getConnectionCount(endpoint: Endpoint): number {
    const nodeId = endpoint.node?.id || endpoint.id;
    return this.connections.get(nodeId) || 0;
  }

  /**
   * 增加节点连接数
   * @param endpoint 服务节点
   */
  public incrementConnection(endpoint: Endpoint): void {
    const nodeId = endpoint.node?.id || endpoint.id;
    const currentCount = this.getConnectionCount(endpoint);
    this.connections.set(nodeId, currentCount + 1);
  }

  /**
   * 减少节点连接数
   * @param endpoint 服务节点
   */
  public decrementConnection(endpoint: Endpoint): void {
    const nodeId = endpoint.node?.id || endpoint.id;
    const currentCount = this.getConnectionCount(endpoint);
    const newCount = Math.max(0, currentCount - 1);
    this.connections.set(nodeId, newCount);
  }

  /**
   * 请求选择服务节点（最少连接算法）
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

    // 找到连接数最少的节点
    let selectedEndpoint = list[0];
    let minConnections = this.getConnectionCount(selectedEndpoint);

    for (let i = 1; i < list.length; i++) {
      const endpoint = list[i];
      const connectionCount = this.getConnectionCount(endpoint);
      
      if (connectionCount < minConnections) {
        minConnections = connectionCount;
        selectedEndpoint = endpoint;
      }
    }

    // 增加选中节点的连接数
    this.incrementConnection(selectedEndpoint);

    return selectedEndpoint;
  }

  /**
   * 重置连接计数器
   */
  public reset(): void {
    this.connections.clear();
  }

  /**
   * 获取所有节点的连接统计
   * @returns 连接统计信息
   */
  public getConnectionStats(): Map<string, number> {
    return new Map(this.connections);
  }
}