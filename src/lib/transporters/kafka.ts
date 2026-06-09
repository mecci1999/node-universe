import { GenericObject } from '@/typings';
import BaseTransporter from './base';
import { Kafka, Producer, Consumer, Admin } from 'kafkajs';
import _ from 'lodash';
import { PacketTypes } from '@/typings/packets';
import C from '../star/constants';

export default class KafkaTransporter extends BaseTransporter {
  public client: Kafka | null;
  public producer: Producer | null;
  public consumer: Consumer | null;
  public admin: Admin | null;

  constructor(options: any) {
    if (typeof options === 'string') {
      options = { brokers: [options.replace('kafka://', '')] };
    } else if (options == null) {
      options = {};
    }

    // 处理嵌套的options结构
    let kafkaOptions = options.options || {};

    // 合并外层和内层配置
    const mergedOptions = {
      ...options,
      ...kafkaOptions,
      brokers: options.host ? [options.host] : kafkaOptions.brokers || ['localhost:9092'],
      ssl: kafkaOptions.ssl !== undefined ? kafkaOptions.ssl : false,
      sasl: kafkaOptions.sasl || null
    };

    options = _.defaultsDeep(mergedOptions, {
      brokers: ['localhost:9092'],
      clientId: 'node-universe-kafka-client',
      ssl: false,
      sasl: null,
      connectionTimeout: 3000,
      requestTimeout: 30000,
      logLevel: 'NOTHING', // 默认禁用kafkajs内部日志
      producer: {
        maxInFlightRequests: 1,
        idempotent: false,
        transactionTimeout: 30000
      },
      consumer: {
        groupId: 'node-universe-group',
        sessionTimeout: 30000,
        heartbeatInterval: 3000
      },
      publish: {
        partition: 0
      }
    });

    super(options);

    this.client = null;
    this.producer = null;
    this.consumer = null;
    this.admin = null;
  }

  /**
   * 连接
   */
  public async connect(): Promise<void> {
    try {
      // 创建kafka实例
      const kafkaConfig: any = {
        clientId: this.options.clientId,
        brokers: this.options.brokers,
        connectionTimeout: this.options.connectionTimeout,
        requestTimeout: this.options.requestTimeout
      };

      // 添加SSL配置
      if (this.options.ssl) {
        kafkaConfig.ssl = this.options.ssl;
      }

      // 添加SASL认证配置
      if (this.options.sasl) {
        kafkaConfig.sasl = this.options.sasl;
      }

      // 添加日志级别配置，禁用kafkajs内部日志
      const { logLevel } = require('kafkajs');
      const logLevelMap = {
        NOTHING: logLevel.NOTHING,
        ERROR: logLevel.ERROR,
        WARN: logLevel.WARN,
        INFO: logLevel.INFO,
        DEBUG: logLevel.DEBUG
      };
      kafkaConfig.logLevel = logLevelMap[this.options.logLevel] || logLevel.NOTHING;

      this.client = new Kafka(kafkaConfig);

      // 创建生产者
      this.producer = this.client.producer(this.options.producer);

      // 创建管理员客户端
      this.admin = this.client.admin();

      // 连接生产者
      await this.producer.connect();

      // 连接管理员客户端
      await this.admin.connect();

      this.logger?.info('Kafka client is connected.');
      await this.onConnected();
    } catch (error: any) {
      this.logger?.error('Kafka Producer error', error.message);
      this.logger?.debug('Kafka Producer error', error);
      // 广播错误
      this.star?.broadcastLocal('$transporter.error', {
        error,
        module: 'transporter',
        type: C.FAILED_PUBLISHER_ERROR
      });
      throw error;
    }
  }

