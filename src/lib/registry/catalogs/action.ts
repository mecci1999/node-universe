import Star from '@/lib/star';
import Registry from '../registry';
import BaseStrategy from '@/lib/strategies/base';
import { LoggerInstance } from '@/typings/logger';
import ActionEndpoint from '../endpoint/action';
import Node from '../node';
import ServiceItem from '../service-item';
import strategies from '@/lib/strategies';
import EndpointList from '../endpoint/list';
import _ from 'lodash';
import { getConstructorName } from '@/utils';

export default class ActionCatalog {
  public registry: Registry;
  public star: Star;
  public logger: LoggerInstance;
  public StrategyFactory: typeof BaseStrategy;
  public actions: Map<string, EndpointList>;
  public EndpointFactory: typeof ActionEndpoint;

  constructor(registry: Registry, star: Star, StrategyFactory: typeof BaseStrategy) {
    this.registry = registry;
    this.star = star;
    this.logger = registry.logger;
    this.StrategyFactory = StrategyFactory;
    this.actions = new Map();
    this.EndpointFactory = ActionEndpoint;
  }

  /**
   * 添加一个事件
   * @param node
   * @param service
   * @param action
   */
  public add(node: Node, service: ServiceItem, action: any) {
    let list = this.actions.get(action.name);
    if (!list) {
      const strategyFactory = action.strategy
        ? strategies.resolve(action.strategy) || this.StrategyFactory
        : this.StrategyFactory;
      const strategyOptions = action.strategyOptions ? action.strategyOptions : this.registry.options.strategyOptions;
      // 创建列表
      list = new EndpointList(
        this.registry,
        this.star,
        action.name,
        null,
        this.EndpointFactory,
        strategyFactory,
        strategyOptions
      );
      this.actions.set(action.name, list);
    }

    // DEBUG: 检查 EndpointFactory 是否正确
    if (action.name === 'gateway.dispatch') {
      console.log(
        `[DEBUG-ACTION-CATALOG] Adding action 'gateway.dispatch'. EndpointFactory name: ${getConstructorName(this.EndpointFactory)}`
      );
    }

    const endpoint = list.add(node, service, action);

    // DEBUG: 检查添加后的 endpoint 状态
    if (action.name === 'gateway.dispatch') {
      console.log(
        `[DEBUG-ACTION-CATALOG] Added endpoint for 'gateway.dispatch'. Endpoint Action is null? ${endpoint.action === null}`
      );
    }

    return list;
  }

  /**
   * 通过action名字获取动作
   */
  public get(name: string) {
    return this.actions.get(name);
  }

  /**
   * 检查是否有效
   */
  public isAvailable(name: string) {
    const list = this.actions.get(name);
    if (list) return list.hasAvailable();

    return false;
  }

  /**
   * 移除某个服务的所有动作
   */
  public removeByService(service: ServiceItem) {
    this.actions.forEach((list) => {
      list.removeByService(service);
    });
  }

  /**
   * 移除某个nodeID的所有动作
   * @param name
   * @param nodeID
   */
  public remove(name: string, nodeID: string) {
    const list = this.actions.get(name);
    if (list) list.removeByNodeID(nodeID);
  }

  /**
   * 获得动作列表
   */
  public list(
    options: { onlyLocal?: boolean; onlyAvaliable?: boolean; skipInterval?: boolean; withEndpoints?: boolean } = {
      onlyLocal: false,
      onlyAvaliable: false,
      skipInterval: false,
      withEndpoints: false
    }
  ) {
    let res: Array<any> = [];
    this.actions.forEach((list, key) => {
      if (options.skipInterval && /^\$/.test(key)) return;
      if (options.onlyLocal && !list.hasLocal()) return;
      if (options.onlyAvaliable && !list.hasAvailable()) return;

      let item: any = {
        name: key,
        count: list.count(),
        hasLocal: list.hasLocal(),
        available: list.hasAvailable()
      };

      if (item.count > 0) {
        const ep = list.endpoints[0];
        if (ep) item.action = _.omit(ep.action, ['handler', 'remoteHandler', 'service']);
      }

      if (item.action && item.action.protected === true) return;

      if (options.withEndpoints) {
        if (item.count > 0) {
          item.endpoints = list.endpoints.map((ep) => {
            return {
              nodeID: ep.node.id,
              state: ep.state,
              available: ep.node.available
            };
          });
        }
      }

      res.push(item);
    });

    return res;
  }
}
