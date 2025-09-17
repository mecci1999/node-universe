import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';

/**
 * 健康检查策略模式
 * 只选择健康的节点处理请求，结合故障转移机制
 * 适用于高可用性要求的生产环境
 */
export default class HealthCheckStrategy extends BaseStrategy {
  private healthStatus: Map<string, boolean>;
  private lastHealthCheck: Map<string, number>;
  private healthCheckInterval: number;
  private fallbackStrategy: BaseStrategy | null;

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
    
    this.healthStatus = new Map();
    this.lastHealthCheck = new Map();
    this.healthCheckInterval = options?.healthCheckInterval || 30000; // 30秒
    this.fallbackStrategy = null;
    
    // 设置备用策略
    if (options?.fallbackStrategy) {
      this.fallbackStrategy = options.fallbackStrategy;
    }
  }

  /**
   * 检查节点是否健康
   * @param endpoint 服务节点
   * @returns 是否健康
   */
  private isNodeHealthy(endpoint: Endpoint): boolean {
    const nodeId = endpoint.node?.id || endpoint.id;
    
    // 检查节点基本可用性
    if (!endpoint.node?.available || !endpoint.isAvailable) {
      this.healthStatus.set(nodeId, false);
      return false;
    }
    
    // 检查心跳时间
    const now = Date.now();
    const lastHeartbeat = endpoint.node?.lastHeartbeatTime || 0;
    const heartbeatThreshold = this.options.heartbeatTimeout || 60000; // 60秒
    
    if (now - lastHeartbeat > heartbeatThreshold) {
      this.healthStatus.set(nodeId, false);
      return false;
    }
    
    // 检查缓存的健康状态
    const cachedHealth = this.healthStatus.get(nodeId);
    const lastCheck = this.lastHealthCheck.get(nodeId) || 0;
    
    // 如果距离上次检查时间超过间隔，需要重新检查
    if (now - lastCheck > this.healthCheckInterval) {
      const isHealthy = this.performHealthCheck(endpoint);
      this.healthStatus.set(nodeId, isHealthy);
      this.lastHealthCheck.set(nodeId, now);
      return isHealthy;
    }
    
    // 返回缓存的健康状态，默认为健康
    return cachedHealth !== false;
  }

  /**
   * 执行具体的健康检查
   * @param endpoint 服务节点
   * @returns 是否健康
   */
  private performHealthCheck(endpoint: Endpoint): boolean {
    try {
      // 检查CPU使用率
      if (endpoint.node?.cpu) {
        const cpuUsage = endpoint.node.cpu.usage || 0;
        const cpuThreshold = this.options.cpuThreshold || 90; // 90%
        
        if (cpuUsage > cpuThreshold) {
          return false;
        }
      }
      
      // 检查内存使用率（如果有相关数据）
      if (endpoint.node?.metadata?.memory) {
        const memoryUsage = endpoint.node.metadata.memory.usage || 0;
        const memoryThreshold = this.options.memoryThreshold || 90; // 90%
        
        if (memoryUsage > memoryThreshold) {
          return false;
        }
      }
      
      // 检查响应时间（如果有相关数据）
      if (endpoint.node?.metadata?.responseTime) {
        const responseTime = endpoint.node.metadata.responseTime;
        const responseTimeThreshold = this.options.responseTimeThreshold || 5000; // 5秒
        
        if (responseTime > responseTimeThreshold) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      // 健康检查出错，认为节点不健康
      return false;
    }
  }

  /**
   * 过滤健康的节点
   * @param list 服务节点列表
   * @returns 健康的节点列表
   */
  private filterHealthyNodes(list: Endpoint[]): Endpoint[] {
    return list.filter(endpoint => this.isNodeHealthy(endpoint));
  }

  /**
   * 使用轮询方式从健康节点中选择
   * @param healthyNodes 健康节点列表
   * @returns 选中的节点
   */
  private selectFromHealthyNodes(healthyNodes: Endpoint[]): Endpoint {
    // 简单轮询选择
    const index = Math.floor(Math.random() * healthyNodes.length);
    return healthyNodes[index];
  }

  /**
   * 请求选择服务节点（健康检查算法）
   * @param list Endpoint[] 服务集群
   * @param ctx Context | undefined
   * @returns Endpoint 服务节点
   */
  public select(list: Endpoint[], ctx?: Context | undefined): Endpoint {
    if (list.length === 0) {
      throw new Error('No available endpoints');
    }

    if (list.length === 1) {
      const endpoint = list[0];
      if (this.isNodeHealthy(endpoint)) {
        return endpoint;
      } else {
        throw new Error('The only available endpoint is unhealthy');
      }
    }

    // 过滤出健康的节点
    const healthyNodes = this.filterHealthyNodes(list);
    
    if (healthyNodes.length === 0) {
      // 没有健康节点，使用备用策略或降级处理
      if (this.fallbackStrategy) {
        return this.fallbackStrategy.select(list, ctx);
      } else {
        // 如果没有备用策略，选择第一个节点作为降级处理
        return list[0];
      }
    }
    
    // 从健康节点中选择
    return this.selectFromHealthyNodes(healthyNodes);
  }

  /**
   * 手动标记节点健康状态
   * @param endpoint 服务节点
   * @param isHealthy 是否健康
   */
  public markNodeHealth(endpoint: Endpoint, isHealthy: boolean): void {
    const nodeId = endpoint.node?.id || endpoint.id;
    this.healthStatus.set(nodeId, isHealthy);
    this.lastHealthCheck.set(nodeId, Date.now());
  }

  /**
   * 重置健康检查状态
   */
  public reset(): void {
    this.healthStatus.clear();
    this.lastHealthCheck.clear();
  }

  /**
   * 获取健康检查统计信息
   * @returns 统计信息
   */
  public getHealthStats(): {
    totalNodes: number;
    healthyNodes: number;
    unhealthyNodes: number;
    healthStatus: Map<string, boolean>;
  } {
    const healthyCount = Array.from(this.healthStatus.values()).filter(status => status).length;
    const totalCount = this.healthStatus.size;
    
    return {
      totalNodes: totalCount,
      healthyNodes: healthyCount,
      unhealthyNodes: totalCount - healthyCount,
      healthStatus: new Map(this.healthStatus)
    };
  }

  /**
   * 设置备用策略
   * @param strategy 备用策略
   */
  public setFallbackStrategy(strategy: BaseStrategy): void {
    this.fallbackStrategy = strategy;
  }
}