import _ from 'lodash';
import Registry from '../registry';
import Star from '@/lib/star';
import { GenericObject } from '@/typings';
import { LoggerInstance } from '@/typings/logger';
import Endpoint from './item';
import BaseStrategy from '@/lib/strategies/base';
import Node from '../node';
import EventEndpoint from './event';
import ActionEndpoint from './action';
import { getConstructorName } from '@/utils';
import Context from '@/lib/context';
import { StarServerError } from '@/lib/error';
import { UniverseErrorCode, UniverseErrorOptionsType } from '@/typings/error';
import ServiceItem from '../service-item';

export default class EndpointList {
  public registry: Registry;
  public star: Star;
  public logger: LoggerInstance | null = null;
  public name: string;
  public group: string | null;
  public internal: boolean;
  public EndPointFactory: typeof Endpoint | typeof EventEndpoint | typeof ActionEndpoint;
  public endpoints: Endpoint[];
  public localEndpoints: Endpoint[];
  public strategy: any; // 通信策略

  constructor(
    registry: Registry,
    star: Star,
    name: string,
    group: string | null,
    EndPointFactory: typeof Endpoint | typeof EventEndpoint | typeof ActionEndpoint,
    StrategyFactory: typeof BaseStrategy,
    strategyOptions?: GenericObject
  ) {
    this.registry = registry;
    this.star = star;
    this.logger = registry.logger;
    this.strategy = new StrategyFactory(registry, star, strategyOptions);
    this.name = name;
    this.group = group;
    this.internal = name.startsWith('$');
    this.EndPointFactory = EndPointFactory;
    this.endpoints = [];
    this.localEndpoints = [];
  }

  /**
   * 添加endpoint
   */
  public add(node: Node, service: ServiceItem, data: any): Endpoint {
    const found = this.endpoints.find((endpoint) => endpoint.node === node && endpoint.service?.name === service.name);
    if (found) {
      found.update(data);

      return found;
    }

    let endpoint: any;
    const name = getConstructorName(this.EndPointFactory);

    // 修复：放宽匹配条件，或直接使用 instanceof 检查 (如果可以的话，但 EndPointFactory 是构造函数)
    // 或者直接硬编码检查常见的名称变体，或者修改逻辑以更可靠地识别

    switch (name) {
      case 'EventEndpoint': {
        endpoint = new EventEndpoint(this.registry, this.star, node, service, data);
        break;
      }
      case 'ActionEndpoint':
      // 修复：如果名字匹配失败但我们知道它应该是 ActionEndpoint (基于上下文或 factory 比较)
      // 由于我们传入了 EndPointFactory，我们可以直接比较引用，而不是依赖名字字符串
      case this.EndPointFactory === ActionEndpoint ? name : 'MATCH_BY_REFERENCE_HACK': {
        // 这行语法无效，仅为注释思路
        endpoint = new ActionEndpoint(this.registry, this.star, node, service, data);
        break;
      }
      default: {
        // 终极修复：直接比较构造函数引用，而不是依赖不可靠的字符串名称
        if (this.EndPointFactory === ActionEndpoint) {
          endpoint = new ActionEndpoint(this.registry, this.star, node, service, data);
        } else if (this.EndPointFactory === EventEndpoint) {
          endpoint = new EventEndpoint(this.registry, this.star, node, service, data);
        } else {
          endpoint = new Endpoint(this.registry, this.star, node);
        }
        break;
      }
    }
    this.endpoints.push(endpoint);
    this.setLocalEndpoints();

    return endpoint;
  }

  /**
   * 获取当前本地端点
   */
  public setLocalEndpoints() {
    this.localEndpoints = this.endpoints.filter((ep) => ep.local);
  }

  /**
   * 获取第一个端点
   */
  public getFirst() {
    if (this.endpoints.length > 0) return this.endpoints[0];

    return null;
  }

  /**
   * 根据通信策略选择下一个端点
   */
  public select(list: Endpoint[], ctx?: Context) {
    const res: Endpoint = this.strategy.select(list, ctx);
    if (!res) {
      throw new StarServerError(
        'Strategy returned an invalid endpoint.',
        UniverseErrorCode.SERVICE_ERROR,
        UniverseErrorOptionsType.INVALID_ENDPOINT,
        { strategy: getConstructorName(this.strategy) }
      );
    }

    return res;
  }

  /**
   * 得到下一个端点
   */
  public next(ctx: Context) {
    if (this.endpoints.length === 0) return null;

    if (this.internal && this.hasLocal()) {
      return this.nextLocal();
    }

    if (this.endpoints.length === 1) {
      const item = this.endpoints[0];
      if (item.isAvailable) return item;

      return null;
    }

    if (this.registry.options?.preferLocal === true && this.hasLocal()) {
      const ep = this.nextLocal(ctx);
      if (ep && ep.isAvailable) return ep;
    }

    const epList = this.endpoints.filter((ep) => ep.isAvailable);
    if (epList.length === 0) return null;

    return this.select(epList, ctx);
  }

  /**
   * 是否有本地节点
   * @returns
   */
  public hasLocal() {
    return this.localEndpoints.length > 0;
  }

  /**
   * 获取下一个本地节点
   * @param ctx
   * @returns
   */
  public nextLocal(ctx?: Context) {
    if (this.localEndpoints.length === 0) {
      return null;
    }

    if (this.localEndpoints.length === 1) {
      const item = this.localEndpoints[0];
      if (item.isAvailable) return item;

      return null;
    }

    const epList = this.localEndpoints.filter((ep) => ep.isAvailable);
    if (epList.length === 0) return null;

    return this.select(epList, ctx);
  }

  /**
   * 检查是否存在有用的节点
   */
  public hasAvailable() {
    return this.endpoints.find((ep) => ep.isAvailable) != null;
  }

  /**
   * 节点的数量
   */
  public count() {
    return this.endpoints.length;
  }

  /**
   * 通过nodeID获取节点
   */
  public getEndpointByNodeID(nodeID: string) {
    const ep = this.endpoints.find((item) => item.id === nodeID);
    if (ep && ep.isAvailable) return ep;

    return null;
  }

  /**
   * 检查端点中是否存在nodeID
   */
  public hasNodeID(nodeID: string) {
    return this.endpoints.find((ep) => ep.id === nodeID) != null;
  }

  /**
   * 移除某个服务
   */
  public removeByService(service: ServiceItem) {
    _.remove(this.endpoints, (ep) => {
      if (ep.service == service) {
        ep.destory();
        return true;
      }
    });

    this.setLocalEndpoints();
  }

  /**
   * 通过nodeID移除对应的端点
   */
  public removeByNodeID(nodeID: string) {
    _.remove(this.endpoints, (ep) => {
      if (ep.id === nodeID) {
        ep.destory();
        return true;
      }
    });

    this.setLocalEndpoints();
  }
}
