import Star from '@/lib/star';
import Registry from '../registry';
import BaseStrategy from '@/lib/strategies/base';
import { LoggerInstance } from '@/typings/logger';
import EndpointList from '../endpoint/list';
import EventEndpoint from '../endpoint/event';
import Node from '../node';
import ServiceItem from '../service-item';
import strategies from '@/lib/strategies';
import Context from '@/lib/context';
import { match } from '@/utils';
import _ from 'lodash';

export default class EventCatalog {
  public registry: Registry;
  public star: Star;
  public logger: LoggerInstance;
  public StrategyFactory: typeof BaseStrategy;
  public events: Array<EndpointList>;
  public EndpointFactory: typeof EventEndpoint;

  constructor(registry: Registry, star: Star, StrategyFactory: typeof BaseStrategy) {
    this.registry = registry;
    this.star = star;
    this.logger = registry.logger;
    this.StrategyFactory = StrategyFactory;
    this.events = [];
    this.EndpointFactory = EventEndpoint;
  }

  /**
   * 添加一个事件
   * @param node
   * @param service
   * @param event
   */
  public add(node: Node, service: ServiceItem, event: any) {
    const eventName = event.name;
    const groupName = event.group || service.name;
    let list = this.get(eventName, groupName);
    if (!list) {
      const strategyFactory = event.strategy
        ? strategies.resolve(event.strategy) || this.StrategyFactory
        : this.StrategyFactory;
      const strategyOptions = event.strategyOptions ? event.strategyOptions : this.registry.options.strategyOptions;
      // 创建列表
      list = new EndpointList(
        this.registry,
        this.star,
        eventName,
        groupName,
        this.EndpointFactory,
        strategyFactory,
        strategyOptions
      );
      this.events.push(list);
    }

    list.add(node, service, event);

    return list;
  }

  /**
   * 获取事件列表
   */
  public get(eventName: string, groupName: string) {
    return this.events.find((event) => event.name === eventName && event.group === groupName);
  }

  /**
   * 负载均衡的获取要执行的节点
   */
  public getBalancedEndpoints(eventName: string, groups: string | Array<string> | null, ctx: Context) {
    const res: Array<any> = [];

    this.events.forEach((list) => {
      if (!match(eventName, list.name)) return;
      if (groups == null || groups.length === 0 || (list.group && groups.indexOf(list.group) !== -1)) {
        const ep = list.next(ctx);
        if (ep && ep.isAvailable) res.push([ep, list.group]);
      }
    });

    return res;
  }

  /**
   * 获取事件中包含的所有分组
   */
  public getGroups(eventName: string) {
    return _.uniq(this.events.filter((list) => match(eventName, list.name)).map((item) => item.group));
  }

  /**
   * 获取事件中包含的所有节点
   */
  public getAllEndpoints(eventName: string, groupsNames?: Array<string>) {
    const res: Array<any> = [];
    this.events.forEach((list) => {
      if (!match(eventName, list.name)) return;

      if (groupsNames == null || groupsNames.length === 0 || (list.group && groupsNames.indexOf(list.group) !== -1)) {
        list.endpoints.forEach((ep) => {
          if (ep.isAvailable) res.push(ep);
        });
      }
    });

    return _.uniqBy(res, 'id');
  }

  /**
   * 事件处理器
   */
  public callEventHandler(ctx: Context) {
    if (ctx?.endpoint && ctx?.endpoint?.event && ctx?.endpoint?.event.handler) {
      return ctx.endpoint.event.handler(ctx);
    }
  }

  /**
   * 通知所有的本地服务做出事件处理
   */
  public emitLocalServices(ctx: Context) {
    // 是否为广播动作
    const isBroadcast = ['broadcast', 'broadcastLocal'].indexOf(ctx?.eventType || '') !== -1;
    // 发送方
    const sender = ctx.nodeID;
    const promises: Array<any> = [];

    this.events.forEach((list) => {
      if (!match(ctx?.eventName || '', list.name)) return;
      if (
        ctx.eventGroups == null ||
        ctx.eventGroups.length == 0 ||
        (list.group && ctx.eventGroups.indexOf(list.group) !== -1)
      ) {
        if (isBroadcast) {
          list.endpoints.forEach((ep) => {
            if (ep.local && ep.event && ep.event.handler) {
              const newCtx = ctx.copy(ep);
              newCtx.nodeID = sender;
              promises.push(this.callEventHandler(newCtx));
            }
          });
        } else {
          const ep = list.nextLocal(ctx);
          if (ep && ep.event && ep.event.handler) {
            const newCtx = ctx.copy(ep);
            newCtx.nodeID = sender;
            promises.push(this.callEventHandler(newCtx));
          }
        }
      }
    });

    return Promise.all(promises);
  }

  /**
   * 移除某个服务的所有动作
   */
  public removeByService(service: ServiceItem) {
    this.events = this.events.filter((list) => {
      list.removeByService(service);
      return list.count() > 0;
    });
  }

  /**
   * 移除某个nodeID的所有动作
   * @param name
   * @param nodeID
   */
  public remove(name: string, nodeID: string) {
    this.events = this.events.filter((item) => {
      if (item.name === name) item.removeByNodeID(nodeID);
      return item.count() > 0;
    });
  }

  public list(
    options: { onlyLocal?: boolean; onlyAvaliable?: boolean; skipInterval?: boolean; withEndpoints?: boolean } = {
      onlyLocal: false,
      onlyAvaliable: false,
      skipInterval: false,
      withEndpoints: false
    }
  ) {
    let res: Array<any> = [];
    this.events.forEach((list) => {
      if (options.skipInterval && /^\$/.test(list.name)) return;
      if (options.onlyLocal && !list.hasLocal()) return;
      if (options.onlyAvaliable && !list.hasAvailable()) return;

      let item: any = {
        name: list.name,
        count: list.count(),
        hasLocal: list.hasLocal(),
        available: list.hasAvailable()
      };

      if (item.count > 0) {
        const ep = list.endpoints[0];
        if (ep) item.event = _.omit(ep.event, ['handler', 'remoteHandler', 'service']);
      }

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