  /**
   * 断开连接
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.producer) {
        await this.producer.disconnect();
        this.producer = null;
      }

      if (this.consumer) {
        await this.consumer.disconnect();
        this.consumer = null;
      }

      if (this.admin) {
        await this.admin.disconnect();
        this.admin = null;
      }

      this.client = null;
    } catch (error: any) {
      this.logger?.error('Kafka disconnect error', error.message);
    }
  }

  /**
   * 订阅动作 - 使用通配符模式动态发现并订阅所有匹配的topics
   */
  public async makeSubscriptions(topics: GenericObject[]): Promise<void> {
    // 生成当前实例的topics
    const currentTopicsMap = topics.map(({ cmd, nodeID }) => this.getTopicName(cmd, nodeID));

    // 生成需要监听的cmd模式
    const cmdPatterns = topics.map(({ cmd }) => cmd);
    // 去重
    const uniqueCmds = [...new Set(cmdPatterns)];

    try {
      // 使用管理员客户端尽力创建当前实例的 topics；本地开发环境下 Kafka metadata 偶发超时不应阻塞消费者订阅
      if (this.admin) {
        this.admin
          .createTopics({
            topics: currentTopicsMap.map((topic) => ({
              topic,
              numPartitions: 1,
              replicationFactor: 1
            }))
          })
          .catch((error) => {
            this.logger?.warn('Kafka topic creation skipped or delayed', error?.message || error);
          });
      }

      // 创建消费者实例
      if (this.client) {
        // 关键修复：确保groupId唯一。
        // 原始代码中 Object.assign 的顺序导致 this.options.consumer 中的默认 groupId ('node-universe-group')
        // 覆盖了 this.star.instanceID。这导致所有微服务节点加入同一个消费组。
        // 由于 Kafka 的消费组负载均衡机制，如果有多个消费者但 Topic 只有一个分区，
        // 只有其中一个消费者能收到消息（例如 INFO 广播包）。
        // 这解释了为什么 gateway 经常收不到 auth 的注册信息。
        const consumerOptions = Object.assign({}, this.options.consumer, {
          groupId: this.star?.instanceID || this.options.consumer.groupId || 'node-universe-group'
        });

        this.logger?.info(`Kafka Consumer starting with Group ID: ${consumerOptions.groupId}`);

        this.consumer = this.client.consumer(consumerOptions);

        // 连接消费者
        await this.consumer.connect();

        await Promise.all(
          currentTopicsMap.map((topic) => this.consumer?.subscribe({ topic, fromBeginning: false }))
        );

        // 开始消费消息
        await this.consumer.run({
          eachMessage: async ({ topic, partition, message }) => {
            try {
              // 解析topic获取cmd
              // 更加健壮的解析方式：去除前缀后解析
              if (topic.startsWith(this.prefix + '.')) {
                const withoutPrefix = topic.slice(this.prefix.length + 1);
                // 使用更可靠的分割方式，避免节点ID中包含点号导致解析错误
                // 假设 cmd 总是第一部分
                const firstDotIndex = withoutPrefix.indexOf('.');
                let cmd: PacketTypes;
                let suffix: string | undefined;

                if (firstDotIndex === -1) {
                  cmd = withoutPrefix as PacketTypes;
                } else {
                  cmd = withoutPrefix.substring(0, firstDotIndex) as PacketTypes;
                  suffix = withoutPrefix.substring(firstDotIndex + 1);
                }

                if (message.value && uniqueCmds.includes(cmd)) {
                  this.receive(cmd, message.value as Buffer);
                }
              }
            } catch (error: any) {
              this.logger?.error('Error processing message', error);
            }
          }
        });

        this.logger?.info(
          `KAFKA Consumer connected and subscribed to topics: ${currentTopicsMap.join(', ')} with GroupID: ${consumerOptions.groupId}`
        );
      }
    } catch (error: any) {
      this.logger?.error('Unable to create topics or setup consumer!', topics, error);
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
    if (!this.producer) return Promise.resolve();

    try {
      // this.logger?.info(`[Kafka Debug] Sending ${packet.type} to ${topic}`, {
      //   key: packet.target || packet.requestID || 'default',
      //   packetTarget: packet.target
      // });
      await this.producer.send({
        topic: this.getTopicName(packet.type, packet.target),
        messages: [
          {
            // partition: this.options.publish.partition, // 移除强制分区
            key: packet.target || packet.requestID || 'default', // 使用Key进行路由
            value: data
          }
        ]
      });
    } catch (error: any) {
      this.logger?.error('Kafka Server Publish error', error);

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
