import Star from '@/lib/star';
import Registry from '../registry';
import Node from '../node';
import { ActionSchema } from '@/typings/context';
import { EventSchema } from '@/typings/context/event';
import Service from '@/lib/star/service';
import ServiceItem from '../service-item';

export default class Endpoint {
  public registry: Registry;
  public star: Star;
  public id: string;
  public node: Node;
  public local: boolean;
  public state: boolean;
  // 移除默认初始化，改为在构造函数中初始化
  public action: ActionSchema | null;
  public event: EventSchema | null;
  public service: ServiceItem | null;
  public name: string;

  constructor(registry: Registry, star: Star, node: Node, service?: Service, event?: any) {
    this.registry = registry;
    this.star = star;
    this.id = node.id;
    this.node = node;
    this.local = node.id === star.nodeID;
    this.state = true;

    // 初始化为 null，除非子类已经赋值（虽然子类还没运行，但为了保险起见）
    // 注意：TypeScript 可能会生成在构造函数顶部的初始化代码，这可能会覆盖子类的赋值
    // 最好的方式是移除字段声明处的初始化
    this.action = null;
    this.event = null;
    this.service = null;
    this.name = '';
  }

  /**
   * 是否运行正常
   */
  public get isAvailable() {
    return this.state;
  }

  /**
   * 销毁
   */
  public destory() {}

  /**
   * 更新
   */
  public update(data: any) {}
}
