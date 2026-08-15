import _ from 'lodash';
import { StarDisconnectedError } from '../error';
import Packet from '../packets';
import { GenericObject } from '@/typings';
import type Transit from '../transit';
import type Star from '../star';
import { PROTOCOL_VERSION } from '../star/protocol';
import { LoggerInstance } from '@/typings/logger';
import { PacketTypes } from '@/typings/packets';

export default class BaseTransporter {
  public options: GenericObject;
  public connected: boolean; // 是否已连接
  public hasBuiltInBalancer: boolean; // 是否内置负载均衡处理
  public transit: Transit | null = null;
  public star: Star | null = null;
  public nodeID: string = '';
  public logger: LoggerInstance | null = null;
  public prefix: string = '';
  public messageHandler: ((cmd: string, msg: Packet) => any) | null = null;
  public afterConnect: ((wasReconnect: boolean) => any) | null = null;

  constructor(options: GenericObject) {
    this.options = options;
    this.connected = false;
    this.hasBuiltInBalancer = false;
  }

  /**
   * 初始化
   * @param transit
   * @param messageHandler
   * @param afterConnect
   */
  public init(
    transit: Transit,
    messageHandler: (cmd: string, msg: Packet) => any,
    afterConnect: (wasReconnect: boolean) => any
  ) {
    if (transit) {
      this.transit = transit;
      this.star = transit.star;
      this.nodeID = transit.nodeID;
      this.logger = this.star.getLogger('transporter');

      this.prefix = 'Universer';
      if (this.star.namespace) this.prefix += '-' + this.star.namespace;
    }
    this.messageHandler = messageHandler;
    this.afterConnect = afterConnect;
  }

  // 连接通信服务
  public connect() {
    throw new Error('Not implemented!');
  }

  /**
   * 连接
   */
  public onConnected(wasReconnect: boolean = false): Promise<any> {
    this.connected = true;
    if (this.afterConnect) {
      return this.afterConnect(wasReconnect);
    }

    return Promise.resolve();
  }

  /**
   * 断开连接
   */
  public disconnect() {
    throw new Error('Not implemented!');
  }

  /**
   * 订阅动作
   */
  public subscribe(cmd: PacketTypes, nodeID: string) {
    throw new Error('Not implemented!');
  }

  /**
   * 负载均衡的订阅请求
   */
  public subscribeBalancedRequest(action: string) {
    throw new Error('Not implemented!');
  }

  /**
   * 负载均衡的订阅事件
   */
  public subscribeBalancedEvent(event: string, group: string) {
    throw new Error('Not implemented!');
  }

  /**
   * 取消订阅所有的请求和事件
   */
  public unsubscribeFromBalancedCommands() {
    return Promise.resolve();
  }

  /**
   * 发布动作
   */
  public publish(packet: Packet) {
    // 获取主题名
    const topic = this.getTopicName(packet.type, packet.target);
    // 序列化发送的包
    const data = this.serialize(packet);
    if (data) {
      return this.send(topic, data, { packet });
    }
  }

  /**
   * 负载均衡的发布请求
   */
  public publishBalancedRequest(packet: Packet) {
    const topic = `${this.prefix}.${PacketTypes.PACKET_REQUEST}B.${packet.payload?.action}`;
    const data = this.serialize(packet);
    if (data) {
      return this.send(topic, data, { packet, balanced: true });
    }
  }

  /**
   * 负载均衡的发布事件
   */
  public publishBalancedEvent(packet: Packet, group: string) {
    const topic = `${this.prefix}.${PacketTypes.PACKET_EVENT}B.${group}.${packet.payload?.event}`;
    const data = this.serialize(packet);
    if (data) {
      return this.send(topic, data, { packet, balanced: true });
    }
  }

  /**
   * 负载均衡机制处理订阅动作
   */
  public makeBalancedSubscriptions() {
    // 判断是否开启负载均衡
    // if (!this.hasBuiltInBalancer) return Promise.resolve();
    // return this.unsubscribeFromBalancedCommands().then(() => {
    //   const services = this.star;
    //   return Promise.all()
    // })
  }

  /**
   * 负载均衡的发布数据包
   */
  public prepublish(packet: Packet) {
    if (!this.connected) {
      // 对于用户故意触发的数据包，抛出可重试错误。
      if ([PacketTypes.PACKET_REQUEST, PacketTypes.PACKET_EVENT, PacketTypes.PACKET_PING].includes(packet.type)) {
        return Promise.reject(new StarDisconnectedError());
      } else {
        // 对于内部数据包，如INFO和HEARTBEATS，跳过发送，不抛出
        return Promise.resolve();
      }
    }

    if (packet.type === PacketTypes.PACKET_EVENT && packet.target == null && packet.payload.groups) {
      const groups = packet.payload.groups;
      // 如果数据包中包含组名，我们不直接发送数据包到对应的node节点，而是选择将它push到事件队列中，等待负载均衡
      if (groups.length > 0) {
        groups.forEach((group) => {
          const copy = _.cloneDeep(packet);
          copy.payload.groups = [group];
          // 将包推入到负载均衡的事件队列中
          this.publishBalancedEvent(copy, group);
        });

        return Promise.resolve();
      }
    } else if (packet.type === PacketTypes.PACKET_REQUEST && packet.target == null) {
      // 如果不包含目标节点，则正常发送该数据包
      return this.publishBalancedRequest(packet);
    } else {
      // 正常发送
      return this.publish(packet);
    }
  }

  /**
   * 订阅所有的主题
   */
  public makeSubscriptions(topics: GenericObject[]): Promise<any> {
    return Promise.all(topics.map(({ cmd, nodeID }) => this.subscribe(cmd, nodeID)));
  }

  /**
   * 接收包
   */
  public incomingMessage(cmd: PacketTypes, msg: Buffer) {
    if (!msg) return;

    try {
      const packet = this.deserialize(cmd, msg);
      return packet && this.messageHandler && this.messageHandler(cmd, packet);
    } catch (error) {
      this.logger?.warn('Invalid incoming packet. Type:', cmd, error);
      this.logger?.debug('Content:', msg.toString ? msg.toString() : msg);
    }
  }

  /**
   * 接收动作
   */
  public receive(cmd: PacketTypes, data: Buffer) {
    return this.incomingMessage(cmd, data);
  }

  /**
   * 发送动作
   */
  public send(topic: string, data: Buffer, meta: object) {
    throw new Error('Not implemented!');
  }

  /**
   * 序列化需要发送的包
   */
  public serialize(packet: Packet): Buffer | null {
    packet.payload.version = PROTOCOL_VERSION;
    packet.payload.sender = this.nodeID;

    if (!(this.star && this.star.serializer)) return null;

    return this.star.serializer.serialize(packet.payload, packet.type) as Buffer;
  }

  /**
   * 反序列化接收的包获得数据
   */
  public deserialize(type: PacketTypes, buf: Buffer): Packet | null {
    if (buf == null) return null;

    if (!(this.star && this.star.serializer)) return null;

    const msg = this.star.serializer.deserialize(buf, type) as GenericObject;
    return new Packet(type, null, msg);
  }

  /**
   * 获取主题名
   */
  public getTopicName(cmd: string, nodeID: string) {
    return this.prefix + '.' + cmd + (nodeID ? '.' + nodeID : '');
  }
}
