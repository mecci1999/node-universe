import { GenericObject } from '@/typings';
import { Registry } from '../registry';
import Star from '../star';
import BaseStrategy from './base';
import Context from '../context';
import Endpoint from '../registry/endpoint/item';

/**
 * 加权轮询策略模式
 * 根据节点权重分配请求，权重高的节点获得更多请求
 * 适用于异构环境中的负载均衡
 */
export default class WeightedRoundRobinStrategy extends BaseStrategy {
  private currentWeights: Map<string, number>;
  private effectiveWeights: Map<string, number>;

  constructor(registry: Registry, star: Star, options?: GenericObject) {
    super(registry, star, options);
    
    this.currentWeights = new Map();
    this.effectiveWeights = new Map();
  }

  /**
   * 获取节点权重
   * @param endpoint 服务节点
   * @returns 权重值
   */
  private getWeight(endpoint: Endpoint): number {
    // 从节点配置中获取权重，默认为1
    return endpoint.node?.config?.weight || this.options.defaultWeight || 1;
  }

  /**
   * 初始化权重映射
   * @param list 服务节点列表
   */
  private initializeWeights(list: Endpoint[]): void {
    for (const endpoint of list) {
      const nodeId = endpoint.node?.id || endpoint.id;
      const weight = this.getWeight(endpoint);
      
      if (!this.currentWeights.has(nodeId)) {
        this.currentWeights.set(nodeId, 0);
      }
      if (!this.effectiveWeights.has(nodeId)) {
        this.effectiveWeights.set(nodeId, weight);
      }
    }
  }

  /**
   * 计算总权重
   * @param list 服务节点列表
   * @returns 总权重
   */
  private getTotalWeight(list: Endpoint[]): number {
    return list.reduce((total, endpoint) => {
      return total + this.getWeight(endpoint);
    }, 0);
  }

  /**
   * 请求选择服务节点（加权轮询算法）
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

    // 初始化权重映射
    this.initializeWeights(list);

    let selectedEndpoint: Endpoint | null = null;
    let maxCurrentWeight = -1;
    const totalWeight = this.getTotalWeight(list);

    // 加权轮询算法核心逻辑
    for (const endpoint of list) {
      const nodeId = endpoint.node?.id || endpoint.id;
      const weight = this.getWeight(endpoint);
      
      // 增加当前权重
      const currentWeight = (this.currentWeights.get(nodeId) || 0) + weight;
      this.currentWeights.set(nodeId, currentWeight);

      // 选择当前权重最大的节点
      if (currentWeight > maxCurrentWeight) {
        maxCurrentWeight = currentWeight;
        selectedEndpoint = endpoint;
      }
    }

    // 减少被选中节点的权重
    if (selectedEndpoint) {
      const selectedNodeId = selectedEndpoint.node?.id || selectedEndpoint.id;
      const currentWeight = this.currentWeights.get(selectedNodeId) || 0;
      this.currentWeights.set(selectedNodeId, currentWeight - totalWeight);
    }

    return selectedEndpoint || list[0];
  }

  /**
   * 重置权重计数器
   */
  public reset(): void {
    this.currentWeights.clear();
    this.effectiveWeights.clear();
  }
}