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
    this.name = `${this.id}:${this.action?.name}`;
  }

  public update(action: any): void {
    // 修复：添加action为null的防护措施
    if (!action) {
      throw new Error(`Action cannot be null when updating ActionEndpoint`);
    }
    this.action = action;
  }
}
