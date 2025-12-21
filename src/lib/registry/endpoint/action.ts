import Star from '@/lib/star';
import Registry from '../registry';
import Endpoint from './item';
import Node from '../node';
import ServiceItem from '../service-item';

export default class ActionEndpoint extends Endpoint {
  constructor(registry: Registry, star: Star, node: Node, service: ServiceItem, action: any) {
    super(registry, star, node);

    this.service = service;
    // 修复：添加action为null的防护措施
    if (!action) {
      throw new Error(`Action cannot be null when creating ActionEndpoint for service ${service?.name}`);
    }
    this.action = action;
    // DEBUG: 打印 ActionEndpoint 创建时的 action 信息
    if (service.name === 'gateway' && action.name === 'gateway.dispatch') {
      console.log(
        `[DEBUG-ENDPOINT-CREATE] Created ActionEndpoint for 'gateway.dispatch'. Action is object? ${typeof action === 'object'}. Action keys: ${Object.keys(action).join(',')}`
      );
    }

    this.name = `${this.id}:${this.action?.name}`;
    this.local = node.id === star.nodeID;
    this.state = true;
  }

  public update(action: any): void {
    // 修复：添加action为null的防护措施
    if (!action) {
      throw new Error(`Action cannot be null when updating ActionEndpoint`);
    }
    this.action = action;
  }
}
