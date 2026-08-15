import Star from '@/lib/star';
import Registry from '../registry';
import { LoggerInstance } from '@/typings/logger';
import Node from '../node';
import ServiceItem from '../service-item';
import _ from 'lodash';
import { removeFromArray } from '@/utils';

export default class ServiceCatalog {
  public registry: Registry;
  public star: Star;
  public logger: LoggerInstance;
  public services: Array<ServiceItem>;

  constructor(registry: Registry, star: Star) {
    this.registry = registry;
    this.star = star;
    this.logger = registry.logger;
    this.services = [];
  }

  public add(node: Node, service: any, local: boolean) {
    const item = new ServiceItem(node, service, local);
    this.services.push(item);

    return item;
  }

  public has(fullName: string, nodeID?: string) {
    return this.services.findIndex((service) => service.equals(fullName, nodeID)) !== -1;
  }

  public get(fullName: string, nodeID: string) {
    return this.services.find((service) => service.equals(fullName, nodeID));
  }

  public list(
    options: {
      onlyLocal?: boolean;
      onlyAvaliable?: boolean;
      skipInterval?: boolean;
      withActions?: boolean;
      withEvents?: boolean;
      grouping?: boolean;
    } = {
      onlyLocal: false,
      onlyAvaliable: false,
      skipInterval: false,
      withActions: false,
      withEvents: false,
      grouping: false
    }
  ) {
    let res: Array<any> = [];
    this.services.forEach((service) => {
      if (options.skipInterval && /^\$/.test(service.name)) return;
      if (options.onlyLocal && !service.local) return;
      if (options.onlyAvaliable && !service.node.available) return;

      let item: any;
      if (options.grouping) item = res.find((service) => service.fullName === service.fullName);

      if (!item) {
        item = {
          name: service.name,
          version: service.version,
          fullName: service.fullName,
          settings: service.settings,
          metadata: service.metadata,
          local: service.local,
          available: service.node.available
        };

        if (options.grouping) item.nodes = [service.node.id];
        else item.nodeID = service.node.id;

        if (options.withActions) {
          item.actions = {};

          _.forIn(service.actions, (action) => {
            if (action.protected) return;

            item.actions[action.name] = _.omit(action, ['handler', 'remoteHandler', 'service']);
          });
        }

        if (options.withEvents) {
          item.events = {};

          _.forIn(service.events, (event) => {
            if (/^\$/.test(event.name)) return;

            item.events[event.name] = _.omit(event, ['handler', 'remoteHandler', 'service']);
          });
        }

        res.push(item);
      } else {
        if (item.nodes.indexOf(service.node.id) === -1) {
          item.nodes.push(service.node.id);
        }
      }
    });

    return res;
  }

  /**
   * 获取本地节点的所有服务
   */
  public getLocalNodeServices() {
    let res: Array<any> = [];
    this.services.forEach((service) => {
      if (!service.local) return;

      let item: any = {
        name: service.name,
        version: service.version,
        fullName: service.fullName,
        settings: service.settings,
        metadata: service.metadata,
        dependencies: service.dependencies
      };

      item.actions = {};

      _.forIn(service.actions, (action) => {
        if (action.protected) return;

        item.actions[action.name] = _.omit(action, ['handler', 'remoteHandler', 'service']);
      });

      item.events = {};

      _.forIn(service.events, (event) => {
        item.events[event.name] = _.omit(event, ['handler', 'remoteHandler', 'service']);
      });

      res.push(item);
    });

    return res;
  }

  /**
   * 根据nodeID移除所有的服务
   * @param nodeID
   */
  public removeAllByNodeID(nodeID: string) {
    _.remove(this.services, (service) => {
      if (service.node.id === nodeID) {
        // 移除服务动作
        this.registry.actions.removeByService(service);
        // 移除服务事件
        this.registry.events.removeByService(service);
        return true;
      }

      return false;
    });
  }

  /**
   * 移除端口
   */
  public remove(fullName: string, nodeID: string) {
    let service = this.get(fullName, nodeID);
    if (service) {
      this.registry.actions.removeByService(service);
      this.registry.events.removeByService(service);
      removeFromArray(this.services, service);
    }
  }
}
