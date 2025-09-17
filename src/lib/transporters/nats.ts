import { GenericObject } from '@/typings';
import BaseTransporter from './base';
import Packet from '../packets';
import Transit from '../transit';
import nats, { NatsConnection } from 'nats';
import { PacketTypes } from '@/typings/packets';
import { defaultsDeep } from 'lodash';
import C from '../star/constants';

/**
 * 使用nats服务进行数据通信
 */
export default class NatsTransporter extends BaseTransporter {
  public client: NatsConnection | null; // 客户端
  private useLegacy: boolean; // 是否使用旧版本的nats服务
  public subscriptions: Array<any>; // 订阅的服务

  constructor(options: GenericObject) {
    if (typeof options === 'string') {
      options = { url: options };
    } else if (options == null) {
      options = {};
    }

    // 处理嵌套的options结构
    let natsOptions = options.options || {};
    
    // 合并外层和内层配置
    const mergedOptions = {
      ...options,
      ...natsOptions,
      url: options.host || options.url || natsOptions.url || 'nats://localhost:4222'
    };

    options = defaultsDeep(mergedOptions, {
      url: 'nats://localhost:4222',
      preserveBuffers: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
      maxReconnectTimeWait: 30000,
      timeout: 30000
    });

    super(options);

    if (!this.options) this.options = {};

    if (this.options.preserveBuffers !== false) this.options.preserveBuffers = true;

    if (this.options.maxReconnectAttempts == null) this.options.maxReconnectAttempts = -1;

    // 负载均衡开启
    this.hasBuiltInBalancer = true;
    this.client = null;
    // 使用旧版本的nats
    this.useLegacy = false;
    this.subscriptions = [];
  }

  /**
   * 检查nats包的版本号
   */
  public isLibLegacy(): boolean {
    try {
      const pkg = require('nats/package.json');
      const installedVersion = pkg.version;
      this.logger?.info(`NATS lib version: ${installedVersion}`);

      return installedVersion.split('.')[0] == 1;
    } catch (error: any) {
      this.logger?.warn('Unable to detect NATS library version.', error.message);
      return false;
    }
  }

  public init(
    transit: Transit,
    messageHandler: (cmd: string, msg: Packet) => any,
    afterConnect: (wasReconnect: boolean) => any
  ): void {
    super.init(transit, messageHandler, afterConnect);
    // 检查版本号，是否启用旧版本逻辑
    this.useLegacy = this.isLibLegacy();
  }

  /**
   * 连接nats服务
   */
  public async connect(): Promise<any> {
    let Nats: any;
    try {
      Nats = nats;
    } catch (error: any) {
      this.logger?.fatal(
        `The nats package is missing! Please install it with npm install nats --save command.`,
        error,
        true
      );
      return;
    }

    if (this.useLegacy) {
      // 旧版本兼容
      return new Promise((resolve, reject) => {
        // nats客户端
        const client = Nats.connect(this.options);
        // this._client = client;
        client.on('connect', () => {
          this.client = client;
          this.logger?.info('NATS client v1 is connected.');
          this.onConnected().then(resolve).catch(reject);
        });

        // 重新连接
        client.on('reconnect', () => {
          this.logger?.info('NATS client is reconnected.');
          this.onConnected(true);
        });

        // 正在重新连接中
        client.on('reconnecting', () => {
          this.logger?.warn('NATS client is reconnecting...');
        });

        // 断开连接
        client.on('disconnect', () => {
          if (this.connected) {
            this.logger?.warn('NATS client is disconnected.');
            this.connected = false;
          }
        });

        // 连接发生错误
        client.on('error', (error: any) => {
          this.logger?.error('NATS error.', error.message);
          this.logger?.debug(error);
          
          // 广播错误
          this.star?.broadcastLocal('$transporter.error', {
            error,
            module: 'transporter',
            type: C.FAILED_PUBLISHER_ERROR
          });

          if (!client.connected) reject(error);
        });

        // 关闭服务
        client.on('close', () => {
          this.connected = false;
          this.logger?.warn('NATS connection closed.');
        });
      });
    } else {
      if (this.options.url) {
        Object.assign(
          this.options,
          (this.options.url as string).split(',').reduce((acc: any, cur: string) => {
            const url = new URL(cur);
            acc.servers = Array.isArray(acc.servers) ? (acc.servers as Array<any>).concat(url.host) : [url.host];
            acc.username = acc.username || url.username || undefined;
            acc.password = acc.password || url.password || undefined;

            return acc;
          }, Object.create(null))
        );
      }

      return Nats.connect(this.options)
        .then((client: NatsConnection) => {
          this.client = client;
          this.logger?.info('NATS client v2 is connected');
          // 打印nats客户端的状态
          (async () => {
            for await (const status of (this.client as NatsConnection)?.status()) {
              this.logger?.debug(`NATS client v2 ${status.type}: ${status.data}`);
            }
          })().then();
          // 服务关闭
          client.closed().then(() => {
            this.connected = false;
            this.logger?.info('NATS client v2 connection is closed');
          });

          return this.onConnected();
        })
        .catch((error: Error) => {
          this.logger?.error('NATS error', error.message);
          this.logger?.debug(error);
          
          // 广播错误
          this.star?.broadcastLocal('$transporter.error', {
            error,
            module: 'transporter',
            type: C.FAILED_PUBLISHER_ERROR
          });

          // 抛出错误
          throw error;
        });
    }
  }

