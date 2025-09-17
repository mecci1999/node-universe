import { GenericObject } from '@/typings';
import BaseTransporter from './base';
import Mqtt from 'mqtt';
import { PacketTypes } from '@/typings/packets';
import _ from 'lodash';
import C from '../star/constants';

type QoS = 0 | 1 | 2;

export default class MqttTransporter extends BaseTransporter {
  public qos: QoS;
  public topicSeparator: string; // 分隔符
  public client: Mqtt.MqttClient | null;

  constructor(options: GenericObject) {
    if (typeof options === 'string') {
      options = { url: options };
    } else if (options == null) {
      options = {};
    }

    // 处理嵌套的options结构
    let mqttOptions = options.options || {};
    
    // 合并外层和内层配置
    const mergedOptions = {
      ...options,
      ...mqttOptions,
      url: options.host || options.url || mqttOptions.url || 'mqtt://localhost:1883'
    };

    options = _.defaultsDeep(mergedOptions, {
      url: 'mqtt://localhost:1883',
      qos: 0,
      topicSeparator: '.',
      keepalive: 60,
      connectTimeout: 30000,
      reconnectPeriod: 1000,
      clean: true
    });

    super(options);
    
    this.qos = this.options.qos || 0;
    this.topicSeparator = this.options.topicSeparator || '.';
    this.client = null;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let mqtt;
      try {
        mqtt = Mqtt;
      } catch (error: any) {
        this.star?.fatal(
          'The mqtt package is missing. Please install it with npm install mqtt --save command.',
          error,
          true
        );
        return;
      }

      const client = Mqtt.connect(this.options);

      // 连接
      client.on('connect', () => {
        this.client = client;
        this.logger?.info('MQTT client is connected.');
        this.onConnected().then(resolve).catch(reject);
      });

      // 报错
      client.on('error', (error: any) => {
        this.logger?.error('MQTT error.', error.message);
        this.logger?.debug('MQTT error', error);
        
        // 广播错误
        this.star?.broadcastLocal('$transporter.error', {
          error,
          module: 'transporter',
          type: C.FAILED_PUBLISHER_ERROR
        });

        if (!client.connected) reject(error);
      });

      // 重新连接
      client.on('reconnect', () => {
        this.logger?.warn('MQTT client is reconnecting...');
      });

      // 消息通知
      client.on('message', (rawTopic, buf) => {
        try {
          const topic = rawTopic.substring(this.prefix.length + this.topicSeparator.length);
          const cmd = topic.split(this.topicSeparator)[0] as PacketTypes;
          this.receive(cmd, buf);
        } catch (error: any) {
          this.logger?.error('Error processing MQTT message', error);
        }
      });

      // 断开连接
      client.on('close', () => {
        this.connected = false;
        this.logger?.warn('MQTT client is disconnected.');
      });
    });
  }

  /**
   * 断开连接
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      return new Promise((resolve) => {
        this.client?.end(false, () => {
          this.client = null;
          resolve();
        });
      });
    }
  }

  /**
   * 获取事件名称
   */
  public getTopicName(cmd: string, nodeID: string): string {
    return this.prefix + this.topicSeparator + cmd + (nodeID ? this.topicSeparator + nodeID : '');
  }

  /**
   * 订阅动作
   */
  public subscribe(cmd: PacketTypes, nodeID: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const topic = this.getTopicName(cmd, nodeID);
      this.client?.subscribe(topic, { qos: this.qos }, (error, granted) => {
        if (error) {
          this.logger?.error('MQTT subscribe error', error);
          return reject(error);
        }

        this.logger?.debug('MQTT server granted', granted);
        resolve();
      });
    });
  }

  /**
   * 订阅多个主题 - 匹配Kafka传输器接口
   */
  public async makeSubscriptions(topics: GenericObject[]): Promise<void> {
    try {
      for (const { cmd, nodeID } of topics) {
        await this.subscribe(cmd, nodeID);
      }
      this.logger?.info(`MQTT subscribed to ${topics.length} topics`);
    } catch (error: any) {
      this.logger?.error('Unable to subscribe to MQTT topics!', topics, error);
      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_TOPIC_CREATION
      });
      throw error;
    }
  }

  /**
   * 发送动作
   */
  public async send(topic: string, data: Buffer, { packet }): Promise<void> {
    if (!this.client) return Promise.resolve();

    try {
      await new Promise<void>((resolve, reject) => {
        const topicName = this.getTopicName(packet.type, packet.target);
        this.client?.publish(topicName, data, { qos: this.qos }, (error) => {
          if (error) {
            this.logger?.error('MQTT publish error', error);
            return reject(error);
          }
          resolve();
        });
      });
    } catch (error: any) {
      this.logger?.error('MQTT Server Publish error', error);

      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });

      throw error;
    }
  }
}