  /**
   * 断开连接nats服务
   */
  public disconnect(): Promise<any> {
    if (this.client) {
      if (this.useLegacy) {
        // 兼容旧版本
        return new Promise((resolve) => {
          (this.client as any)?.flush(() => {
            this.client?.close();
            this.client = null;
            resolve(undefined);
          });
        });
      } else {
        // 新版本
        return this.client
          .flush()
          .then(() => {
            this.client?.close();
          })
          .then(() => {
            this.client = null;
          });
      }
    }
    return Promise.resolve();
  }

  /**
   * 获取主题名称
   */
  public getTopicName(cmd: PacketTypes, nodeID?: string): string {
    return this.prefix + '.' + cmd + (nodeID ? '.' + nodeID : '');
  }

  /**
   * 订阅动作
   */
  public subscribe(cmd: PacketTypes, nodeID?: string): Promise<any> {
    const topicName = this.getTopicName(cmd, nodeID);

    try {
      if (this.useLegacy) {
        // 旧版本兼容
        const subID = (this.client as any)?.subscribe(topicName, (msg: Buffer) => {
          try {
            this.receive(cmd, msg);
          } catch (error: any) {
            this.logger?.error('NATS message processing error', error.message);
            this.star?.broadcastLocal('$transporter.error', {
              error,
              module: 'transporter',
              type: C.FAILED_PUBLISHER_ERROR
            });
          }
        });
        this.subscriptions.push(subID);
      } else {
        // 新版本
        const sub = this.client?.subscribe(topicName);
        if (sub) {
          this.subscriptions.push(sub);
          (async () => {
            try {
              for await (const msg of sub) {
                try {
                  this.receive(cmd, Buffer.from(msg.data));
                } catch (error: any) {
                  this.logger?.error('NATS message processing error', error.message);
                  this.star?.broadcastLocal('$transporter.error', {
                    error,
                    module: 'transporter',
                    type: C.FAILED_PUBLISHER_ERROR
                  });
                }
              }
            } catch (error: any) {
              this.logger?.error('NATS subscription error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
            }
          })().then();
        }
      }
    } catch (error: any) {
      this.logger?.error('NATS subscribe error', error.message);
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
    }

    return Promise.resolve();
  }

  /**
   * 负载均衡的请求-响应模式
   */
  public subscribeBalancedRequest(action: string): void {
    const topicName = `${this.prefix}.${PacketTypes.PACKET_REQUEST}B.${action}`;
    const queue = action;

    try {
      if (this.useLegacy) {
        // 旧版本兼容
        this.subscriptions.push(
          (this.client as any)?.subscribe(topicName, { queue }, (msg: Buffer) => {
            try {
              this.receive(PacketTypes.PACKET_REQUEST, msg);
            } catch (error: any) {
              this.logger?.error('NATS balanced request processing error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
            }
          })
        );
      } else {
        const sub = this.client?.subscribe(topicName, { queue });
        if (sub) {
          this.subscriptions.push(sub);
          (async () => {
            try {
              for await (const msg of sub) {
                try {
                  this.receive(PacketTypes.PACKET_REQUEST, Buffer.from(msg.data));
                } catch (error: any) {
                  this.logger?.error('NATS balanced request processing error', error.message);
                  this.star?.broadcastLocal('$transporter.error', {
                    error,
                    module: 'transporter',
                    type: C.FAILED_PUBLISHER_ERROR
                  });
                }
              }
            } catch (error: any) {
              this.logger?.error('NATS balanced request subscription error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
            }
          })().then();
        }
      }
    } catch (error: any) {
      this.logger?.error('NATS balanced request subscribe error', error.message);
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
    }
  }

  /**
   * 负载均衡的发布-订阅模式
   */
  public subscribeBalancedEvent(event: string, group: string): void {
    const topicName = `${this.prefix}.${PacketTypes.PACKET_EVENT}B.${group}.${event}`.replace(/\*\*.*$/g, '>');

    try {
      if (this.useLegacy) {
        // 旧版本兼容
        this.subscriptions.push(
          (this.client as any)?.subscribe(topicName, { queue: group }, (msg: Buffer) => {
            try {
              this.receive(PacketTypes.PACKET_EVENT, msg);
            } catch (error: any) {
              this.logger?.error('NATS balanced event processing error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
            }
          })
        );
      } else {
        const sub = this.client?.subscribe(topicName, { queue: group });
        if (sub) {
          this.subscriptions.push(sub);
          (async () => {
            try {
              for await (const msg of sub) {
                try {
                  this.receive(PacketTypes.PACKET_EVENT, Buffer.from(msg.data));
                } catch (error: any) {
                  this.logger?.error('NATS balanced event processing error', error.message);
                  this.star?.broadcastLocal('$transporter.error', {
                    error,
                    module: 'transporter',
                    type: C.FAILED_PUBLISHER_ERROR
                  });
                }
              }
            } catch (error: any) {
              this.logger?.error('NATS balanced event subscription error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
            }
          })().then();
        }
      }
    } catch (error: any) {
      this.logger?.error('NATS balanced event subscribe error', error.message);
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
    }
  }

  /**
   * 负载均衡的取消所有的订阅
   */
  public unsubscribeFromBalancedCommands(): Promise<void> {
    if (this.useLegacy) {
      // 旧版本兼容
      return new Promise((resolve) => {
        this.subscriptions.forEach((uid) => (this.client as any).unsubscribe(uid));
        this.subscriptions = [];
        (this.client as any)?.flush(resolve);
      });
    } else {
      // V2
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions = [];

      return this.client?.flush() || Promise.resolve();
    }
  }

  /**
   * 发送数据
   */
  public send(topic: string, data: Buffer): Promise<any> {
    if (!this.client) return Promise.resolve();

    try {
      if (this.useLegacy) {
        // 旧版本兼容
        return new Promise((resolve, reject) => {
          (this.client as any).publish(topic, data, (error: any) => {
            if (error) {
              this.logger?.error('NATS send error', error.message);
              this.star?.broadcastLocal('$transporter.error', {
                error,
                module: 'transporter',
                type: C.FAILED_PUBLISHER_ERROR
              });
              reject(error);
            } else {
              resolve(undefined);
            }
          });
        });
      } else {
        // V2
        this.client.publish(topic, data);
        return Promise.resolve();
      }
    } catch (error: any) {
      this.logger?.error('NATS send error', error.message);
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
      return Promise.reject(error);
    }
  }
}
